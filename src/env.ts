import type { McpSession } from "./session.js";

export interface Env {
  MCP_SESSION: DurableObjectNamespace<McpSession>;
}
