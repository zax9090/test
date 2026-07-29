/**
 * `preview` — regenerate the sample text for one axis.
 *
 * Hidden from the model (`visibility: ["app"]`) and reachable only through the
 * widget's own button. That is not tidiness: sampling puts an approval dialog in
 * front of the user on hosts that implement it, so anything that fires
 * automatically turns into a dialog every time a widget renders.
 *
 * On a host without sampling there is no model to reach — the server is
 * forbidden from calling one of its own — so previews there are whatever the
 * extracting model wrote at `unfold` time and this tool returns nothing. The
 * widget keeps the cards it already has. See docs/stage0-conflicts.md (C8).
 *
 * Failure of any kind is silent. The brief allows no error banner, and a preview
 * is an aid — losing it is not worth interrupting anyone.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { buildPreviewPrompt, clampSource } from "../lib/prompt.js";
import { extractJson, type Axis } from "../lib/schema.js";
import { requestStore } from "../lib/store.js";
import { WIDGET_URI } from "../resources/widget.js";
import type { Env } from "../env.js";

const MAX_TOKENS = 1_500;
const TIMEOUT_MS = 120_000;

const inputSchema = {
  requestId: z.string().min(1).describe("The requestId returned by unfold."),
  axisId: z.string().min(1).describe("Which axis to write samples for."),
  source: z
    .string()
    .optional()
    .describe("Current source material, if the user has edited it since unfold."),
};

export interface PreviewResult {
  axisId: string;
  /** Direction value to sample text. Empty when nothing could be generated. */
  samples: Record<string, string>;
}

function directionsOf(axis: Axis): Array<{ value: string; label: string }> {
  return (axis.options ?? []).map((o) => ({ value: o.value, label: o.label }));
}

function readSamples(raw: string, directions: Array<{ value: string }>): Record<string, string> {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== "object") return {};

  const bag = (parsed as { samples?: unknown }).samples;
  const source = bag && typeof bag === "object" ? bag : parsed;

  const known = new Set(directions.map((d) => d.value));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (known.has(key) && typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

export function registerPreview(server: McpServer, env: Env): void {
  registerAppTool(
    server,
    "preview",
    {
      title: "Preview a direction",
      description:
        "Write short samples for each direction of one axis, grounded in the " +
        "user's source material. Called by the unknown-unknowns widget when the " +
        "user presses its preview button. Not for direct use.",
      inputSchema,
      annotations: { title: "Preview a direction", readOnlyHint: true, openWorldHint: false },
      _meta: {
        ui: {
          resourceUri: WIDGET_URI,
          // Keeps it out of the model's tool list entirely, so it cannot be
          // called on the user's behalf without them pressing anything.
          visibility: ["app"],
        },
      },
    },
    async ({ requestId, axisId, source }) => {
      const empty: PreviewResult = { axisId, samples: {} };
      const result = (payload: PreviewResult) => ({
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        structuredContent: payload as unknown as Record<string, unknown>,
      });

      if (!server.server.getClientCapabilities()?.sampling) return result(empty);

      try {
        const stored = await requestStore(env, requestId).get();
        if (!stored) return result(empty);

        const axis = (stored.axes ?? []).find((a) => a.id === axisId);
        const directions = axis ? directionsOf(axis) : [];
        if (!axis || directions.length === 0) return result(empty);

        // The user may have pasted material after unfold ran, so the widget's
        // current source wins over the copy taken at extraction time.
        const material = clampSource(source) ?? stored.source;

        const reply = await server.server.createMessage(
          {
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text: buildPreviewPrompt(
                    { request: stored.request, source: material },
                    axis.label,
                    directions,
                  ),
                },
              },
            ],
            maxTokens: MAX_TOKENS,
            temperature: 0.7,
          },
          { timeout: TIMEOUT_MS },
        );

        if (reply.content.type !== "text") return result(empty);
        return result({ axisId, samples: readSamples(reply.content.text, directions) });
      } catch {
        // Declined, timed out, expired, unparseable — all the same from here.
        return result(empty);
      }
    },
  );
}
