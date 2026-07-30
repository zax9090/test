/**
 * One Durable Object per MCP session.
 *
 * The server has to outlive a single HTTP request. `sampling/createMessage` is a
 * server-to-client request: the server emits it on the SSE stream of the tool
 * call, and the client returns the answer on a *separate* POST. Only the object
 * that issued the request can resolve it, so the `McpServer` and its transport
 * are built once and held in this object's memory for the life of the session.
 *
 * A plain Worker cannot do that — a fresh server per request never learns the
 * client's capabilities, so sampling silently never fires. Storage is wired up
 * as well, so a hibernated session replays its `initialize` on wake instead of
 * dropping to an uninitialized server.
 */

import { DurableObject } from "cloudflare:workers";
import {
  DurableObjectEventStore,
  WorkerTransport,
  createLegacyMcpHandler,
  type LegacyMcpHandler,
  type MCPStorageApi,
  type TransportState,
} from "agents/mcp";

import { buildServer } from "./build-server.js";
import type { Env } from "./env.js";

/** Route the MCP endpoint lives on, worker and object side alike. */
export const MCP_ROUTE = "/mcp";

/** Carries the session id inward, since a DO cannot read back its own name. */
export const SESSION_HEADER = "x-uu-session";

const TRANSPORT_STATE_KEY = "mcp:transport";

export class McpSession extends DurableObject<Env> {
  private handler?: LegacyMcpHandler;

  override async fetch(request: Request): Promise<Response> {
    const sessionId = request.headers.get(SESSION_HEADER);
    if (!sessionId) {
      return new Response("Missing session id", { status: 400 });
    }

    this.handler ??= this.buildHandler(sessionId);

    // `ctx` is only read for auth props, which this server does not use.
    return this.handler(request, this.env, {} as ExecutionContext);
  }

  private buildHandler(sessionId: string): LegacyMcpHandler {
    const storage: MCPStorageApi = {
      get: () => this.ctx.storage.get<TransportState>(TRANSPORT_STATE_KEY),
      set: (state) => this.ctx.storage.put(TRANSPORT_STATE_KEY, state),
    };

    const transport = new WorkerTransport({
      // Pin the session to this object's name so every follow-up request —
      // including a sampling reply — routes back here.
      sessionIdGenerator: () => sessionId,
      storage,
      // Lets a client resume with Last-Event-ID after the edge closes an idle
      // SSE stream, which matters while a sampling request awaits approval.
      eventStore: new DurableObjectEventStore(this.ctx.storage),
    });

    return createLegacyMcpHandler(buildServer(), {
      route: MCP_ROUTE,
      transport,
    });
  }
}
