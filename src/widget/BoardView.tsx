/**
 * The structure board.
 *
 * Replaces the radial map. The map drew relationships; the question people
 * actually bring to this screen is a status one — what did this request split
 * into, and which of it is still open. A graph answers that badly: node labels
 * shrink to fit, values do not fit at all, and the whole thing was hidden below
 * 520px, which is most of a chat column.
 *
 * So: one card per section, one row per axis, each row saying what state it is in
 * and what it currently holds. No nodes, no edges, no zoom, no drag canvas.
 *
 * State is text first. A colour-only badge is unreadable to anyone who cannot
 * separate the hues, and this widget already refuses to carry meaning in colour
 * alone — the icon grammar (solid = decided, dotted = not) does that work.
 *
 * Editing happens in the detail panel, which mounts the real `AxisRow`. The rows
 * here are navigation, never a second set of controls: two implementations of
 * "choose a value" would drift, and the brief's whole point is that the copied
 * text and the on-screen state cannot disagree.
 */

import { useEffect, useRef } from "react";

import type { ConflictReport, ResolvedAxis } from "../lib/assemble.js";
import type { AxisState, Section } from "../lib/schema.js";
import type { Strings } from "./i18n.js";
import { AxisRow } from "./AxisRow.js";
import { Icon, STATUS_ICON } from "./icons.js";

/** Below this the panel takes the whole width instead of sitting beside the board. */
export const PANEL_SIDE_BY_SIDE = 720;

export type BoardStatus = "unset" | "default" | "chosen" | "multiple" | "n/a" | "conflict";

interface BoardViewProps {
  sections: Section[];
  resolved: ResolvedAxis[];
  conflicts: ConflictReport[];
  /** Axis currently open in the detail panel. */
  selectedAxis: string | null;
  onSelectAxis: (axisId: string | null) => void;
  onChange: (axisId: string, next: AxisState) => void;
  onRemoveAxis: (axisId: string) => void;
  width: number;
  t: Strings;
}

/**
 * Which of the six states a row is in.
 *
 * Conflict and not-applicable win over the value state: both change what the
 * value *means*, and a row reading "chosen" while its axis no longer applies
 * would be telling the user something false.
 */
export function boardStatus(entry: ResolvedAxis, clashing: boolean): BoardStatus {
  if (!entry.applicable) return "n/a";
  if (clashing) return "conflict";
  if (entry.status === "unset") return "unset";
  if (entry.status === "partial") return "default";
  return entry.state.kind === "options" && entry.state.optionValues.length > 1
    ? "multiple"
    : "chosen";
}

const STATUS_TEXT: Record<BoardStatus, (t: Strings) => string> = {
  unset: (t) => t.stUnset,
  default: (t) => t.stDefault,
  chosen: (t) => t.stChosen,
  multiple: (t) => t.stMultiple,
  "n/a": (t) => t.stNotApplicable,
  conflict: (t) => t.stConflict,
};

/** Reuses the row icons, so the board and the result tab speak one grammar. */
const STATUS_MARK: Record<BoardStatus, string> = {
  unset: STATUS_ICON.unset,
  default: STATUS_ICON.partial,
  chosen: STATUS_ICON.set,
  multiple: STATUS_ICON.set,
  "n/a": STATUS_ICON.unset,
  conflict: STATUS_ICON.partial,
};

/**
 * What the axis currently holds, in the user's own terms.
 *
 * Option values are ids; the label is what the user actually saw and pressed, so
 * that is what comes back. Typed text is returned unchanged — it is their wording
 * and this is not the place to tidy it.
 */
export function displayValue(entry: ResolvedAxis): string {
  const { state, axis } = entry;
  const labelOf = (value: string) => axis.options?.find((o) => o.value === value)?.label ?? value;

  switch (state.kind) {
    case "option":
      return labelOf(state.optionValue);
    case "options":
      return state.optionValues.map(labelOf).join(", ");
    case "typed":
      return state.text;
    case "number":
      return `${state.value}${axis.range?.unit ?? ""}`;
    case "none":
      return "";
  }
}

function AxisCardRow({
  entry,
  status,
  selected,
  onSelect,
  t,
}: {
  entry: ResolvedAxis;
  status: BoardStatus;
  selected: boolean;
  onSelect: () => void;
  t: Strings;
}) {
  const value = displayValue(entry);

  return (
    <li className="uu-card-item">
      <button
        type="button"
        className={`uu-card-row${selected ? " is-selected" : ""}`}
        data-axis-card={entry.axis.id}
        data-status={status}
        aria-pressed={selected}
        // Names the row for a screen reader in one go, so the state is not left
        // to a visual badge the user may never reach.
        aria-label={`${entry.axis.label}, ${STATUS_TEXT[status](t)}${value ? `, ${value}` : ""}`}
        onClick={onSelect}
      >
        <span className="uu-card-name">{entry.axis.label}</span>

        <span className="uu-badge" data-status={status}>
          <Icon name={STATUS_MARK[status] as never} />
          <span className="uu-badge-text">{STATUS_TEXT[status](t)}</span>
        </span>

        {/* Clamped to two lines rather than one ellipsis: the panel behind this
            row holds the full value, so nothing is hidden with no way back. */}
        {value ? <span className="uu-card-value">{value}</span> : null}
      </button>
    </li>
  );
}

function SectionCard({
  section,
  entries,
  conflicts,
  selectedAxis,
  onSelectAxis,
  t,
}: {
  section: Section;
  entries: ResolvedAxis[];
  conflicts: ConflictReport[];
  selectedAxis: string | null;
  onSelectAxis: (axisId: string) => void;
  t: Strings;
}) {
  if (entries.length === 0) return null;

  // Counted here and nowhere else. The list tab still carries no counter beside a
  // heading — there it would read as a quota while the user is deciding. On a
  // board whose whole job is status, withholding the count would be coy.
  const decided = entries.filter((e) => e.applicable && e.status !== "unset").length;
  const applicable = entries.filter((e) => e.applicable).length;

  return (
    <section className="uu-card" aria-labelledby={`card-${section.id}`}>
      <header className="uu-card-head">
        <h3 className="uu-card-title" id={`card-${section.id}`}>
          {section.label || t.unnamedSection}
        </h3>
        <span className="uu-card-count">{t.decidedOf(decided, applicable)}</span>
      </header>

      <ul className="uu-card-list">
        {entries.map((entry) => {
          const clashing = conflicts.some(
            (c) => c.axisId === entry.axis.id || c.against.includes(entry.axis.id),
          );
          return (
            <AxisCardRow
              key={entry.axis.id}
              entry={entry}
              status={boardStatus(entry, clashing)}
              selected={selectedAxis === entry.axis.id}
              onSelect={() => onSelectAxis(entry.axis.id)}
              t={t}
            />
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The detail panel.
 *
 * Mounts the real `AxisRow` rather than reimplementing its controls, so the two
 * screens cannot disagree about what a click does. Everything above it is
 * context: which section, which axis, what state, and why it clashes if it does.
 */
function DetailPanel({
  entry,
  status,
  clashes,
  sectionLabel,
  fullWidth,
  onClose,
  onChange,
  onRemoveAxis,
  t,
}: {
  entry: ResolvedAxis;
  status: BoardStatus;
  clashes: ConflictReport[];
  sectionLabel: string;
  fullWidth: boolean;
  onClose: () => void;
  onChange: (axisId: string, next: AxisState) => void;
  onRemoveAxis: (axisId: string) => void;
  t: Strings;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Focus moves in when the panel opens, and Escape closes it. Without this the
  // keyboard user's focus stays on a row behind a panel they cannot reach.
  useEffect(() => {
    panelRef.current?.focus();
  }, [entry.axis.id]);

  return (
    <div
      className={`uu-panel${fullWidth ? " is-full" : ""}`}
      role="dialog"
      aria-modal={fullWidth}
      aria-label={`${entry.axis.label} — ${t.panelTitle}`}
      tabIndex={-1}
      ref={panelRef}
    >
      <header className="uu-panel-head">
        <div className="uu-panel-where">
          <span className="uu-panel-section">{sectionLabel || t.unnamedSection}</span>
          <h3 className="uu-panel-title">{entry.axis.label}</h3>
        </div>
        <button
          type="button"
          className="uu-iconbtn uu-panel-close"
          aria-label={fullWidth ? t.back : t.close}
          onClick={onClose}
        >
          <Icon name="i-clear" />
        </button>
      </header>

      <div className="uu-panel-status">
        <span className="uu-badge" data-status={status}>
          <Icon name={STATUS_MARK[status] as never} />
          <span className="uu-badge-text">{STATUS_TEXT[status](t)}</span>
        </span>
        {entry.axis.derivedFrom ? (
          <span className="uu-note">{t.derivedFrom(entry.axis.derivedFrom)}</span>
        ) : null}
      </div>

      {entry.axis.norm ? <p className="uu-panel-norm">{entry.axis.norm}</p> : null}

      {clashes.map((c) => (
        <p className="uu-clash" key={`${c.axisId}-${c.reason}`}>
          {c.reason}
        </p>
      ))}

      {/* The same component the list tab uses. One selection path, one behaviour. */}
      <div className="uu-panel-edit">
        <AxisRow
          axis={entry.axis}
          status={entry.status}
          state={entry.state}
          values={entry.values}
          onChange={onChange}
          clashing={clashes.length > 0}
          {...(entry.axis.origin === "user" ? { onRemove: onRemoveAxis } : {})}
          t={t}
        />
      </div>

      {/* What follows from each choice — shown here, never sent with the prompt. */}
      {entry.axis.options?.some((o) => o.effect) ? (
        <dl className="uu-effects">
          {entry.axis.options
            .filter((o) => o.effect)
            .map((o) => (
              <div className="uu-effect" key={o.value}>
                <dt>{o.label}</dt>
                <dd>{o.effect}</dd>
              </div>
            ))}
        </dl>
      ) : null}
    </div>
  );
}

/**
 * Put focus back on the row the panel was opened from.
 *
 * Without this a keyboard user lands at the top of the document every time they
 * close the panel, which makes the board unusable after the second axis.
 */
function focusRow(axisId: string, root: HTMLElement | null) {
  const row = root?.querySelector<HTMLButtonElement>(`[data-axis-card="${CSS.escape(axisId)}"]`);
  row?.focus();
}

export function BoardView({
  sections,
  resolved,
  conflicts,
  selectedAxis,
  onSelectAxis,
  onChange,
  onRemoveAxis,
  width,
  t,
}: BoardViewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const byId = new Map(resolved.map((r) => [r.axis.id, r]));
  const selected = selectedAxis ? byId.get(selectedAxis) : undefined;
  const sideBySide = width >= PANEL_SIDE_BY_SIDE;

  const close = () => onSelectAxis(null);

  /**
   * Put focus back on the row once the panel has actually gone.
   *
   * Driven by an effect rather than by the click handler: closing is a state
   * change, and on narrow widths it also remounts the whole card list. Focusing
   * from the handler would run before React had committed either, and land on a
   * row that is not in the document yet.
   */
  const lastOpened = useRef<string | null>(null);
  useEffect(() => {
    if (selectedAxis) {
      lastOpened.current = selectedAxis;
      return;
    }
    if (lastOpened.current) {
      focusRow(lastOpened.current, rootRef.current);
      lastOpened.current = null;
    }
  }, [selectedAxis]);

  // Narrow: the panel replaces the board rather than squeezing beside it. Two
  // columns in a phone-width chat column leaves neither usable.
  const boardHidden = Boolean(selected) && !sideBySide;

  const clashesFor = (axisId: string) =>
    conflicts.filter((c) => c.axisId === axisId || c.against.includes(axisId));

  return (
    <div
      className={`uu-board${sideBySide ? " is-split" : ""}`}
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && selectedAxis) {
          e.stopPropagation();
          close();
        }
      }}
    >
      {!boardHidden ? (
        <div className="uu-cards" role="region" aria-label={t.board}>
          {sections.map((section) => (
            <SectionCard
              key={section.id}
              section={section}
              entries={section.axes
                .map((a) => byId.get(a.id))
                .filter((e): e is ResolvedAxis => Boolean(e))}
              conflicts={conflicts}
              selectedAxis={selectedAxis}
              onSelectAxis={onSelectAxis}
              t={t}
            />
          ))}
        </div>
      ) : null}

      {selected ? (
        <DetailPanel
          entry={selected}
          status={boardStatus(selected, clashesFor(selected.axis.id).length > 0)}
          clashes={clashesFor(selected.axis.id)}
          sectionLabel={sections.find((s) => s.id === selected.sectionId)?.label ?? ""}
          fullWidth={!sideBySide}
          onClose={close}
          onChange={onChange}
          onRemoveAxis={onRemoveAxis}
          t={t}
        />
      ) : null}
    </div>
  );
}
