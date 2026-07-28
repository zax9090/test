/**
 * The widget's UI resource.
 *
 * One self-contained HTML document, built by `scripts/build-widget.mjs` and
 * compiled into the Worker as a string. Nothing is fetched at runtime — the
 * iframe's CSP blocks it, and the failure mode is a silent blank rectangle.
 *
 * No `csp` block is declared: the widget makes no outbound requests, so the
 * spec's block-everything default is exactly right. The one permission asked for
 * is clipboard write, for the copy button; the widget feature-detects and falls
 * back rather than assuming it was granted.
 */

import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import widgetHtml from "../generated/widget-html.js";

export const WIDGET_URI = "ui://unknown-unknowns/widget.html";

export function registerWidgetResource(server: McpServer): void {
  registerAppResource(
    server,
    "Unfolded axes",
    WIDGET_URI,
    { description: "The axes a request leaves undecided, as a selectable list." },
    async () => ({
      contents: [
        {
          uri: WIDGET_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: {
              permissions: { clipboardWrite: {} },
            },
          },
        },
      ],
    }),
  );
}
