/**
 * Saved settings, for work that repeats.
 *
 * Only drawn where presets can exist. The remote Worker registers no preset tools,
 * so `list_presets` is absent there and this renders nothing rather than offering
 * buttons that would fail. The check is the tool call failing, not a flag we could
 * get wrong.
 *
 * Loading replaces the axes in place: these tools are app-only, so the result of
 * `callServerTool` comes back to the widget that asked, with no second iframe and
 * no model call (C9). That is what makes a repeat task cost one click.
 *
 * Loaded values arrive as `대신 정함`, never as `내가 정함`. They are the user's own
 * earlier choices, but they were not made this time, and the brief is explicit that
 * where a value came from has to stay visible (§7).
 */

import { useEffect, useState } from "preact/hooks";

import type { Strings } from "./i18n.js";
import { Icon } from "./icons.js";

export interface PresetSummary {
  id: string;
  name: string;
  uses: number;
  lastUsedAt?: number;
}

interface PresetBarProps {
  presets: PresetSummary[];
  /** Which preset the current state came from, if any. */
  loadedId?: string;
  busy: boolean;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  t: Strings;
}

export function PresetBar({ presets, loadedId, busy, onLoad, onDelete, t }: PresetBarProps) {
  const [open, setOpen] = useState(false);

  // Nothing saved yet and nothing loaded: the row would be an empty label.
  if (presets.length === 0) return null;

  const loaded = presets.find((p) => p.id === loadedId);

  return (
    <div className="uu-presets">
      <div className="uu-preset-row">
        <div className="uu-label">{t.presets}</div>

        <button
          type="button"
          className="uu-preset-current"
          aria-expanded={open}
          disabled={busy}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="uu-preset-text">{loaded ? loaded.name : t.presetPick}</span>
          <Icon name={open ? "i-less" : "i-more"} />
        </button>
      </div>

      {open ? (
        <div className="uu-preset-open">
          {/* Most recently used first. That is ordering, not a guess about taste —
              §3 draws the line there and this side of it is memory. */}
          {presets.map((preset) => (
            <div key={preset.id} className="uu-preset-item">
              <button
                type="button"
                className={`uu-preset-name${preset.id === loadedId ? " is-on" : ""}`}
                disabled={busy}
                onClick={() => onLoad(preset.id)}
              >
                {preset.name}
              </button>
              <button
                type="button"
                className="uu-iconbtn"
                title={t.presetDelete}
                aria-label={`${t.presetDelete}: ${preset.name}`}
                disabled={busy}
                onClick={() => onDelete(preset.id)}
              >
                <Icon name="i-clear" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

interface SaveProps {
  /** Present when the state came from a preset, so overwrite is offered. */
  loaded?: { id: string; name: string };
  busy: boolean;
  onSave: (name: string, overwriteId?: string) => void;
  t: Strings;
}

/**
 * The save control, in the result tab.
 *
 * A name and nothing else — no description, no tags. Two paths appear only once
 * there is something to overwrite, because "새로 저장" is meaningless on its own.
 */
export function PresetSave({ loaded, busy, onSave, t }: SaveProps) {
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  if (!naming) {
    return (
      <div className="uu-preset-save">
        <button
          type="button"
          className="uu-btn"
          disabled={busy}
          onClick={() => {
            setName(loaded?.name ?? "");
            setNaming(true);
          }}
        >
          {t.presetSave}
        </button>
      </div>
    );
  }

  const trimmed = name.trim();

  return (
    <div className="uu-preset-save is-naming">
      <input
        type="text"
        className="uu-input"
        value={name}
        placeholder={t.presetNamePlaceholder}
        disabled={busy}
        autoFocus
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && trimmed) onSave(trimmed, loaded?.id);
          if (e.key === "Escape") setNaming(false);
        }}
      />

      {loaded ? (
        <>
          <button
            type="button"
            className="uu-btn"
            disabled={busy || !trimmed}
            onClick={() => onSave(trimmed, loaded.id)}
          >
            {t.presetOverwrite}
          </button>
          <button
            type="button"
            className="uu-btn"
            disabled={busy || !trimmed}
            onClick={() => onSave(trimmed)}
          >
            {t.presetSaveNew}
          </button>
        </>
      ) : (
        <button
          type="button"
          className="uu-btn"
          disabled={busy || !trimmed}
          onClick={() => onSave(trimmed)}
        >
          {t.presetSaveConfirm}
        </button>
      )}
    </div>
  );
}

/**
 * Ask the server for the list once.
 *
 * A failure is the normal answer on the remote Worker, where the tool does not
 * exist — so it resolves to "no presets" rather than surfacing an error. Storage
 * being unavailable must never disturb the part that never needed storage.
 */
export function usePresets(
  call: ((name: string, args?: Record<string, unknown>) => Promise<unknown>) | undefined,
  reloadKey: number,
): PresetSummary[] {
  const [presets, setPresets] = useState<PresetSummary[]>([]);

  useEffect(() => {
    if (!call) return;
    let live = true;

    void (async () => {
      try {
        const result = (await call("list_presets")) as { presets?: PresetSummary[] } | undefined;
        if (live && Array.isArray(result?.presets)) setPresets(result.presets);
      } catch {
        if (live) setPresets([]);
      }
    })();

    return () => {
      live = false;
    };
  }, [call, reloadKey]);

  return presets;
}
