import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import { visit } from "unist-util-visit";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { citations, loadBib, defaultFormatCitation } from "./citations.ts";

const TOOL_DIR = new URL(".", import.meta.url).pathname;

// Turn container/leaf/text directives into HTML elements per the registry.
// `:margin[hi]` → `<aside class="margin">hi</aside>`.
// The tool ships no defaults — the registry comes entirely from the
// user's something.config.ts. See sample-book for an example.
function directivesToHast(registry) {
  return (tree) => {
    visit(tree, (node) => {
      const kinds = ["containerDirective", "leafDirective", "textDirective"];
      if (!kinds.includes(node.type)) {
        return;
      }
      const entry = registry[node.name];
      if (!entry) {
        return;
      }
      const data = node.data || (node.data = {});
      const userClass = node.attributes?.class;
      const className = userClass ? [entry.class, userClass] : [entry.class];
      data.hName = entry.tag;
      data.hProperties = { ...node.attributes, className };
    });
  };
}

async function loadConfig(projectDir) {
  for (const name of ["something.config.ts", "something.config.js"]) {
    const path = join(projectDir, name);
    if (existsSync(path)) {
      const mod = await import(path);
      return mod.default || {};
    }
  }
  return {};
}

export async function buildHtml(projectDir) {
  const config = await loadConfig(projectDir);
  const bib = await loadBib(join(projectDir, "refs.bib"));
  const directives = config.directives || {};
  const formatCitation = config.formatCitation || defaultFormatCitation;

  const contentDir = join(projectDir, "content");
  const files = existsSync(contentDir)
    ? (await readdir(contentDir)).filter((f) => f.endsWith(".md")).sort()
    : [];
  const chunks = await Promise.all(
    files.map((f) => readFile(join(contentDir, f), "utf8"))
  );
  const md = chunks.join("\n\n");

  let proc = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(directivesToHast, directives);
  for (const p of config.remarkPlugins || []) {
    proc = proc.use(p);
  }
  proc = proc
    .use(citations, { bib, formatCitation })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw);
  for (const p of config.rehypePlugins || []) {
    proc = proc.use(p);
  }
  proc = proc.use(rehypeStringify);

  const body = String(await proc.process(md));
  const shell = await readFile(join(TOOL_DIR, "template.html"), "utf8");
  return shell.replace("<!--BODY-->", body);
}
