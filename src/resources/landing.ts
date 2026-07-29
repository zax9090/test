/**
 * What you get if you open the server's address in a browser.
 *
 * Both of the addresses a person is likely to try answer badly on their own.
 * The root 404s, and `/mcp` returns a JSON-RPC "must accept text/event-stream"
 * error, because a browser is not an MCP client. Each reads as a broken
 * deployment, and each was read that way in turn.
 *
 * So both serve this page instead, and it hands over the connector URL with the
 * `/mcp` suffix people otherwise leave off.
 *
 * Self-contained and unstyled beyond a few lines: it loads nothing, tracks
 * nothing, and claims nothing about the tool it fronts.
 */

const page = (origin: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>unknown-unknowns</title>
<style>
  :root { color-scheme: light dark; }
  body {
    font: 15px/1.6 system-ui, -apple-system, sans-serif;
    max-width: 34rem;
    margin: 12vh auto 4rem;
    padding: 0 1.5rem;
  }
  h1 { font-size: 1.2rem; margin: 0 0 .4rem; }
  p { margin: 0 0 1.4rem; }
  .muted { opacity: .65; }
  code {
    font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    display: block;
    padding: .7rem .9rem;
    margin: .4rem 0 1.4rem;
    border: 1px solid currentColor;
    border-radius: 6px;
    overflow-wrap: anywhere;
  }
  dt { font-weight: 600; margin-top: .9rem; }
  dd { margin: .1rem 0 0; }
</style>
</head>
<body>
<h1>unknown-unknowns</h1>
<p>
  An MCP server. It takes a request and lays out the things you could still
  decide but haven't, as selectable axes in a widget.
</p>

<p class="muted">
  There is nothing here to look at in a browser — the server speaks MCP, not
  HTML. Add the URL below as a custom connector in a client that supports
  remote MCP.
</p>
<code>${origin}/mcp</code>

<dl class="muted">
  <dt>${origin}/health</dt>
  <dd>Returns <code style="display:inline;border:0;padding:0;margin:0">ok</code> while the server is up.</dd>
</dl>
</body>
</html>
`;

export function landingResponse(origin: string): Response {
  return new Response(page(origin), {
    headers: { "content-type": "text/html;charset=utf-8" },
  });
}
