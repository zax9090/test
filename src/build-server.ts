/**
 * Build the MCP server.
 *
 * Platform-free on purpose: both entry points use it. The Worker wraps it in a
 * Durable Object per session (`src/session.ts`); the local run wraps it in stdio
 * (`src/local/server.ts`). Keeping one definition is what stops the two shapes
 * from drifting into offering different tools or different instructions.
 *
 * Tools and resources are registered up front — they have to be, since the first
 * registration installs the `tools/list` handler and that path throws once the
 * server is connected. `unfold` then narrows itself in `oninitialized`, the
 * earliest point the client's sampling capability is known.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { PresetStore } from "./lib/preset-store.js";
import { registerPresets } from "./tools/presets.js";
import { registerUnfold } from "./tools/unfold.js";
import { registerWidgetResource } from "./resources/widget.js";

export const SERVER_INFO = { name: "unknown-unknowns", version: "0.1.0" } as const;

export const INSTRUCTIONS = `Surfaces the choices a request leaves unmade, so the user can
decide them instead of discovering them one correction at a time.

Reach for \`unfold\` when a request is open-ended and you would otherwise guess.
Leave it alone when the request is already specific — answer that directly.`;

export interface BuildOptions {
  /**
   * Where presets live. Omitted on the remote Worker, which has no filesystem —
   * and then the preset tools are not registered at all, so the widget draws no
   * preset UI rather than offering buttons that cannot work.
   */
  presets?: PresetStore;
}

export function buildServer({ presets }: BuildOptions = {}): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions: INSTRUCTIONS,
    capabilities: { tools: {}, resources: {} },
  });

  const unfold = registerUnfold(server);
  registerWidgetResource(server);
  if (presets) registerPresets(server, presets);

  server.server.oninitialized = () => {
    unfold.onCapabilities(Boolean(server.server.getClientCapabilities()?.sampling));
  };

  return server;
}
