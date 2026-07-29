/**
 * Host side of the widget test harness.
 *
 * Drives the real `ui/` handshake with `AppBridge` — the same class a compliant
 * host uses — so the widget is exercised over the actual protocol rather than by
 * poking its internals. Loaded by scripts/build-widget-harness.mjs.
 */

import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-with-deps";

declare global {
  interface Window {
    __harness: {
      sent: Array<{ role: string; text: string }>;
      toolCalls: Array<{ name: string; arguments: unknown }>;
      ready: boolean;
    };
    __payload: unknown;
    /** Canned `preview` reply. `null` makes the call fail, for the silent path. */
    __previewReply: Record<string, string> | null;
    /** Canned `refold` reply. `null` makes the call fail. */
    __refoldReply: unknown;
    /** Held open until released, to observe what the widget shows mid-flight. */
    __holdPreview: boolean;
  }
}

window.__harness = { sent: [], toolCalls: [], ready: false };

// Defaults only. A test's init script runs before this file, so overwriting
// unconditionally would wipe whatever it set up.
if (!("__previewReply" in window)) window.__previewReply = null;
if (!("__refoldReply" in window)) window.__refoldReply = null;
if (!("__holdPreview" in window)) window.__holdPreview = false;

const iframe = document.createElement("iframe");
iframe.id = "app";
iframe.style.cssText = "width:640px;height:900px;border:0;display:block";
// The real host sandboxes this. `allow-scripts` plus same-origin is enough to
// exercise the widget; the CSP behaviour is the host's job, not the widget's.
iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
iframe.src = "./widget.html";
document.body.append(iframe);

iframe.addEventListener("load", async () => {
  const transport = new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!);

  const bridge = new AppBridge(
    null,
    { name: "harness", version: "0.0.0" },
    {
      openLinks: {},
      logging: {},
      message: {},
      updateModelContext: {},
      serverTools: {},
    },
  );

  // `ui/message` is what the send button uses; record it instead of echoing it
  // into a conversation that does not exist here.
  bridge.onmessage = async ({ role, content }) => {
    window.__harness.sent.push({
      role,
      text: content.map((c) => ("text" in c ? c.text : "")).join(""),
    });
    return {};
  };

  // Stands in for the MCP server the host would proxy `callServerTool` to.
  bridge.oncalltool = async ({ name, arguments: args }) => {
    window.__harness.toolCalls.push({ name, arguments: args });

    while (window.__holdPreview) {
      await new Promise((r) => setTimeout(r, 20));
    }

    if (name === "refold") {
      if (window.__refoldReply === null) throw new Error("no refold available");
      const payload = { unfolded: window.__refoldReply };
      return {
        content: [{ type: "text", text: JSON.stringify(payload) }],
        structuredContent: payload,
      };
    }

    if (name !== "preview" || window.__previewReply === null) {
      throw new Error("no preview available");
    }

    const payload = {
      axisId: (args as { axisId: string }).axisId,
      samples: window.__previewReply,
    };
    return {
      content: [{ type: "text", text: JSON.stringify(payload) }],
      structuredContent: payload,
    };
  };

  bridge.oninitialized = async () => {
    await bridge.sendToolInput({ arguments: { request: "고양이 이미지 만들어줘" } });
    await bridge.sendToolResult(window.__payload as never);
    window.__harness.ready = true;
  };

  await bridge.connect(transport);
});
