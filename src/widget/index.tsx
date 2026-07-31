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

import {
  assemble,
  describeSelection,
  findConflicts,
  resolveAxes,
  type Selection,
  type State,
} from "../lib/assemble.js";
import { USER_AXIS_TEMPLATE, type AxisState, type Fix, type Unfolded } from "../lib/schema.js";
import type { Locale } from "../lib/locale.js";
import { strings } from "./i18n.js";
import { AxisList } from "./AxisList.js";
import { GoalField } from "./GoalField.js";
import { LivePreview } from "./LivePreview.js";
import { PresetBar, PresetSave, usePresets } from "./PresetBar.js";
import { BoardView } from "./BoardView.js";
import { Result } from "./Result.js";
import { useWidth } from "./useWidth.js";
import { useSupersession } from "./useSupersession.js";

/** Shared by every instance of this widget, across all of a conversation's turns. */
const CHANNEL = "unknown-unknowns";

/**
 * The three surfaces, all sharing one selection state.
 *
 * `board` replaced a radial map that had to be hidden below 520px — most of a
 * chat column — and answered relationship questions nobody was asking. The board
 * answers the status question instead and works at every width.
 */
type Tab = "list" | "board" | "result";

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
  if (structured?.unfolded?.sections?.length) return structured;

  const content = result.content as Array<{ type?: string; text?: string }> | undefined;
  const text = content?.find((c) => c.type === "text")?.text;
  if (!text) return null;

  try {
    const parsed = JSON.parse(text) as Payload | Unfolded;
    if ("unfolded" in parsed && parsed.unfolded?.sections?.length) return parsed as Payload;
    if ("sections" in parsed && Array.isArray(parsed.sections)) {
      return { unfolded: parsed as Unfolded };
    }
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
  const [tab, setTab] = useState<Tab>("list");
  const [copied, setCopied] = useState(false);
  // Axis open in the board's detail panel. Held here, not in the board, so
  // returning to the tab keeps the panel where it was.
  const [selectedAxis, setSelectedAxis] = useState<string | null>(null);
  const [refolding, setRefolding] = useState(false);
  const [switchingGoal, setSwitchingGoal] = useState(false);
  // Values a preset supplied. Held apart from `selections` so they can read as
  // decided-for-you until the user actually touches one.
  const [loaded, setLoaded] = useState<Record<string, Selection>>({});
  const [loadedFrom, setLoadedFrom] = useState<{ id: string; name: string } | undefined>();
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetReload, setPresetReload] = useState(0);
  // Which correction button filled the current values, if one did.
  const [fixApplied, setFixApplied] = useState<string | undefined>();
  // Set by `proceed`, cleared once the send has actually gone out. The send has to
  // wait a render: the delegation above must be in `state` before the text is built.
  const [proceeding, setProceeding] = useState(false);

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
    () => ({ selections, loaded, symptoms: chosenSymptoms, freeform, source, locale }),
    [selections, loaded, chosenSymptoms, freeform, source, locale],
  );

  const resolved = useMemo(
    () => (payload ? resolveAxes(payload.unfolded, state) : []),
    [payload, state],
  );

  const text = useMemo(() => (payload ? assemble(payload.unfolded, state) : ""), [payload, state]);

  // Contradictions and inapplicable axes are recomputed from the same resolved
  // list the rows render from, so what is dimmed and what is said cannot drift.
  const conflicts = useMemo(
    () => (payload ? findConflicts(payload.unfolded, resolved) : []),
    [payload, resolved],
  );

  const openCount = useMemo(
    () =>
      resolved.filter((r) => r.applicable && r.status === "unset" && r.state.kind === "none")
        .length,
    [resolved],
  );

  const hidden = useMemo(
    () => new Set(resolved.filter((r) => !r.applicable).map((r) => r.axis.id)),
    [resolved],
  );

  const setAxis = useCallback((axisId: string, next: AxisState) => {
    setSelections((prev) => ({ ...prev, [axisId]: next }));
  }, []);

  /**
   * Add an empty axis to a section.
   *
   * A user axis has no options, no norm and no default — inventing a usual value
   * for an item the model never thought of would be making it up. Its sentence is
   * assembled from `{label}: {value}` with no particle handling, which is the one
   * form that is safe in any language and against any value the user types.
   *
   * The label is empty on purpose: the row appears with the cursor in it. An axis
   * with no label contributes nothing, so an abandoned one costs nothing either.
   */
  const addAxis = useCallback((sectionId: string) => {
    setPayload((prev) => {
      if (!prev) return prev;
      const id = `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

      return {
        ...prev,
        unfolded: {
          ...prev.unfolded,
          sections: prev.unfolded.sections.map((section) =>
            section.id === sectionId
              ? {
                  ...section,
                  axes: [
                    ...section.axes,
                    {
                      id,
                      label: "",
                      type: "open" as const,
                      emitTemplate: USER_AXIS_TEMPLATE,
                      origin: "user" as const,
                    },
                  ],
                }
              : section,
          ),
        },
      };
    });
  }, []);

  /** Only user axes are removable. A model axis is emptied, which needs no undo. */
  const removeAxis = useCallback((axisId: string) => {
    setPayload((prev) =>
      prev
        ? {
            ...prev,
            unfolded: {
              ...prev.unfolded,
              sections: prev.unfolded.sections.map((section) => ({
                ...section,
                axes: section.axes.filter((a) => a.id !== axisId),
              })),
            },
          }
        : prev,
    );
    setSelections((prev) => {
      const next = { ...prev };
      delete next[axisId];
      return next;
    });
  }, []);

  const addSection = useCallback((label: string) => {
    setPayload((prev) =>
      prev
        ? {
            ...prev,
            unfolded: {
              ...prev.unfolded,
              sections: [
                ...prev.unfolded.sections,
                {
                  id: `user-section-${Date.now().toString(36)}`,
                  label,
                  axes: [],
                  origin: "user" as const,
                },
              ],
            },
          }
        : prev,
    );
  }, []);

  const toggleSymptom = useCallback((id: string) => {
    setChosenSymptoms((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }, []);

  // A fix names option values, so each entry becomes a pressed chip rather than
  // typed text — the sentence it emits is the model's, reason included.
  const applyFix = useCallback((fix: Fix) => {
    setSelections((prev) => {
      const next = { ...prev };
      for (const [axisId, value] of Object.entries(fix.set)) {
        next[axisId] = value;
      }
      return next;
    });
    setFixApplied(fix.label);
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

  /**
   * Switch the reading the axes were built for.
   *
   * Same shape as refold, and for the same reason: the answer is a different set
   * of axes, which is a different widget. Asking the conversation is the one route
   * that does not depend on the model calling a tool it has never seen — see
   * docs/stage0-conflicts.md (C8). The old widget stands down on supersession.
   *
   * Left disabled afterwards on purpose. The reply does not come back here.
   */
  const runGoalSwitch = useCallback(
    async (reading: string) => {
      if (!app || switchingGoal || !payload) return;
      setSwitchingGoal(true);

      try {
        await app.sendMessage({
          role: "user",
          content: [{ type: "text", text: t.goalAsk(payload.unfolded.intent, reading) }],
        });
      } catch {
        setSwitchingGoal(false);
      }
    },
    [app, payload, switchingGoal, t],
  );

  /**
   * Call one of the app-only preset tools.
   *
   * Undefined where there is no app yet. A rejection is the expected answer on the
   * remote Worker, where these tools are not registered at all — callers treat that
   * as "no presets" rather than as an error, because storage being unavailable must
   * never disturb the part that never needed storage.
   */
  const callPreset = useMemo(
    () =>
      app
        ? async (name: string, args: Record<string, unknown> = {}) => {
            const result = await app.callServerTool({ name, arguments: args });
            return (result as { structuredContent?: unknown }).structuredContent;
          }
        : undefined,
    [app],
  );

  const presets = usePresets(callPreset, presetReload);

  /**
   * Replace the axes with a saved set. No model call — they are already written.
   *
   * The stored values land in `loaded`, not in `selections`, so every one of them
   * shows as decided-for-you until the user touches it. Touching one promotes that
   * axis to their own choice and leaves the rest alone.
   */
  const loadPreset = useCallback(
    async (id: string) => {
      if (!callPreset || presetBusy) return;
      setPresetBusy(true);

      try {
        const result = (await callPreset("load_preset", { id })) as
          | {
              found?: boolean;
              preset?: { id: string; name: string };
              unfolded?: Unfolded;
              selections?: Record<string, Selection>;
              symptoms?: string[];
              locale?: Locale;
            }
          | undefined;

        if (result?.found && result.unfolded?.sections?.length) {
          setPayload({ unfolded: result.unfolded, locale: result.locale });
          setSelections({});
          setLoaded(result.selections ?? {});
          setChosenSymptoms(result.symptoms ?? []);
          setFreeform("");
          // The material is the one thing a preset never carries, and the one
          // thing that changes between runs. The box stays empty on purpose.
          setSource("");
          setLoadedFrom(result.preset);
          setFixApplied(undefined);
        }
      } catch {
        // No preset tools on this server, or the preset is gone. Nothing changes.
      } finally {
        setPresetBusy(false);
      }
    },
    [callPreset, presetBusy],
  );

  const savePreset = useCallback(
    async (name: string, overwriteId?: string) => {
      if (!callPreset || !payload || presetBusy) return;
      setPresetBusy(true);

      try {
        // Only the axes and the values travel. The source box is not passed at
        // all — there is no argument for it to arrive in.
        const result = (await callPreset("save_preset", {
          name,
          unfolded: JSON.stringify(payload.unfolded),
          selections: JSON.stringify({ ...loaded, ...selections }),
          ...(chosenSymptoms.length ? { symptoms: chosenSymptoms } : {}),
          ...(overwriteId ? { overwriteId } : {}),
        })) as { saved?: boolean; id?: string; name?: string } | undefined;

        if (result?.saved && result.id) {
          setLoadedFrom({ id: result.id, name: result.name ?? name });
          setPresetReload((n) => n + 1);
        }
      } catch {
        // Nothing to say — the brief allows no error banner.
      } finally {
        setPresetBusy(false);
      }
    },
    [callPreset, payload, presetBusy, loaded, selections, chosenSymptoms],
  );

  const deletePreset = useCallback(
    async (id: string) => {
      if (!callPreset || presetBusy) return;
      setPresetBusy(true);

      try {
        await callPreset("delete_preset", { id });
        if (loadedFrom?.id === id) setLoadedFrom(undefined);
        setPresetReload((n) => n + 1);
      } catch {
        // Nothing changes.
      } finally {
        setPresetBusy(false);
      }
    },
    [callPreset, presetBusy, loadedFrom],
  );

  /**
   * Send without deciding the rest.
   *
   * The axes still blank are handed to the AI *explicitly* — pressing this is the
   * user saying so, and the model should receive it as a decision rather than as
   * a gap. Anything already standing in from a `default` or a preset is left
   * alone: "go with this" means go with what is on screen, and those values are
   * on screen.
   */
  const proceed = useCallback(() => {
    setSelections((prev) => {
      const next = { ...prev };
      for (const entry of resolved) {
        if (entry.applicable && entry.status === "unset" && entry.state.kind === "none") {
          next[entry.axis.id] = { kind: "delegated" };
        }
      }
      return next;
    });
    setProceeding(true);
  }, [resolved]);

  const handleCopy = useCallback(async () => {
    const ok = await copyText(text);
    if (ok) setCopied(true);
  }, [text]);

  // `ui/message` has no insert-without-running form — the host delivers it as a
  // turn and answers it. The button is named for what it actually does rather
  // than promising a composer prefill the protocol cannot give.
  // See docs/stage0-conflicts.md (C2).
  const handleSend = useCallback(() => {
    if (!app || !payload) return;

    void (async () => {
      try {
        // The structure goes alongside the prose, not instead of it. The visible
        // message stays the prompt the user read and could have copied; this lets
        // the model see which axis each sentence came from, tell "left to the AI"
        // from "decided on their behalf", and notice a contradiction the user was
        // warned about and kept. Sending ids *instead* would have left `[복사]`
        // nothing to copy — docs/stage0-conflicts.md (C18).
        await app.updateModelContext({
          structuredContent: describeSelection(payload.unfolded, state, {
            ...(fixApplied ? { fixApplied } : {}),
          }) as unknown as Record<string, unknown>,
        });
      } catch {
        // A host without `updateModelContext` still gets the prompt below, which
        // is the part the user actually chose. Structure is an addition.
      }

      await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    })();
  }, [app, payload, state, text, fixApplied]);

  useEffect(() => {
    if (!proceeding) return;
    setProceeding(false);
    handleSend();
  }, [proceeding, handleSend]);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!payload) return <div className="uu-root" ref={rootRef} />;

  return (
    <div className="uu-root" ref={rootRef}>
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
          aria-selected={tab === "board"}
          className={`uu-tab${tab === "board" ? " is-on" : ""}`}
          onClick={() => setTab("board")}
        >
          {t.tabBoard}
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

      {/* Above the tabs, because it governs both of them: the goal decides which
          axes exist, so it cannot live inside the list of them. */}
      {payload.unfolded.goal ? (
        <GoalField
          goal={payload.unfolded.goal}
          onSwitch={runGoalSwitch}
          switching={switchingGoal}
          disabled={!app || superseded}
          t={t}
        />
      ) : null}

      {/* Only where presets can exist. On the remote Worker `list_presets` is not
          registered, the list stays empty, and this renders nothing. */}
      <PresetBar
        presets={presets}
        loadedId={loadedFrom?.id}
        busy={presetBusy || superseded}
        onLoad={loadPreset}
        onDelete={deletePreset}
        t={t}
      />

      {/* Both tabs stay mounted so switching keeps scroll and open/closed folds. */}
      <div hidden={tab !== "list"}>
        <AxisList
          sections={payload.unfolded.sections}
          resolved={resolved}
          onChange={setAxis}
          onAddAxis={addAxis}
          onRemoveAxis={removeAxis}
          onAddSection={addSection}
          conflicts={conflicts}
          hidden={hidden}
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
          t={t}
        />
      </div>

      {/* Same `resolved` and the same `setAxis` the list uses, so a change on one
          surface is on the other before the next frame. */}
      <div hidden={tab !== "board"}>
        <BoardView
          sections={payload.unfolded.sections}
          resolved={resolved}
          conflicts={conflicts}
          selectedAxis={selectedAxis}
          onSelectAxis={setSelectedAxis}
          onChange={setAxis}
          onRemoveAxis={removeAxis}
          width={width}
          t={t}
        />
      </div>

      {/* The effect of a choice belongs beside the choice. The result tab keeps
          the full text, the count and the corrections. */}
      {tab !== "result" ? (
        <LivePreview
          text={text}
          openCount={openCount}
          onProceed={proceed}
          canProceed={Boolean(app) && !superseded}
          t={t}
        />
      ) : null}

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

        {/* Saving is asked for here, next to the finished text — the point at
            which the user knows the settings were worth keeping. Absent where
            there is nowhere to write. */}
        {callPreset ? (
          <PresetSave
            loaded={loadedFrom}
            busy={presetBusy || superseded}
            onSave={savePreset}
            t={t}
          />
        ) : null}
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
