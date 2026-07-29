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

import {
  StrictMode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react-with-deps";

import { assemble, resolveAxes, type Selection, type State } from "../lib/assemble.js";
import type { Fix, Unfolded } from "../lib/schema.js";
import type { Locale } from "../lib/locale.js";
import { strings } from "./i18n.js";
import { AxisList } from "./AxisList.js";
import { MapView } from "./MapView.js";
import { Result } from "./Result.js";
import { useWidth } from "./useWidth.js";
import { useSupersession } from "./useSupersession.js";
import { Icon } from "./icons.js";

/** Shared by every instance of this widget, across all of a conversation's turns. */
const CHANNEL = "unknown-unknowns";

/**
 * Below this the map is not drawn at all — the header stands alone.
 *
 * A radial diagram squeezed into a phone-width column is unreadable, and a
 * cramped one is worse than none.
 */
const MAP_MIN_WIDTH = 520;

interface Payload {
  unfolded: Unfolded;
  locale?: Locale;
  source?: string;
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
  const [chosenSymptoms, setChosenSymptoms] = useState<string[]>([]);
  const [freeform, setFreeform] = useState("");
  const [source, setSource] = useState("");
  const [tab, setTab] = useState<"list" | "result">("list");
  const [extrasOpen, setExtrasOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  // Folded by default; the header is what shows until it is opened.
  const [mapOpen, setMapOpen] = useState(false);
  const [refolding, setRefolding] = useState(false);
  // An axis the map asked for, held until its row actually exists in the DOM.
  const [pendingAxis, setPendingAxis] = useState<string | null>(null);

  const rootRef = useRef<HTMLDivElement>(null);
  const width = useWidth(rootRef);
  const superseded = useSupersession(CHANNEL);

  const { app } = useApp({
    appInfo: { name: "unknown-unknowns", version: "0.1.0" },
    capabilities: {},
    autoResize: true,
    onAppCreated: (instance) => {
      instance.ontoolresult = (result) => {
        const next = readPayload(result);
        if (!next) return;
        setPayload(next);
        // Seed the box with the material the request came with, so what is on
        // screen is what gets copied.
        if (next.source) setSource(next.source);
      };
    },
  });

  useHostStyles(app);

  const locale: Locale = payload?.locale ?? "en";
  const t = useMemo(() => strings(locale), [locale]);

  const state: State = useMemo(
    () => ({ selections, symptoms: chosenSymptoms, freeform, source, locale }),
    [selections, chosenSymptoms, freeform, source, locale],
  );

  const resolved = useMemo(
    () => (payload ? resolveAxes(payload.unfolded, state) : []),
    [payload, state],
  );

  const text = useMemo(() => (payload ? assemble(payload.unfolded, state) : ""), [payload, state]);

  const setAxis = useCallback((axisId: string, value: Selection) => {
    setSelections((prev) => ({ ...prev, [axisId]: value }));
  }, []);

  const toggleSymptom = useCallback((id: string) => {
    setChosenSymptoms((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }, []);

  const applyFix = useCallback((fix: Fix) => {
    setSelections((prev) => ({ ...prev, ...fix.set }));
  }, []);

  /**
   * Ask the conversation to unfold the request again, around the new material.
   *
   * There is no way to re-extract in place: that needs a model, and the widget
   * cannot reach one. The model is only ever a *caller* here — it reaches us by
   * invoking a tool, never by answering a question. So the widget puts the
   * material into the model's context and asks, in the user's own words, for
   * another unfolding.
   *
   * What comes back is a new widget with axes fitted to the material. This one
   * then hears the newcomer on the supersession channel and stands down, so the
   * conversation keeps one live widget rather than two that disagree.
   */
  const runRefold = useCallback(async () => {
    if (!app || refolding || !payload) return;
    setRefolding(true);

    try {
      // The material can be long, so it goes to context rather than into a chat
      // bubble; the visible message stays a single readable sentence.
      await app.updateModelContext({
        content: [{ type: "text", text: `${t.refoldContext}\n\n${source.trim()}` }],
      });
      await app.sendMessage({
        role: "user",
        content: [{ type: "text", text: t.refoldAsk(payload.unfolded.intent) }],
      });
      // Left disabled: the answer arrives as a new widget, not as a change here.
    } catch {
      setRefolding(false);
    }
  }, [app, payload, refolding, source, t]);

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

  /**
   * Follow a map node to its axis.
   *
   * The map navigates, it does not edit — so this lands on the row in the list
   * tab, opening the extras fold first if the axis is hiding inside it.
   *
   * The scroll is deferred to a layout effect rather than a frame callback: the
   * row may not exist yet when this runs, and a single `requestAnimationFrame`
   * can land before React has committed the newly unfolded rows. Holding the
   * target in state means the effect simply runs again on the render that
   * finally produces it.
   */
  const gotoAxis = useCallback(
    (axisId: string) => {
      const axis = payload?.unfolded.axes.find((a) => a.id === axisId);
      if (axis && axis.group !== "core") setExtrasOpen(true);
      setTab("list");
      setPendingAxis(axisId);
    },
    [payload],
  );

  useLayoutEffect(() => {
    if (!pendingAxis) return;
    const row = rootRef.current?.querySelector(`[data-axis="${CSS.escape(pendingAxis)}"]`);
    if (!row) return; // Not rendered yet — try again when it is.
    row.scrollIntoView({ block: "center", behavior: "smooth" });
    setPendingAxis(null);
  }, [pendingAxis, extrasOpen, tab, resolved]);

  if (!payload) return <div className="uu-root" ref={rootRef} />;

  const showMap = width >= MAP_MIN_WIDTH;

  return (
    <div className="uu-root" ref={rootRef}>
      {showMap ? (
        <button
          type="button"
          className="uu-header uu-header-btn"
          onClick={() => setMapOpen((v) => !v)}
          aria-expanded={mapOpen}
        >
          <Icon name={mapOpen ? "i-less" : "i-more"} />
          <span className="uu-header-text">{payload.unfolded.intent}</span>
          <span className="uu-maplabel">{t.map}</span>
        </button>
      ) : (
        <div className="uu-header">{payload.unfolded.intent}</div>
      )}

      {showMap && mapOpen ? (
        <MapView
          resolved={resolved}
          intent={payload.unfolded.intent}
          onPick={gotoAxis}
          width={width}
        />
      ) : null}

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
          symptoms={payload.unfolded.symptoms ?? []}
          chosenSymptoms={chosenSymptoms}
          onSymptom={toggleSymptom}
          freeform={freeform}
          onFreeform={setFreeform}
          source={source}
          onSource={setSource}
          {...(app &&
          !superseded &&
          source.trim() &&
          source.trim() !== (payload.source ?? "").trim()
            ? { onRefold: runRefold }
            : {})}
          refolding={refolding}
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
          canSend={Boolean(app) && !superseded}
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
