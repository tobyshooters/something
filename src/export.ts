import { buildHtml } from "./build.ts";
import { copyFile, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

const TOOL_DIR = new URL(".", import.meta.url).pathname;

// Write index.html directly in the project dir so relative paths
// (style.css, images/foo.png) resolve when pagedjs-cli loads it as file://.
// Also drop the tool's template.css alongside it if the user has no style.css,
// so the export is not unstyled.
export async function exportPdf(projectDir) {
  // Strip the paged.polyfill.js <script>: pagedjs-cli injects its own,
  // and running both paginates the already-paginated output.
  const html = (await buildHtml(projectDir)).replace(
    /\s*<script src="[^"]*paged\.polyfill\.js"[^>]*><\/script>/,
    ""
  );
  const htmlPath = join(projectDir, ".something-build.html");
  await writeFile(htmlPath, html);

  const userCss = join(projectDir, "style.css");
  const droppedFallback = !existsSync(userCss);
  if (droppedFallback) {
    await copyFile(join(TOOL_DIR, "template.css"), userCss);
  }

  const outputPdf = join(projectDir, "book.pdf");
  const proc = Bun.spawn(
    ["bunx", "pagedjs-cli", "-o", outputPdf, htmlPath],
    { stdio: ["inherit", "inherit", "inherit"] }
  );
  const code = await proc.exited;

  await unlink(htmlPath);
  if (droppedFallback) {
    await unlink(userCss);
  }

  if (code !== 0) {
    throw new Error(`pagedjs-cli exited ${code}`);
  }
  console.log(`wrote ${outputPdf}`);
}
