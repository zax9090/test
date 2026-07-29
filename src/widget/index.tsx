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

import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useApp, useHostStyles } from "@modelcontextprotocol/ext-apps/react-with-deps";

import { assemble, resolveAxes, type Selection, type State } from "../lib/assemble.js";
import { withPreviews, type Fix, type Unfolded } from "../lib/schema.js";
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
  requestId?: string;
  locale?: Locale;
  source?: string;
  canSample?: boolean;
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
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [refolding, setRefolding] = useState(false);

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

  const text = useMemo(
    () => (payload ? assemble(payload.unfolded, state) : ""),
    [payload, state],
  );

  const setAxis = useCallback((axisId: string, value: Selection) => {
    setSelections((prev) => ({ ...prev, [axisId]: value }));
  }, []);

  const toggleSymptom = useCallback((id: string) => {
    setChosenSymptoms((prev) =>
      prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id],
    );
  }, []);

  const applyFix = useCallback((fix: Fix) => {
    setSelections((prev) => ({ ...prev, ...fix.set }));
  }, []);

  /**
   * Rewrite one axis's samples from the current material.
   *
   * Only ever reached from the card's own button. The existing cards are left
   * untouched until new text arrives, so nothing blanks out mid-flight, and a
   * failure returns no samples and changes nothing — quietly, per the brief.
   */
  const runPreview = useCallback(
    async (axisId: string) => {
      if (!app || !payload?.requestId || previewing) return;
      setPreviewing(axisId);

      try {
        const result = await app.callServerTool({
          name: "preview",
          arguments: { requestId: payload.requestId, axisId, source },
        });

        const structured = result.structuredContent as
          | { axisId: string; samples: Record<string, string> }
          | undefined;
        const samples = structured?.samples ?? {};
        if (Object.keys(samples).length === 0) return;

        setPayload((prev) =>
          prev
            ? {
                ...prev,
                unfolded: {
                  ...prev.unfolded,
                  axes: prev.unfolded.axes.map((a) =>
                    a.id === axisId ? withPreviews(a, samples) : a,
                  ),
                },
              }
            : prev,
        );
      } catch {
        // Silent — the cards already on screen stay as they are.
      } finally {
        setPreviewing(null);
      }
    },
    [app, payload?.requestId, previewing, source],
  );

  /**
   * Re-extract the axes around material added since the first pass.
   *
   * Selections are deliberately kept. Axis ids that survive keep their values,
   * and ones that no longer exist are simply ignored — the assembly engine
   * treats an unknown id as untouched rather than throwing, which is exactly
   * what makes it safe to swap the axis set underneath a half-filled widget.
   *
   * Returning nothing changes nothing, quietly, as everywhere else.
   */
  const runRefold = useCallback(async () => {
    if (!app || !payload?.requestId || refolding) return;
    setRefolding(true);

    try {
      const result = await app.callServerTool({
        name: "refold",
        arguments: { requestId: payload.requestId, source },
      });

      const next = (result.structuredContent as { unfolded?: Unfolded } | undefined)?.unfolded;
      if (!next?.axes?.length) return;

      setPayload((prev) => (prev ? { ...prev, unfolded: next, source } : prev));
      setExtrasOpen(false);
    } catch {
      // Keep the axes already on screen.
    } finally {
      setRefolding(false);
    }
  }, [app, payload?.requestId, refolding, source]);

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
   */
  const gotoAxis = useCallback(
    (axisId: string) => {
      const axis = payload?.unfolded.axes.find((a) => a.id === axisId);
      if (axis && axis.group !== "core") setExtrasOpen(true);
      setTab("list");

      // After the fold has rendered, not before.
      requestAnimationFrame(() => {
        rootRef.current
          ?.querySelector(`[data-axis="${CSS.escape(axisId)}"]`)
          ?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    },
    [payload],
  );

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
          {...(app && payload.requestId && payload.canSample && !superseded
            ? { onPreview: runPreview }
            : {})}
          previewing={previewing}
          symptoms={payload.unfolded.symptoms ?? []}
          chosenSymptoms={chosenSymptoms}
          onSymptom={toggleSymptom}
          freeform={freeform}
          onFreeform={setFreeform}
          source={source}
          onSource={setSource}
          {...(app && payload.requestId && payload.canSample && !superseded && source.trim()
          && source.trim() !== (payload.source ?? "").trim()
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
