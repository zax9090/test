/**
 * `unfold` — the tool this project is built around.
 *
 * Takes one request and lays out what it leaves undecided.
 *
 * Two routes reach the same place:
 *
 *   sampling      unfold(request) -> sampling/createMessage -> axes
 *   host fallback unfold(request) -> instruction text
 *                 unfold(request, unfolded=JSON) -> axes
 *
 * The fallback exists because the host may not implement sampling; on Claude it
 * is the only route that runs. See docs/stage0-conflicts.md (C1).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { buildHostFallbackPrompt } from "../lib/prompt.js";
import { extractViaSampling, supportsSampling } from "../lib/sampling.js";
import { fallbackUnfolded, parseUnfolded, type Unfolded } from "../lib/schema.js";
import { clampSource } from "../lib/prompt.js";
import { detectLocale } from "../lib/locale.js";
import { newRequestId, requestStore, type StoreEnv } from "../lib/store.js";
import type { Env } from "../env.js";

/**
 * Both invocation paths are described, because the brief wants Claude to reach
 * for this on a vague request *and* the user to be able to ask for it by name.
 * The refusal clause is deliberately first and concrete — an unfolder that fires
 * on already-specific requests is just latency.
 */
const DESCRIPTION = `Lay out what a request leaves undecided, as selectable axes in a widget.

Use this when a request is open-ended enough that you would otherwise guess at
details the user has an opinion about — an image, a piece of writing, a design, a
plan — or whenever the user explicitly asks for it ("unfold this", "unknown
unknowns", "정리해줘", "뭘 정해야 하지").

Do NOT call this when the request is already specific enough to act on, when the
user has asked a factual question, or when they clearly want the work done rather
than scoped. A concrete request answered with a widget is a worse answer.

Call it with the user's request verbatim. Pass \`source\` when the task is about a
document, transcript or dataset the user provided.`;

const inputSchema = {
  request: z
    .string()
    .min(1)
    .describe("The user's request, verbatim and in their own language."),
  source: z
    .string()
    .optional()
    .describe("Material the task is about — document, transcript, data. Optional."),
  unfolded: z
    .string()
    .optional()
    .describe(
      "Only for the second call on the host-fallback route: the JSON you produced " +
        "from the instructions returned by the first call. Never set this on a first call.",
    ),
};

export interface UnfoldResult {
  unfolded: Unfolded;
  requestId: string;
  locale: "ko" | "en";
}

/**
 * Persist the material `preview` will need, then hand back the result payload.
 *
 * Storage failures are swallowed: losing the ability to generate previews later
 * is not a reason to withhold the axes now.
 */
async function finalize(
  env: StoreEnv,
  unfolded: Unfolded,
  request: string,
  source: string | undefined,
): Promise<UnfoldResult> {
  const requestId = newRequestId();
  try {
    await requestStore(env, requestId).put({ request, source, axes: unfolded.axes });
  } catch {
    // preview will fall back quietly (brief: no error banners).
  }
  return { unfolded, requestId, locale: detectLocale(request) };
}

function asToolResult(payload: UnfoldResult) {
  // Stage 1 returns the axes as text. Stage 3 attaches the widget resource and
  // moves this payload into structured content.
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload.unfolded, null, 2) }],
    structuredContent: payload as unknown as Record<string, unknown>,
  };
}

export function registerUnfold(server: McpServer, env: Env): void {
  server.registerTool(
    "unfold",
    {
      title: "Unfold the undecided",
      description: DESCRIPTION,
      inputSchema,
      annotations: {
        title: "Unfold the undecided",
        readOnlyHint: true,
        openWorldHint: false,
      },
    },
    async ({ request, source, unfolded }) => {
      const cleanSource = clampSource(source);

      // Second leg of the host-fallback route: the model has produced the JSON.
      if (unfolded) {
        const parsed = parseUnfolded(unfolded, request) ?? fallbackUnfolded(request);
        return asToolResult(await finalize(env, parsed, request, cleanSource));
      }

      if (supportsSampling(server.server)) {
        const { unfolded: extracted } = await extractViaSampling(server.server, {
          request,
          source: cleanSource,
        });
        return asToolResult(await finalize(env, extracted, request, cleanSource));
      }

      // No sampling on this client — hand the instruction to the host model.
      return {
        content: [
          {
            type: "text" as const,
            text: buildHostFallbackPrompt({ request, source: cleanSource }),
          },
        ],
      };
    },
  );
}
