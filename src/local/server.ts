/**
 * The local run: the same server over stdio, with presets.
 *
 * Two shapes ship from one codebase. The remote Worker needs no install and keeps
 * nothing; this one runs on the user's machine and can therefore write a file the
 * user owns, which is the only way presets can exist at all — a Worker has no
 * filesystem and the widget has no API for reading one.
 *
 * The tools are identical apart from presets, so a request unfolds the same way in
 * both. Only the storage differs.
 *
 *   node dist/local/server.js
 *
 * The preset file defaults to `~/.unknown-unknowns/presets.json`, overridable with
 * `UNKNOWN_UNKNOWNS_HOME`.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { buildServer } from "../build-server.js";
import { FilePresetStore } from "./file-store.js";

async function main(): Promise<void> {
  const server = buildServer({ presets: new FilePresetStore() });

  // stdout is the protocol channel. Anything written to it that is not JSON-RPC
  // corrupts the stream, so diagnostics go to stderr — including these.
  await server.connect(new StdioServerTransport());
  process.stderr.write("unknown-unknowns: listening on stdio\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`unknown-unknowns: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
});
