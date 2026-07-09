# `./something` — a Bun-based markdown-to-print CLI

## Context

`doc-thesis/` is currently built through a Makefile that invokes `pandoc
--pdf-engine=xelatex` with a stack of Lua filters, a `template.md` full of
`header-includes` LaTeX packages, and a CSL file for ABNT citations. It
works but is fragile: the template is ~70 lines of LaTeX packaging around a
single `##INSERT##`, `format.lua` threads raw LaTeX into every margin note
and citation, and any change to styling means editing Lua that emits LaTeX
macros.

We want to replace the toolchain with a small **Bun CLI** that:
- reads markdown + local CSS + images from a project directory,
- pipes markdown through `remark` (pandoc-style footnotes/citations,
  `remark-directive` for everything class-shaped),
- renders to HTML paginated with **paged.js**,
- serves the result at `localhost` with live-reload during editing,
- exports a print-ready PDF via headless Chromium + paged.js.

Scope for v1 (deliberately narrow):
- Bun runtime, single-package project.
- Reader PDF only. **No imposition** in v1.
- Static preview server with WebSocket live-reload — one paginated view.
- Two-page spread rendered by default in preview.

The name `./something` is a placeholder. Candidates: `folio`, `signature`,
`pauta`, `press`. Non-blocking.

## The userspace model (important)

**The tool ships small and dumb.** Everything specific — how a margin note
looks, what a citation renders as, how a spread is composed, whether images
get gray boxes in draft mode — lives in the **user's book project**, not
in the tool. Extension is the primary interface.

A book project looks like:

```
my-book/
  content/*.md            # alphabetical order
  images/
  refs.bib
  style.css               # @page rules, class visuals, custom props
  something.config.ts     # optional — user's plugin surface
```

`something.config.ts` is a plain Bun-loadable module that exports:

```ts
export default {
  // Add or override directive → HTML mappings.
  // Simple case: tag + class. Complex: a function returning hast.
  directives: {
    margin:   { tag: "aside",  class: "margin" },
    callout:  { tag: "div",    class: "callout" },
    manicule: (node) => ({ type: "element", tagName: "span", ... }),
  },
  // Extra remark/rehype plugins the user wants in the pipeline.
  remarkPlugins:  [ myCustomPlugin ],
  rehypePlugins:  [],
  // Anything else needed at build time (bib formatter override, etc.).
  formatCitation: (entry, locator) => `${entry.author} (${entry.year})`,
};
```

The tool's job is to:
1. Provide a small, well-defined pipeline with obvious extension points.
2. Load `something.config.ts` if present and merge its contributions.
3. Serve, live-reload, export.

The tool does **not** ship its own directive catalog beyond what's needed
for a working baseline (`margin`, `figure`, `spread` — enough to have a
useful default). Everything else — the specific manicule glyph, the
sidenote arrow, the citation format, spread/imagepage logic — is
userspace, layered on via `something.config.ts` + `style.css`.

The doc-thesis `assets/` (format.lua, citesidenote.tex, dotprogress.tex,
etc.) are **reference material for what userspace CAN do**, not a spec
of what the tool must implement. Port them incrementally, in userspace,
when we actually rebuild doc-thesis on top of this tool.

## Tool architecture

Flat, per `style.md`. Six files, no subpackages:

```
something/
  main.ts            # CLI entry: dispatches preview / export / init
  build.ts           # md → html pipeline (remark + directives + citations)
  serve.ts           # HTTP server, file watcher, WebSocket live-reload
  export.ts          # HTML → PDF via pagedjs-cli or puppeteer
  templates/
    default.html     # HTML shell that loads paged.js + user style.css
    default.css      # minimal baseline: page geometry + core classes
  package.json
```

Anything that can be inlined into `build.ts` should be. The default
directive registry, the `.bib` parser, and config loading all live inside
`build.ts` as small tables/functions until one grows past ~150 lines.

### Markdown syntax (hybrid)

- **Footnotes** — pandoc-style `[^1]` via `remark-gfm`.
- **Citations** — pandoc-style `[@key]`. Parsed against `refs.bib`,
  rendered as an inline anchor + accumulated bibliography section. Format
  is user-overridable via `formatCitation` in config; the baseline is a
  simple author-year string.
- **Margin notes** — leaf directive `:margin[text goes here]`.
- **Figures, spreads, callouts, class-shaped blocks** — container
  directives (`:::figure`, `:::spread`, `:::callout`, ...).
- **Raw HTML** — always passed through untouched. Escape hatch.

The **default directive registry** (baseline only):

```ts
const DEFAULT_DIRECTIVES = {
  margin:  { tag: "aside",   class: "margin" },
  figure:  { tag: "figure",  class: "figure" },
  spread:  { tag: "section", class: "spread" },
};
```

`something.config.ts` merges into and overrides this table. Adding a new
class-shaped construct = one entry in user config + one CSS rule in
`style.css`. That's the "easy way to add a new kind of class" the user
asked for.

### CSS as the single source of styling truth

`style.css` (in the user's project) owns page geometry via paged.js's
`@page` model:

```css
@page {
  size: A5;
  margin: 2cm 1cm 1cm 2cm;
  @bottom-center { content: counter(page); }
}
@page :left  { margin-left: 1cm;  margin-right: 2cm; }
@page :right { margin-left: 2cm;  margin-right: 1cm; }

:root {
  --font-body: "Iowan Old Style", Georgia, serif;
  --font-size: 10pt;
}

body      { font-family: var(--font-body); font-size: var(--font-size); }
p         { text-align: justify; hyphens: auto; }
.margin   { font-size: 0.75em; float: right; ... }
.figure   { break-inside: avoid; }
.spread   { page: spread; break-before: right; }
h1        { break-before: right; margin-top: 30%; }
```

Page size, margin, font, and every class visual live here. No hidden
config file for styling.

`templates/default.css` ships a fully-working baseline. `something init`
copies it into the user's project so they can edit in place.

### Two-page spread in preview

paged.js emits one `.pagedjs_page` element per printed page. Default CSS
wraps them in a flex row so they render side-by-side at 1:1 scale,
matching the printed book. `@media print` rules undo this so the exported
PDF is one page per PDF page.

### Pipeline (`build.ts`)

```
load something.config.ts (if present)
concat *.md alphabetically
  → unified().use(remarkParse)
           .use(remarkGfm)                              // tables, footnotes
           .use(remarkDirective)
           .use(directivesToHast, mergedDirectives)     // local plugin
           .use(...userRemarkPlugins)
           .use(citations, { bib, formatCitation })     // local plugin
           .use(remarkRehype, { allowDangerousHtml: true })
           .use(rehypeRaw)                              // keep raw HTML
           .use(...userRehypePlugins)
           .use(rehypeStringify)
  → inject body into templates/default.html
```

The `citations` plugin walks text nodes, finds `[@key]` patterns, replaces
them with `<a class="cite" href="#bib-key">…</a>`, and appends a
`<section class="bibliography">`. Bib parsing: a small handwritten
`.bib` reader (entry type, key, common fields). No external CSL processor
in v1 — the baseline formatter is trivial; anything richer is userspace.

### `serve.ts`

- Bun HTTP server on `localhost:4000`.
- `GET /` → freshly built HTML.
- `GET /style.css`, `GET /images/*` → served from the user's project dir.
- WebSocket at `/ws` sends `"reload"` on any `.md` / `.css` / `.ts` /
  image change (Bun `fs.watch`, recursive, debounced 100ms). Config
  changes trigger a full rebuild + reload.
- Injected script tag listens on the socket and calls `location.reload()`.

### `export.ts`

Single function: given a project dir, build HTML, write it to a temp file,
invoke `pagedjs-cli` targeting that HTML, output to `book.pdf` in the
project dir. Fall back to `puppeteer` + a small script that loads paged.js
and calls `page.pdf(...)` if `pagedjs-cli` proves awkward under Bun.
Decide at implementation time; don't build both.

### CLI surface (`main.ts`)

```
something preview <dir>   # start dev server, open browser
something export  <dir>   # write book.pdf
something init    <dir>   # scaffold content/, style.css, refs.bib,
                          #   optional something.config.ts stub
```

Bun's built-in arg parsing, no `commander`-style dependency.

## What the tool does NOT ship

- The doc-thesis manicule glyph, dotprogress, strataglyph, citesidenote
  layout — these are userspace, ported later when doc-thesis is
  rebuilt on top of `./something`.
- The specific ABNT citation format — userspace via `formatCitation`.
- Draft mode / gray-box images — a userspace remark plugin + CSS toggle.
- Imposition, TOC generation, systray, multiple themes — all deferred
  or userspace.

## Critical files (existing) to consult while implementing

- `doc-thesis/content/*.md` — real-world corpus, use as the test set.
- `doc-thesis/content/references.bib` — bib input the baseline parser
  must handle. Start by making this file parse.
- `doc-thesis/assets/format.lua`, `template.md`, `citesidenote.tex`,
  `dotprogress.tex` — **reference for userspace capabilities**, not a
  spec for the tool.
- `/home/cristobal/dev/arquipelago/ferry/main.go`,
  `.../source/server.go` — CLI+server shape to mirror.

## Verification

End-to-end, in this order:

1. `something init /tmp/testbook` — scaffolds a project with one
   placeholder `.md`, a `style.css`, empty `refs.bib`, empty config stub.
2. `something preview /tmp/testbook` — opens `localhost:4000`. Confirm
   two-page spread visible, edit the `.md`, confirm live reload fires
   under 500ms.
3. Drop `doc-thesis/content/01-language-manual.md` and its images into
   the test book. Confirm: headings, block quotes, plain citations,
   footnotes, images render — **using only baseline behavior**.
   Anything that looks wrong is fixed in userspace (`style.css` +
   `something.config.ts`), not by adding features to the tool.
4. `something export /tmp/testbook` — produces `book.pdf`. Open in a
   viewer: page size = A5, margins correct, headings on recto pages,
   `:::spread` blocks span two pages.
5. Sanity check: adding a new directive `:::warning` requires only one
   entry in `something.config.ts` and one CSS rule. No tool edits.

## Explicitly out of scope for v1

- Imposition.
- Multiple output themes.
- CSL / arbitrary citation styles beyond the baseline formatter.
- TOC generation, draft mode, systray, background app.
- Any doc-thesis-specific visual (manicule, dotprogress, strata).
