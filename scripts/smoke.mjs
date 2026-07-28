/**
 * Manual end-to-end check of the MCP server over real MCP.
 *
 * Not part of `npm test` — it needs a server running:
 *
 *   npm run build:widget && npx wrangler dev --port 8788 --local
 *   node scripts/smoke.mjs
 *
 * Checks that `unfold` takes the right shape for each kind of client, that both
 * extraction routes end in axes, and that the widget resource is actually
 * served at the URI the tool points at.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const URL_ = new URL("http://127.0.0.1:8788/mcp");

const CANNED = JSON.stringify({
  title: "고양이 이미지",
  intent: "고양이 이미지 만들어줘",
  axes: [
    {
      id: "coat",
      label: "털색",
      group: "core",
      type: "select",
      norm: "보통 단색이 인식률이 높습니다",
      options: [
        { value: "black", label: "검정", emit: "털색은 검은색으로 한다.", common: true },
        { value: "white", label: "흰색", emit: "털색은 흰색으로 한다." },
      ],
    },
    { id: "broken", group: "extra", type: "select", options: [] },
    {
      id: "size",
      label: "크기",
      group: "extra",
      type: "range",
      range: { unit: "px", min: 256, max: 2048, emitTemplate: "가로 {value}px로 만든다." },
    },
  ],
});

async function connect(caps, onSampling) {
  const client = new Client({ name: "smoke", version: "0.0.0" }, { capabilities: caps });
  if (onSampling) client.setRequestHandler(CreateMessageRequestSchema, onSampling);
  await client.connect(new StreamableHTTPClientTransport(URL_));
  return client;
}

const check = (label, ok) => console.log(`  ${ok ? "ok  " : "FAIL"} ${label}`);

// ── client without sampling: the model is asked to supply the axes ──────────
{
  const client = await connect({});
  const { tools } = await client.listTools();
  const unfold = tools.find((t) => t.name === "unfold");

  console.log("=== no sampling ===");
  check("tool is registered", Boolean(unfold));
  check("declares a widget resource", unfold._meta?.ui?.resourceUri === "ui://unknown-unknowns/widget.html");
  check("asks the model for `unfolded`", "unfolded" in (unfold.inputSchema.properties ?? {}));
  check("carries the extraction instruction", /Find what the request leaves undecided/.test(unfold.description));
  check("tells Claude when not to call it", /Do NOT call this/.test(unfold.description));

  const r = await client.callTool({
    name: "unfold",
    arguments: { request: "고양이 이미지 만들어줘", unfolded: CANNED },
  });
  const payload = r.structuredContent;
  check("returns axes", payload?.unfolded?.axes?.length === 2);
  check("drops the malformed axis", !payload.unfolded.axes.some((a) => a.id === "broken"));
  check("detects the locale", payload?.locale === "ko");
  check("mints a requestId", typeof payload?.requestId === "string");

  // The resource the tool points at must exist and be MCP-Apps flavoured HTML.
  const res = await client.readResource({ uri: "ui://unknown-unknowns/widget.html" });
  const doc = res.contents[0];
  check("widget resource is served", doc.text.startsWith("<!doctype html>"));
  check("uses the apps mime type", doc.mimeType === "text/html;profile=mcp-app");
  check("asks for clipboard-write", Boolean(doc._meta?.ui?.permissions?.clipboardWrite));
  check("loads nothing from the network", !/https?:\/\/[^"'\s]+\.(js|css)/.test(doc.text));
  console.log(`  widget: ${(doc.text.length / 1024).toFixed(0)}KB`);

  await client.close();
}

// ── client with sampling: the server extracts through the host model ────────
{
  let calls = 0;
  const client = await connect({ sampling: {} }, async (req) => {
    calls++;
    const sent = req.params.messages[0].content.text;
    if (calls === 1) {
      check("prompt carries the source", /Source material:/.test(sent));
      check("prompt pins the language", /written in Korean/.test(sent));
      return { model: "fake", role: "assistant", content: { type: "text", text: "nope" } };
    }
    return {
      model: "fake",
      role: "assistant",
      content: { type: "text", text: "```json\n" + CANNED + "\n```" },
    };
  });

  const { tools } = await client.listTools();
  const unfold = tools.find((t) => t.name === "unfold");

  console.log("\n=== sampling ===");
  check("does not ask the model for axes", !("unfolded" in (unfold.inputSchema.properties ?? {})));
  check("keeps the description short", !/Find what the request leaves undecided/.test(unfold.description));

  const r = await client.callTool({
    name: "unfold",
    arguments: { request: "고양이 이미지 만들어줘", source: "샴고양이는 눈이 파랗다." },
  });
  check("retries once on unparseable output", calls === 2);
  check("strips the code fence", r.structuredContent?.unfolded?.axes?.length === 2);
  await client.close();
}

// ── sampling that always fails: generic axes rather than an empty widget ────
{
  const client = await connect({ sampling: {} }, async () => {
    throw new Error("host refused");
  });
  const r = await client.callTool({
    name: "unfold",
    arguments: { request: "Write a launch announcement" },
  });
  const axes = r.structuredContent?.unfolded?.axes ?? [];

  console.log("\n=== sampling always fails ===");
  check("still produces axes", axes.length > 0);
  check("in the request's language", axes[0]?.label === "Purpose");
  await client.close();
}

console.log("\ndone");
