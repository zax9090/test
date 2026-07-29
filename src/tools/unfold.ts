/**
 * `unfold` — the tool this project is built around.
 *
 * Takes one request and lays out what it leaves undecided, in a widget.
 *
 * The tool is registered in one of two shapes, chosen from the client's
 * capabilities at initialize time:
 *
 *   host has sampling  unfold(request, source?) — the server extracts the axes
 *                      through the host's model.
 *   host has none      unfold(request, source?, unfolded) — the extraction
 *                      instruction rides in the tool description and the host
 *                      model supplies the axes as an argument.
 *
 * Either way it is exactly one call. That matters: a tool carrying
 * `_meta.ui.resourceUri` renders its widget on *every* invocation, and each call
 * mounts a fresh iframe that stays in the transcript. The brief's two-call
 * fallback would therefore leave an empty widget above the real one. See
 * docs/stage0-conflicts.md (C7).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { SCHEMA, TASK, clampSource } from "../lib/prompt.js";
import { extractViaSampling } from "../lib/sampling.js";
import { fallbackUnfolded, parseUnfolded, type Unfolded } from "../lib/schema.js";
import { detectLocale } from "../lib/locale.js";
import { newRequestId, requestStore } from "../lib/store.js";
import { WIDGET_URI } from "../resources/widget.js";
import type { Env } from "../env.js";

/**
 * Both invocation paths are described, because the brief wants Claude to reach
 * for this on a vague request *and* the user to be able to ask for it by name.
 * The refusal clause is deliberately first and concrete — an unfolder that fires
 * on already-specific requests is just latency.
 */
const WHEN = `Lay out what a request leaves undecided, as selectable axes in a widget.

Use this when a request is open-ended enough that you would otherwise guess at
details the user has an opinion about — an image, a piece of writing, a design, a
plan — or whenever the user explicitly asks for it ("unfold this", "unknown
unknowns", "정리해줘", "뭘 정해야 하지").

Do NOT call this when the request is already specific enough to act on, when the
user has asked a factual question, or when they clearly want the work done rather
than scoped. A concrete request answered with a widget is a worse answer.

Call it with the user's request verbatim. Pass \`source\` when the task is about a
document, transcript or dataset the user provided.`;

/** Description for hosts that cannot sample: the model does the extraction itself. */
const WHEN_MODEL_EXTRACTS = `${WHEN}

You must also supply \`unfolded\` — a JSON string you write yourself, following
the instructions below. Do not show it to the user, and do not answer the request
itself; the user decides from the widget first.

${TASK}

\`unfolded\` is a JSON string of this shape:

${SCHEMA}`;

const baseInput = {
  request: z
    .string()
    .min(1)
    .describe("The user's request, verbatim and in their own language."),
  source: z
    .string()
    .optional()
    .describe("Material the task is about — document, transcript, data. Optional."),
};

export interface UnfoldPayload {
  unfolded: Unfolded;
  requestId: string;
  locale: "ko" | "en";
  /**
   * The material the request was about, handed back so the widget can seed its
   * source box with it.
   *
   * Without this, source given to Claude shapes the axes and then vanishes: the
   * widget starts empty, so the assembled prompt silently omits the very
   * document the task is about, while source typed into the box does appear.
   * Round-tripping through the tool result is how the brief intends widget state
   * to travel, and the server still keeps nothing (P1).
   */
  source?: string;
  /**
   * Whether `preview` can actually write anything on this host.
   *
   * It needs a model, and the only one it may use is the host's via sampling.
   * Where that is missing the tool returns nothing by design (C8) — so the
   * widget hides the button rather than offering one that never responds.
   */
  canPreview: boolean;
}

/**
 * Persist what `preview` will need, then build the result payload.
 *
 * Storage failures are swallowed: losing the ability to generate previews later
 * is not a reason to withhold the axes now.
 */
async function finalize(
  server: McpServer,
  env: Env,
  unfolded: Unfolded,
  request: string,
  source: string | undefined,
): Promise<UnfoldPayload> {
  const requestId = newRequestId();
  try {
    await requestStore(env, requestId).put({ request, source, axes: unfolded.axes });
  } catch {
    // preview falls back quietly (brief: no error banners).
  }
  return {
    unfolded,
    requestId,
    locale: detectLocale(request),
    canPreview: Boolean(server.server.getClientCapabilities()?.sampling),
    ...(source ? { source } : {}),
  };
}

function toolResult(payload: UnfoldPayload) {
  return {
    // Text keeps the tool useful on hosts with no MCP Apps support at all.
    content: [{ type: "text" as const, text: JSON.stringify(payload.unfolded) }],
    structuredContent: payload as unknown as Record<string, unknown>,
  };
}

export interface UnfoldHandle {
  /**
   * Narrow the tool once the client's capabilities are known.
   *
   * Called from `oninitialized`. Capabilities are not knowable at registration
   * time, and the tool cannot simply be registered later: the first
   * `registerTool` installs the `tools/list` handler via `registerCapabilities`,
   * which throws once the server is connected to a transport. So the tool is
   * registered up front in its widest shape and narrowed here.
   */
  onCapabilities(sampling: boolean): void;
}

interface UnfoldArgs {
  request: string;
  source?: string;
  unfolded?: string;
}

async function handle(server: McpServer, env: Env, args: UnfoldArgs) {
  const { request, source, unfolded: supplied } = args;
  const cleanSource = clampSource(source);

  // On a host without sampling this is the only route. On one with sampling the
  // narrowed schema has no `unfolded` field, so the SDK strips it before the
  // handler sees it and extraction always runs below — the branch is simply
  // unreachable there.
  if (supplied) {
    const parsed = parseUnfolded(supplied, request) ?? fallbackUnfolded(request);
    return toolResult(await finalize(server, env, parsed, request, cleanSource));
  }

  const { unfolded } = await extractViaSampling(server.server, {
    request,
    source: cleanSource,
  });
  return toolResult(await finalize(server, env, unfolded, request, cleanSource));
}

const common = {
  title: "Unfold the undecided",
  annotations: {
    title: "Unfold the undecided",
    readOnlyHint: true,
    openWorldHint: false,
  },
  _meta: { ui: { resourceUri: WIDGET_URI } },
} as const;

const modelExtractsInput = {
  ...baseInput,
  unfolded: z
    .string()
    .min(1)
    .describe("The axis JSON you produced, as described in the tool description."),
};

export function registerUnfold(server: McpServer, env: Env): UnfoldHandle {
  // Registered in the shape that works on any client, so a host that never
  // reports sampling — every Claude surface today — is correct from the start
  // and nothing depends on the narrowing below actually running.
  const tool = registerAppTool(
    server,
    "unfold",
    { ...common, description: WHEN_MODEL_EXTRACTS, inputSchema: modelExtractsInput },
    async (args) => handle(server, env, args),
  );

  return {
    onCapabilities(sampling: boolean) {
      if (!sampling) return;
      // The server can do the extraction itself, so stop asking the model for it
      // and drop the instruction from the description.
      tool.update({ description: WHEN, paramsSchema: baseInput });
    },
  };
}
