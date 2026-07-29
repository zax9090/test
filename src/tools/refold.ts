/**
 * `refold` — fit the axes to material that arrived after the first pass.
 *
 * The brief tells the extracting model to shape axes around the source when
 * there is any, but the source box lives in the widget and can be filled long
 * after `unfold` ran. Without this the box only ever fed the prompt and the
 * previews, and the axes stayed shaped around a request with no material.
 *
 * App-only, and deliberately with no `resourceUri`: a tool reached through
 * `callServerTool` returns its result to the widget that asked, not to the
 * conversation, so nothing new is rendered. That is what makes re-extraction
 * possible at all — going back through the model would mean another `unfold`
 * call, and a tool that declares a widget mounts a fresh iframe on every
 * invocation (C7).
 *
 * It needs a model, so like `preview` it does nothing where the host has no
 * sampling (C8), and the widget hides the action there rather than offering one
 * that cannot work.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { clampSource } from "../lib/prompt.js";
import { extractViaSampling } from "../lib/sampling.js";
import type { Unfolded } from "../lib/schema.js";
import { requestStore } from "../lib/store.js";
import type { Env } from "../env.js";

const inputSchema = {
  requestId: z.string().min(1).describe("The requestId returned by unfold."),
  source: z.string().describe("The material now in the widget's source box."),
};

export interface RefoldResult {
  /** Absent when nothing could be re-extracted; the widget then keeps what it has. */
  unfolded?: Unfolded;
}

export function registerRefold(server: McpServer, env: Env): void {
  registerAppTool(
    server,
    "refold",
    {
      title: "Refold around new material",
      description:
        "Re-extract the axes for a request now that source material is " +
        "available. Called by the unknown-unknowns widget when the user asks to " +
        "refold. Not for direct use.",
      inputSchema,
      annotations: {
        title: "Refold around new material",
        readOnlyHint: true,
        openWorldHint: false,
      },
      // No resourceUri: this returns data to the calling widget and must not
      // cause one to be rendered.
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ requestId, source }) => {
      const nothing: RefoldResult = {};
      const result = (payload: RefoldResult) => ({
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      });

      if (!server.server.getClientCapabilities()?.sampling) return result(nothing);

      const material = clampSource(source);
      if (!material) return result(nothing);

      try {
        const store = requestStore(env, requestId);
        const stored = await store.get();
        if (!stored) return result(nothing);

        const { unfolded, route } = await extractViaSampling(server.server, {
          request: stored.request,
          source: material,
        });

        // The generic axes are what extraction falls back to when it fails
        // twice. Replacing a real set with those would be a downgrade, so the
        // widget keeps what it already has instead.
        if (route === "fallback") return result(nothing);

        // Keep the same key so the widget's requestId stays valid, and refresh
        // the stored copy so a later `preview` works from the new material.
        await store.put({ request: stored.request, source: material, axes: unfolded.axes });

        return result({ unfolded });
      } catch {
        return result(nothing);
      }
    },
  );
}
