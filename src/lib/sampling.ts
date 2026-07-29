/**
 * Axis extraction over MCP sampling.
 *
 * The server never calls a model of its own — it borrows the host's, so there is
 * no API key and no separate inference bill. Where the host has no sampling
 * capability the caller takes the host-fallback route instead; see
 * docs/stage0-conflicts.md (C1) for why that is the common case today.
 *
 * Nothing here logs the request or the source material (P1).
 */

import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { buildExtractionPrompt, type PromptInput } from "./prompt.js";
import { fallbackUnfolded, parseUnfolded, type Unfolded } from "./schema.js";

const MAX_TOKENS = 4_000;

/** Sampling timeout. Generous — the host may be waiting on user approval. */
const TIMEOUT_MS = 120_000;

export type ExtractionRoute = "sampling" | "retry" | "fallback";

export interface ExtractionResult {
  unfolded: Unfolded;
  route: ExtractionRoute;
}

/** Does this client accept `sampling/createMessage`? */
export function supportsSampling(server: Server): boolean {
  return Boolean(server.getClientCapabilities()?.sampling);
}

async function requestOnce(server: Server, input: PromptInput): Promise<string | undefined> {
  const result = await server.createMessage(
    {
      messages: [
        {
          role: "user",
          content: { type: "text", text: buildExtractionPrompt(input) },
        },
      ],
      maxTokens: MAX_TOKENS,
      // Axis extraction is a structuring job, not a creative one.
      temperature: 0.2,
    },
    { timeout: TIMEOUT_MS },
  );

  return result.content.type === "text" ? result.content.text : undefined;
}

/**
 * Extract axes via sampling, retrying once on unparseable output.
 *
 * Never throws and never returns an empty axis list: a second failure falls back
 * to the generic axes so the widget always has something to show.
 */
export async function extractViaSampling(
  server: Server,
  input: PromptInput,
): Promise<ExtractionResult> {
  const routes: ExtractionRoute[] = ["sampling", "retry"];

  for (const route of routes) {
    try {
      const text = await requestOnce(server, input);
      if (text) {
        const unfolded = parseUnfolded(text, input.request);
        if (unfolded) return { unfolded, route };
      }
    } catch {
      // Host rejected, timed out, or the user declined approval. Both attempts
      // are allowed to fail; the fallback below is the floor.
    }
  }

  return { unfolded: fallbackUnfolded(input.request), route: "fallback" };
}
