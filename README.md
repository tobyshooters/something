# something

A small Bun CLI that turns a folder of markdown into a paginated,
print-ready book via [paged.js](https://pagedjs.org).

## Install

```
bun install
```

## Use

```
something init <dir>       # scaffold a new book from sample-book/
something preview <dir>    # live-reloading preview at http://localhost:4000
something export  <dir>    # write <dir>/book.pdf
```

A book project looks like:

```
my-book/
  content/*.md            # concatenated in alphabetical order
  images/
  refs.bib                # simple @type{key, field = {value}} entries
  style.css               # @page rules, class visuals — edit freely
  something.config.ts     # optional plugin surface
```

## Markdown

- Footnotes via `remark-gfm`: `[^1]`
- Citations against `refs.bib`: `[@key]`, `[@key, p. 42]`
- Margin notes: `:margin[text]`
- Class-shaped blocks: `:::figure`, `:::spread`, or anything you add
  to `directives` in `something.config.ts`

Raw HTML always passes through.

## The pipeline

Built on the [unified](https://unifiedjs.com) ecosystem, which treats
markup as ASTs you transform with plugins:

- `unified` — the runner. `.use(...).use(...).process(input)`.
- `remark` — the markdown side. Parses into **mdast**; `remark-*`
  plugins mutate mdast (`remark-gfm` for tables/footnotes,
  `remark-directive` for `:foo[]` / `:::foo`).
- `rehype` — the HTML side. AST is **hast**; `rehype-*` plugins
  mutate hast (`rehype-raw` re-parses embedded HTML strings,
  `rehype-stringify` serializes to a string).

`remark-rehype` bridges the two:

```
md → remarkParse → mdast → (remark-*) → remark-rehype → hast → (rehype-*) → rehype-stringify → html
```

## Extending

Add new directives, remark/rehype plugins, or a custom citation formatter
in `something.config.ts`. See `sample-book/` for a working starting point
and `agent-notes/plan.md` for the full extension surface.

## Layout

```
src/          tool source
sample-book/  what `init` copies
agent-notes/  design docs
```
