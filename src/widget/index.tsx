/**
 * Widget entry.
 *
 * All state lives here and never leaves the iframe. The server is stateless
 * about selections; what the user picks is theirs until they copy or send it.
 *
 * Everything visual is inherited from the host — fonts, colours, radii come in
 * as CSS custom properties via `useHostStyles`, so the widget takes the host's
 * light or dark theme without shipping a palette of its own.
 */

import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react-with-deps";

import { assemble, resolveAxes, type Selection, type State } from "../lib/assemble.js";
import type { Fix, Unfolded } from "../lib/schema.js";
import type { Locale } from "../lib/locale.js";
import { strings } from "./i18n.js";
import { AxisList } from "./AxisList.js";
import { Result } from "./Result.js";

interface Payload {
  unfolded: Unfolded;
  requestId?: string;
  locale?: Locale;
}

/**
 * Put text on the clipboard.
 *
 * The async API needs the `clipboard-write` permission, which the resource asks
 * for but the host may not grant. Falls back to the legacy path, then to
 * selecting the text so the user can copy it by hand. Failure is silent — the
 * brief allows no error banner.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through.
  }

  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Pull the payload out of a tool result, whichever slot the host filled. */
function readPayload(result: { structuredContent?: unknown; content?: unknown }): Payload | null {
  const structured = result.structuredContent as Payload | undefined;
  if (structured?.unfolded?.axes) return structured;

  const content = result.content as Array<{ type?: string; text?: string }> | undefined;
  const text = content?.find((c) => c.type === "text")?.text;
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as Payload | Unfolded;
    if ("unfolded" in parsed && parsed.unfolded?.axes) return parsed as Payload;
    if ("axes" in parsed && Array.isArray(parsed.axes)) return { unfolded: parsed as Unfolded };
  } catch {
    // Not JSON — nothing to render.
  }
  return null;
}

function App() {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [selections, setSelections] = useState<Record<string, Selection>>({});
  const [freeform, setFreeform] = useState("");
  const [source, setSource] = useState("");
  const [tab, setTab] = useState<"list" | "result">("list");
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { app } = useApp({
    appInfo: { name: "unknown-unknowns", version: "0.1.0" },
    capabilities: {},
    autoResize: true,
    onAppCreated: (instance) => {
      instance.ontoolresult = (result) => {
        const next = readPayload(result);
        if (next) setPayload(next);
      };
    },
  });

  useHostStyles(app);

  const locale: Locale = payload?.locale ?? "en";
  const t = useMemo(() => strings(locale), [locale]);

  const state: State = useMemo(
    () => ({ selections, freeform, source, locale }),
    [selections, freeform, source, locale],
  );

  const resolved = useMemo(
    () => (payload ? resolveAxes(payload.unfolded, state) : []),
    [payload, state],
  );

  const text = useMemo(
    () => (payload ? assemble(payload.unfolded, state) : ""),
    [payload, state],
  );

  const setAxis = useCallback((axisId: string, value: Selection) => {
    setSelections((prev) => ({ ...prev, [axisId]: value }));
  }, []);

  const applyFix = useCallback((fix: Fix) => {
    setSelections((prev) => ({ ...prev, ...fix.set }));
  }, []);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(text);
    if (ok) setCopied(true);
  }, [text]);

  // `ui/message` has no insert-without-running form — the host delivers it as a
  // turn and answers it. The button is named for what it actually does rather
  // than promising a composer prefill the protocol cannot give.
  // See docs/stage0-conflicts.md (C2).
  const handleSend = useCallback(() => {
    void app?.sendMessage({ role: "user", content: [{ type: "text", text }] });
  }, [app, text]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!payload) return <div className="uu-root" />;

  return (
    <div className="uu-root">
      <div className="uu-header">{payload.unfolded.intent}</div>

      <div className="uu-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "list"}
          className={`uu-tab${tab === "list" ? " is-on" : ""}`}
          onClick={() => setTab("list")}
        >
          {t.tabList}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "result"}
          className={`uu-tab${tab === "result" ? " is-on" : ""}`}
          onClick={() => setTab("result")}
        >
          {t.tabResult}
        </button>
      </div>

      {/* Both tabs stay mounted so switching keeps scroll and open/closed folds. */}
      <div hidden={tab !== "list"}>
        <AxisList
          resolved={resolved}
          onChange={setAxis}
          freeform={freeform}
          onFreeform={setFreeform}
          source={source}
          onSource={setSource}
          extrasOpen={extrasOpen}
          onToggleExtras={() => setExtrasOpen((v) => !v)}
          t={t}
        />
      </div>

      <div hidden={tab !== "result"}>
        <Result
          text={text}
          resolved={resolved}
          fixes={payload.unfolded.fixes ?? []}
          onChange={setAxis}
          onApplyFix={applyFix}
          onCopy={handleCopy}
          onSend={handleSend}
          copied={copied}
          canSend={Boolean(app)}
          t={t}
        />
      </div>
    </div>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
