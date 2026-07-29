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
      /** Text handed to `ui/update-model-context`. */
      context: string[];
      ready: boolean;
    };
    __payload: unknown;
  }
}

window.__harness = { sent: [], toolCalls: [], context: [], ready: false };

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

  // Kept so a stray `callServerTool` would be visible rather than silent — the
  // widget should not be making any.
  bridge.oncalltool = async ({ name, arguments: args }) => {
    window.__harness.toolCalls.push({ name, arguments: args });
    throw new Error(`unexpected server tool call: ${name}`);
  };

  bridge.onupdatemodelcontext = async ({ content }) => {
    window.__harness.context.push(content.map((c: { text?: string }) => c.text ?? "").join(""));
    return {};
  };

  bridge.oninitialized = async () => {
    await bridge.sendToolInput({ arguments: { request: "고양이 이미지 만들어줘" } });
    await bridge.sendToolResult(window.__payload as never);
    window.__harness.ready = true;
  };

  await bridge.connect(transport);
});
