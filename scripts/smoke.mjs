/**
 * Manual end-to-end check of the MCP server over real MCP.
 *
 * Not part of `npm test` — it needs a server to talk to. Locally:
 *
 *   npm run build:widget && npx wrangler dev --port 8788 --local
 *   node scripts/smoke.mjs
 *
 * Or against a deployed Worker, to confirm the remote behaves like the local one:
 *
 *   node scripts/smoke.mjs https://unknown-unknowns.<subdomain>.workers.dev/mcp
 *
 * Checks that `unfold` takes the right shape for each kind of client, that both
 * extraction routes end in axes, and that the widget resource is actually
 * served at the URI the tool points at.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CreateMessageRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const target = process.argv[2] ?? "http://127.0.0.1:8788/mcp";
// Accept a bare origin too, since that is what a deploy prints.
const URL_ = new URL(target.endsWith("/mcp") ? target : new URL("/mcp", target).href);
console.log(`→ ${URL_.href}\n`);

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

// ── the address a person opens in a browser ────────────────────────────────
{
  console.log("=== root ===");
  const res = await fetch(URL_.origin);
  const html = await res.text();
  check("serves a page rather than a 404", res.status === 200);
  // The whole point of the page: it hands over the URL with the /mcp suffix.
  check("hands over the connector URL", html.includes(`${URL_.origin}/mcp`));

  const health = await fetch(`${URL_.origin}/health`);
  check("health says ok", (await health.text()).trim() === "ok");
}

// ── client without sampling: the model is asked to supply the axes ──────────
{
  const client = await connect({});
  const { tools } = await client.listTools();
  const unfold = tools.find((t) => t.name === "unfold");

  console.log("\n=== no sampling ===");
  check("tool is registered", Boolean(unfold));
  check(
    "declares a widget resource",
    unfold._meta?.ui?.resourceUri === "ui://unknown-unknowns/widget.html",
  );
  check("asks the model for `unfolded`", "unfolded" in (unfold.inputSchema.properties ?? {}));
  check(
    "carries the extraction instruction",
    /Find what the request leaves undecided/.test(unfold.description),
  );
  check("tells Claude when not to call it", /Do NOT call this/.test(unfold.description));

  const r = await client.callTool({
    name: "unfold",
    arguments: { request: "고양이 이미지 만들어줘", unfolded: CANNED },
  });
  const payload = r.structuredContent;
  check("returns axes", payload?.unfolded?.axes?.length === 2);
  check("drops the malformed axis", !payload.unfolded.axes.some((a) => a.id === "broken"));
  check("detects the locale", payload?.locale === "ko");
  check("carries no server-side handle", payload?.requestId === undefined);

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
  check(
    "keeps the description short",
    !/Find what the request leaves undecided/.test(unfold.description),
  );

  const r = await client.callTool({
    name: "unfold",
    arguments: { request: "고양이 이미지 만들어줘", source: "샴고양이는 눈이 파랗다." },
  });
  check("retries once on unparseable output", calls === 2);
  check("strips the code fence", r.structuredContent?.unfolded?.axes?.length === 2);
  await client.close();
}

// ── sample axes come with their text already written ───────────────────────
{
  const SAMPLE_AXES = JSON.stringify({
    title: "요약",
    intent: "회의록을 요약해줘",
    axes: [
      {
        id: "voice",
        label: "문체",
        group: "core",
        type: "sample",
        options: [
          { value: "plain", label: "담백하게", emit: "담백한 문체로 쓴다.", preview: "예산 동결." },
          { value: "warm", label: "부드럽게", emit: "부드러운 문체로 쓴다." },
        ],
      },
    ],
  });

  const client = await connect({});
  console.log("\n=== sample axes ===");

  const { tools } = await client.listTools();
  // The model reaches us only by calling a tool, so there is exactly one to call.
  check("only unfold is exposed", tools.map((t) => t.name).join(",") === "unfold");

  const r = await client.callTool({
    name: "unfold",
    arguments: { request: "회의록을 요약해줘", source: "예산 동결 결정.", unfolded: SAMPLE_AXES },
  });
  const axis = r.structuredContent.unfolded.axes[0];
  check("sample axis survives", axis?.type === "sample");
  check("its text arrives with the axes", axis.options[0].preview === "예산 동결.");
  check(
    "hands the source back for the widget's box",
    r.structuredContent.source === "예산 동결 결정.",
  );
  check("mints no request id — nothing is stored", r.structuredContent.requestId === undefined);
  check(
    "the extraction instruction asks for that text",
    /give every option a/.test(tools[0].description),
  );

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
