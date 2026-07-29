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
  check("reports preview as unavailable here", payload?.canSample === false);

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

// ── preview ────────────────────────────────────────────────────────────────
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
          { value: "plain", label: "담백하게", emit: "담백한 문체로 쓴다." },
          { value: "warm", label: "부드럽게", emit: "부드러운 문체로 쓴다." },
        ],
      },
    ],
  });

  // One sampling client serving both prompts: extraction first, then the
  // preview. On a sampling host `unfold` has no `unfolded` field — the SDK
  // strips it — so the axes have to come through sampling like they would in
  // real use.
  let asked = "";
  const client = await connect({ sampling: {} }, async (req) => {
    const text = req.params.messages[0].content.text;
    const isPreview = /Write a short sample for each direction/.test(text);
    if (isPreview) asked = text;

    return {
      model: "fake",
      role: "assistant",
      content: {
        type: "text",
        text: isPreview
          ? JSON.stringify({
              samples: { plain: "예산 동결.", warm: "예산은 그대로 갑니다.", ghost: "무시될 것" },
            })
          : SAMPLE_AXES,
      },
    };
  });

  console.log("\n=== preview ===");
  const { tools } = await client.listTools();
  const preview = tools.find((t) => t.name === "preview");
  // The server still lists it; the spec puts the filtering on the host — "Host
  // MUST NOT include tools in the agent's tool list when their visibility does
  // not include model". So what we can assert here is the declaration.
  check("declared app-only", JSON.stringify(preview?._meta?.ui?.visibility) === '["app"]');

  const unfolded = await client.callTool({
    name: "unfold",
    arguments: { request: "회의록을 요약해줘", source: "예산 동결 결정." },
  });
  check("stored the sample axis", unfolded.structuredContent.unfolded.axes[0]?.type === "sample");
  check("reports preview as available here", unfolded.structuredContent.canSample === true);
  check("hands the source back for the widget's box", unfolded.structuredContent.source === "예산 동결 결정.");
  const requestId = unfolded.structuredContent.requestId;

  const r = await client.callTool({
    name: "preview",
    arguments: { requestId, axisId: "voice", source: "예산은 3분기까지 동결." },
  });
  const samples = r.structuredContent?.samples ?? {};
  check("writes a sample per direction", samples.plain === "예산 동결." && samples.warm === "예산은 그대로 갑니다.");
  check("drops directions that do not exist", !("ghost" in samples));
  check("uses the source the widget passed", /3분기까지 동결/.test(asked));
  check("names the directions to the model", /plain: 담백하게/.test(asked));

  const stale = await client.callTool({
    name: "preview",
    arguments: { requestId: "no-such-request", axisId: "voice" },
  });
  check("expired request returns nothing, quietly", Object.keys(stale.structuredContent.samples).length === 0);
  check("and is not an error", stale.isError !== true);

  await client.close();
}

// ── refold ─────────────────────────────────────────────────────────────────
{
  const AXES_A = JSON.stringify({
    title: "a", intent: "회의록을 요약해줘",
    axes: [{ id: "len", label: "분량", group: "core", type: "select",
      options: [{ value: "s", label: "짧게", emit: "짧게 쓴다." }] }],
  });
  const AXES_B = JSON.stringify({
    title: "b", intent: "회의록을 요약해줘",
    axes: [
      { id: "len", label: "분량", group: "core", type: "select",
        options: [{ value: "s", label: "짧게", emit: "짧게 쓴다." }] },
      { id: "speaker", label: "발언자", group: "core", type: "select",
        options: [{ value: "keep", label: "유지", emit: "발언자를 표기한다." }] },
    ],
  });

  let sawSource = "";
  let calls = 0;
  const client = await connect({ sampling: {} }, async (req) => {
    calls++;
    const text = req.params.messages[0].content.text;
    const m = text.match(/Source material:\n([\s\S]*?)(\n\n|$)/);
    if (m) sawSource = m[1].trim();
    return { model: "fake", role: "assistant",
      content: { type: "text", text: calls === 1 ? AXES_A : AXES_B } };
  });

  console.log("\n=== refold ===");
  const { tools } = await client.listTools();
  const refold = tools.find((t) => t.name === "refold");
  check("declared app-only", JSON.stringify(refold?._meta?.ui?.visibility) === '["app"]');
  check("renders no widget of its own", refold?._meta?.ui?.resourceUri === undefined);

  const first = await client.callTool({
    name: "unfold", arguments: { request: "회의록을 요약해줘" },
  });
  const requestId = first.structuredContent.requestId;
  check("starts with one axis", first.structuredContent.unfolded.axes.length === 1);

  const again = await client.callTool({
    name: "refold", arguments: { requestId, source: "예산 동결 논의. 발언자 3명." },
  });
  check("re-extracts around the new material", again.structuredContent.unfolded?.axes?.length === 2);
  check("the material reached the model", /발언자 3명/.test(sawSource));

  // The refreshed store is what a later preview must work from.
  const stale = await client.callTool({
    name: "refold", arguments: { requestId: "no-such-request", source: "x" },
  });
  check("unknown request returns nothing, quietly", stale.structuredContent.unfolded === undefined);
  check("and is not an error", stale.isError !== true);

  await client.close();
}

// ── refold without sampling: nothing, and no error ─────────────────────────
{
  const client = await connect({});
  const r = await client.callTool({
    name: "refold", arguments: { requestId: "anything", source: "자료" },
  });
  console.log("\n=== refold, no sampling ===");
  check("returns nothing", r.structuredContent.unfolded === undefined);
  check("still not an error", r.isError !== true);
  await client.close();
}

// ── preview without sampling: nothing, and no error ────────────────────────
{
  const client = await connect({});
  const r = await client.callTool({
    name: "preview",
    arguments: { requestId: "anything", axisId: "voice" },
  });
  console.log("\n=== preview, no sampling ===");
  check("returns no samples", Object.keys(r.structuredContent.samples).length === 0);
  check("still not an error", r.isError !== true);
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
