/**
 * Worker entry — a remote streamable-HTTP MCP server.
 *
 * The worker itself only routes: it resolves the session id and forwards to the
 * Durable Object that owns that session. All MCP work happens there, because the
 * server object must survive across requests for sampling to complete. See
 * `src/session.ts`.
 *
 * The handler is SDK v1 (`createLegacyMcpHandler`). That is not drift —
 * `@modelcontextprotocol/ext-apps` peer-depends on SDK v1, so the v2 stateless
 * factory is unusable until ext-apps moves. See docs/stage0-conflicts.md (C6).
 */

import { MCP_ROUTE, SESSION_HEADER } from "./session.js";
import type { Env } from "./env.js";

export { McpSession } from "./session.js";
export { RequestStore } from "./lib/store.js";
export type { Env } from "./env.js";

/** Header the streamable-HTTP spec uses to carry the session id. */
const MCP_SESSION_HEADER = "mcp-session-id";

async function routeToSession(request: Request, env: Env): Promise<Response> {
  // Absent on `initialize` — that request mints the session.
  const sessionId = request.headers.get(MCP_SESSION_HEADER) ?? crypto.randomUUID();

  const forwarded = new Request(request);
  forwarded.headers.set(SESSION_HEADER, sessionId);

  const stub = env.MCP_SESSION.get(env.MCP_SESSION.idFromName(sessionId));
  return stub.fetch(forwarded);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "content-type": "text/plain" } });
    }

    if (url.pathname === MCP_ROUTE) {
      return routeToSession(request, env);
    }

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
