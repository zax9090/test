/**
 * Manual end-to-end check of the `unfold` tool over real MCP.
 *
 * Not part of `npm test` — it needs a server running:
 *
 *   npx wrangler dev --port 8788 --local
 *   node scripts/smoke.mjs
 *
 * Covers the four routes that matter: a client without sampling gets the host
 * instruction, the second leg turns that JSON into axes, a sampling client
 * exercises the retry and fence-stripping, and a client whose sampling always
 * fails still ends up with axes rather than an empty widget.
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
        { value: "black", label: "검정", emit: "털색은 검은색으로, 밝은 배경과 대비되게 한다.", common: true },
        { value: "white", label: "흰색", emit: "털색은 흰색으로 한다." },
      ],
    },
    {
      id: "pose",
      label: "자세",
      group: "core",
      type: "select",
      options: [
        { value: "lying", label: "누움", emit: "누워 있는 자세로 그린다." },
        { value: "sitting", label: "앉음", emit: "앉아 있는 자세로 그린다." },
      ],
    },
    {
      // Deliberately malformed: no label. Must be dropped, not fatal.
      id: "broken",
      group: "extra",
      type: "select",
      options: [],
    },
    {
      id: "size",
      label: "크기",
      group: "extra",
      type: "range",
      range: { unit: "px", min: 256, max: 2048, emitTemplate: "가로 {value}px로 만든다." },
    },
  ],
  fixes: [{ label: "단색 배경", set: { bg: "plain" } }],
});

async function connect(caps, onSampling) {
  const client = new Client({ name: "smoke", version: "0.0.0" }, { capabilities: caps });
  if (onSampling) client.setRequestHandler(CreateMessageRequestSchema, onSampling);
  await client.connect(new StreamableHTTPClientTransport(URL_));
  return client;
}

function head(s, n = 240) {
  return s.length > n ? s.slice(0, n) + " …" : s;
}

// ── 1. no sampling capability → host-fallback instruction ────────────────────
{
  const client = await connect({});
  const tools = await client.listTools();
  console.log("[tools]", tools.tools.map((t) => t.name).join(", "));
  console.log("[desc first line]", tools.tools[0].description.split("\n")[0]);

  const r = await client.callTool({
    name: "unfold",
    arguments: { request: "고양이 이미지 만들어줘" },
  });
  const text = r.content[0].text;
  console.log("\n=== 1. NO SAMPLING → fallback instruction ===");
  console.log("asks host to re-call:", /call `unfold` again/.test(text));
  console.log("language pinned to Korean:", /in Korean/.test(text));
  console.log(head(text, 200));
  await client.close();
}

// ── 2. second leg: host supplies the JSON ────────────────────────────────────
{
  const client = await connect({});
  const r = await client.callTool({
    name: "unfold",
    arguments: { request: "고양이 이미지 만들어줘", unfolded: CANNED },
  });
  const parsed = JSON.parse(r.content[0].text);
  console.log("\n=== 2. SECOND LEG (unfolded=JSON) ===");
  console.log("axes:", parsed.axes.map((a) => `${a.label}(${a.group}/${a.type})`).join(", "));
  console.log("malformed axis dropped:", !parsed.axes.some((a) => a.id === "broken"));
  console.log("requestId:", r.structuredContent?.requestId?.slice(0, 8), "locale:", r.structuredContent?.locale);
  await client.close();
}

// ── 3. sampling capability → server borrows the host model ───────────────────
{
  let sampled = 0;
  const client = await connect({ sampling: {} }, async (req) => {
    sampled++;
    const sent = req.params.messages[0].content.text;
    if (sampled === 1) {
      console.log("\n=== 3. SAMPLING ===");
      console.log("prompt carries source:", /Source material:/.test(sent));
      console.log("prompt bans fences:", /No code fence/.test(sent));
      // First reply is garbage, to exercise the single retry.
      return { model: "fake", role: "assistant", content: { type: "text", text: "sorry, no." } };
    }
    // Second reply wrapped in a fence, to exercise fence stripping.
    return {
      model: "fake",
      role: "assistant",
      content: { type: "text", text: "```json\n" + CANNED + "\n```" },
    };
  });

  const r = await client.callTool({
    name: "unfold",
    arguments: { request: "고양이 이미지 만들어줘", source: "샴고양이는 눈이 파랗다." },
  });
  const parsed = JSON.parse(r.content[0].text);
  console.log("sampling calls (1 = retry used):", sampled);
  console.log("axes after retry+fence-strip:", parsed.axes.map((a) => a.label).join(", "));
  await client.close();
}

// ── 4. sampling that always fails → generic fallback axes, never empty ───────
{
  const client = await connect({ sampling: {} }, async () => {
    throw new Error("host refused");
  });
  const r = await client.callTool({
    name: "unfold",
    arguments: { request: "Write a launch announcement" },
  });
  const parsed = JSON.parse(r.content[0].text);
  console.log("\n=== 4. SAMPLING ALWAYS FAILS → generic fallback ===");
  console.log("axes:", parsed.axes.map((a) => a.label).join(", "));
  console.log("never empty:", parsed.axes.length > 0);
  console.log("english request → english axes:", parsed.axes[0].label === "Purpose");
  await client.close();
}

console.log("\nOK");
