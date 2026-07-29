/**
 * Build the browser-side test harness.
 *
 * Emits a host page that mounts the real widget in an iframe and speaks the real
 * `ui/` protocol to it through `AppBridge`. The payload is injected by the test
 * before load, so one built harness serves every case.
 *
 * Used by test/widget.spec.mjs.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const outDir = resolve(root, ".harness");

const result = await build({
  entryPoints: [resolve(here, "widget-harness/host.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  write: false,
  legalComments: "none",
  define: { "process.env.NODE_ENV": '"production"' },
});

// The generated module exports the HTML as a JSON string literal. Read the
// literal straight out rather than compiling a module to obtain one constant.
const generated = readFileSync(resolve(root, "src/generated/widget-html.ts"), "utf8");
const widgetHtml = JSON.parse(
  generated.slice(generated.indexOf('"'), generated.lastIndexOf('"') + 1),
);

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "host.js"), result.outputFiles[0].text, "utf8");

// Served as its own document rather than inlined into the host page: the widget
// contains `</script>`, which would close the host's own inline script no matter
// how the string is quoted.
writeFileSync(resolve(outDir, "widget.html"), widgetHtml, "utf8");
writeFileSync(
  resolve(outDir, "host.html"),
  `<!doctype html>
<meta charset="utf-8">
<body>
<script src="./host.js"></script>
</body>
`,
  "utf8",
);

console.log(`harness: ${(result.outputFiles[0].text.length / 1024).toFixed(0)}KB host`);
