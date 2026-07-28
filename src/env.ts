import type { McpSession } from "./session.js";
import type { StoreEnv } from "./lib/store.js";

export interface Env extends StoreEnv {
  MCP_SESSION: DurableObjectNamespace<McpSession>;
}
