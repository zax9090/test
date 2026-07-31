# unknown-unknowns

An MCP server with a widget that takes one request and lays out **what it leaves undecided**.

People asking an AI for something usually do have preferences — they just don't realise a
particular detail was theirs to state.

```
"draw me a cat"      → a white cat, sitting
"no, black"          → a black cat, sitting
"lying down"         → ...
```

Black and lying-down were in their head the whole time. They didn't know those were things
to say. `unfold` shows the choices up front, the user picks the ones they care about, and
the result is a prompt they can copy or send.

---

## When the tool fires

`unfold` is meant for requests open-ended enough that a model would otherwise guess at
details the user has an opinion about — an image, a piece of writing, a design, a plan. It
also fires when asked for by name ("unfold this", "정리해줘", "뭘 정해야 하지").

It is meant **not** to fire when the request is already specific, when the user asked a
factual question, or when they clearly want the work done rather than scoped. Answering a
concrete request with a widget is a worse answer.

That decision belongs to the calling model, guided by the tool description — the server
cannot force it either way.

## Before and after

**Before** — the request goes as written and the model fills the gaps silently:

> 회의록 요약해줘

**After** — the widget lays out the axes, the user decides the two or three they care
about, and this is what gets sent:

```
회의록 요약해줘
팀 공유용 진행 상황 정리

독자는 팀 전체.
결론을 먼저 쓴다.
본문은 5문장 이내로 쓴다.
```

Anything left undecided contributes nothing. Turning more axes on never makes the prompt
longer than what was actually chosen.

---

## What it does

### Axis types

| Type | For | Control |
|---|---|---|
| `open` | Values that cannot be listed exhaustively — coat colour, tone, audience | Input box, with a few examples underneath |
| `closed` | Values that genuinely are a complete list — aspect ratio | Chips, single choice |
| `multi` | Several at once | Chips, multiple choice |
| `range` | Anything continuous — size, count, duration | Number input |

`open` is the default when it is unclear. Closing an axis hides values the user wanted;
opening one that could have been closed costs only a little redundancy.

Pressing an example emits the sentence the model wrote for it, reason included. Typing your
own emits the axis template instead — the model's reason belongs to the model's option, not
to your wording.

### Goal

When a request can be read several ways, the model picks the likeliest reading, builds the
axes for it, and hands back the readings it did not take. Nothing stops to ask first.
Switching the reading rebuilds the axes.

### Sections and the structure board

Axes are grouped into named sections the model writes per request. The **Structure** tab
shows those sections as a card board:

- one card per section, with a decided-of-total count
- one row per axis: its name, its state, and what it currently holds
- states are `Undecided` / `Default` / `Chosen` / `Several chosen` / `Not applicable` /
  `Conflict`, always as words plus an icon, never colour alone
- selecting a row opens a detail panel — beside the board at 720px and wider, as a
  full-width screen below that

The board and the list share one selection state. A change in either appears in the other
immediately.

### Dependencies between axes

Axes are not independent, and the model can say so:

- `showIf` — an axis that stops *applying*. A tech stack is not a question about a plan
  document, so it is not drawn, and it contributes nothing to the prompt.
- `conflicts` — two values that cannot both hold, with a reason. Both rows dim and the
  reason appears **at the moment of choosing**. It is never blocked: the tool informs, it
  does not refuse.
- `derivedFrom` — one axis settles another.

### Presets

Saved settings for repeat work — the goal, the axis structure and the chosen values.
**Available only when the server runs locally**, because presets are a file on your own
disk and a Cloudflare Worker has no filesystem. On the remote server the preset tools are
not registered and no preset UI is drawn.

The source material is never part of a preset. See *Privacy* below.

---

## Using it

### As a remote MCP server

Deploy it (below), then add the deployed URL with the `/mcp` suffix as a custom connector.
Opening either the root or `/mcp` in a browser serves a page showing the connector URL.

This repository ships no hosted instance; the URL is whatever your own deploy produces.

### Locally, with presets

The local server speaks stdio and stores presets in a file:

```
~/.unknown-unknowns/presets.json      # override the directory with UNKNOWN_UNKNOWNS_HOME
```

`src/local/server.ts` is the entry point. There is no packaged bundle yet — see
*Limitations*.

---

## Development

```bash
npm install

npm run dev            # build the widget, then wrangler dev
npm run build:widget   # bundle the widget into src/generated/
npm run typecheck      # three projects: Worker, widget, local
npm test               # unit tests (vitest)
npm run test:widget    # Playwright, against the real ui/ handshake
npm run test:all       # format check + typecheck + both suites
npm run format         # prettier
```

`npm run test:widget` needs a Chromium; CI installs one with
`npx playwright install --with-deps chromium`.

There is also a manual end-to-end check against a running server, kept out of `npm test`
because it needs something to talk to:

```bash
npm run build:widget && npx wrangler dev --port 8788
node scripts/smoke.mjs http://127.0.0.1:8788
```

### Deploying to Cloudflare Workers

```bash
npm run deploy         # build:widget && wrangler deploy
```

`wrangler.toml` declares a SQLite-backed Durable Object for MCP sessions, which works on
the Workers free plan. Deploying needs your own Cloudflare account and a Workers API token.
This repository contains no credentials and no account identifiers.

### Status endpoint

```
GET /health   → {"status":"ok","name":"unknown-unknowns","version":"0.1.0"}
```

`commit` is included when the build supplied one. The same object is attached to `unfold`
results as `structuredContent.server`, so a deployed instance can be identified from its
own output. Nothing else about the environment is exposed.

---

## Architecture

```
src/
  server.ts         Worker entry: routes / , /health , /mcp
  session.ts        one Durable Object per MCP session
  build-server.ts   builds the McpServer — shared by both entry points
  local/            stdio entry point + the preset file store (the only node APIs)
  tools/            unfold, presets
  lib/              schema, assemble, prompt, sampling, locale, preset
  widget/           the iframe app (React via preact/compat)
```

Two deployment shapes from one codebase: a remote Worker that keeps nothing, and a local
stdio server that additionally has presets. `buildServer` is shared, so the two cannot
drift into offering different tools.

The widget is one self-contained HTML document with everything inlined — the iframe's CSP
blocks external loads, so a CDN reference would render a blank rectangle.

### With and without sampling

The server never calls a model of its own.

- **Host implements MCP sampling**: the server asks the host's model for the axes through
  `sampling/createMessage`.
- **Host does not** — which is every Claude surface today: the extraction instruction rides
  in the tool description instead, and the calling model supplies the axes as a tool
  argument. The widget renders the same either way.

If parsing fails it retries once, then falls back to five generic axes (purpose, audience,
length, format, tone). An empty widget never reaches the user.

## Privacy

- The server **does not store the request or the source material** anywhere, and does not
  log them. Widget state lives in the iframe and travels in tool results.
- Presets store the goal, the axis structure and the chosen values — never the source
  material. Everything written passes through `stripMaterial`, which walks the payload at
  every depth and removes `source` **and** `preview` (previews are written *from* the
  user's document, so keeping one would keep the document). A test asserts on the bytes on
  disk, not on a field.
- Presets are a file on your own machine. The remote Worker has no storage at all.

## Accessibility and responsive behaviour

- Every board row is a button, reachable and operable by keyboard, with a visible focus
  ring.
- Opening the detail panel moves focus into it; Escape or the close button dismisses it,
  and focus returns to the row it came from.
- State is always words plus an icon, never colour alone.
- Verified at 360, 480, 720 and 1024px with no horizontal scroll. Board touch targets are
  at least 44px tall.
- `prefers-reduced-motion` is respected. No shadows, gradients or animation.
- Fonts, colours and radii are inherited from the host as CSS custom properties, so light
  and dark both work without a palette of our own.
- Widget chrome is Korean or English; anything else falls back to English. Axis labels come
  from the model in whatever language the request was written in.

## Limitations

- **Not yet verified inside a real Claude client.** Widget rendering, dark mode, the
  clipboard permission and axis quality have been exercised only through the test harness
  and a local server.
- **No MCPB package.** The local server runs via `node` against the built source; there is
  no packaged bundle or install flow.
- Presets exist only on the local server.
- Sampling is implemented, but no Claude surface currently supports it, so that path is
  covered only by tests and the smoke script.
- Whether the model calls — and declines to call — the tool at the right times can only be
  observed in a real client.

## License

MIT. See [LICENSE](LICENSE).
