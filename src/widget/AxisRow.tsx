/**
 * One axis: a fixed-width label, its control, and the status mark.
 *
 * The label column is a fixed width so the labels line up down the page and
 * skimming the column *is* the discovery — that alignment is the point of the
 * row, not decoration.
 *
 * On an `open` axis the input box is the control and the chips below it are
 * examples. That inversion is the whole reason this file was rewritten: a row of
 * five chips told the user those were the values, when the real answer was that
 * nobody can list every coat colour. Pressing an example fills the box; editing
 * one character from there makes it theirs, and the emitted sentence changes with
 * it — see `renderState`.
 *
 * Nothing is selected by default. `common` earns a dot, never a preselection
 * (P7) — telling the user what is usual is information; choosing it for them
 * would be a claim about their taste.
 */

import type { Axis, AxisState } from "../lib/schema.js";
import type { AxisStatus } from "../lib/assemble.js";
import type { Strings } from "./i18n.js";
import { Icon, STATUS_ICON } from "./icons.js";

interface AxisRowProps {
  axis: Axis;
  status: AxisStatus;
  state: AxisState;
  /** Values in play, for marking which example matches. */
  values: string[];
  onChange: (axisId: string, next: AxisState) => void;
  /** Only user-added axes can be removed; a model axis is emptied instead. */
  onRemove?: (axisId: string) => void;
  t: Strings;
}

function Chip({
  label,
  common,
  selected,
  standIn,
  onClick,
}: {
  label: string;
  common?: boolean;
  selected: boolean;
  /** Carrying a value the user has not chosen — decided, but not by them. */
  standIn?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`uu-chip${selected ? (standIn ? " is-default" : " is-on") : ""}`}
      aria-pressed={selected}
      onClick={onClick}
    >
      {label}
      {common ? <span className="uu-dot" aria-hidden="true" /> : null}
    </button>
  );
}

/**
 * An `open` axis: a box, then its examples.
 *
 * The examples are text links rather than buttons, separated by middots. Made to
 * look pressable they would read as a menu again, which is exactly what this
 * replaced. A matching example is only emphasised — never drawn as "on".
 */
function OpenInput({
  axis,
  state,
  standIn,
  onChange,
  t,
}: {
  axis: Axis;
  state: AxisState;
  standIn: boolean;
  onChange: (next: AxisState) => void;
  t: Strings;
}) {
  const text =
    state.kind === "typed"
      ? state.text
      : state.kind === "option"
        ? (axis.options?.find((o) => o.value === state.optionValue)?.label ?? state.optionValue)
        : "";

  const current = state.kind === "option" ? state.optionValue : undefined;

  return (
    <div className="uu-open">
      <input
        type="text"
        // Dashed while the value is a stand-in: dotted already means undecided in
        // this widget's icon grammar, so a filled box that nobody typed says so
        // without a label on every row. See docs/stage0-conflicts.md (C14).
        className={`uu-input uu-open-input${standIn ? " is-standin" : ""}`}
        value={text}
        placeholder={axis.placeholder ?? ""}
        onInput={(e) => {
          const next = (e.target as HTMLInputElement).value;
          // Any edit is the user's own wording, even one character away from the
          // example they started from.
          onChange(next.trim() ? { kind: "typed", text: next } : { kind: "none" });
        }}
      />

      {axis.options?.length ? (
        <div className="uu-examples">
          {axis.options.map((option, i) => (
            <span key={option.value}>
              {i > 0 ? <span className="uu-sep" aria-hidden="true" /> : null}
              <button
                type="button"
                className={`uu-example${option.value === current ? " is-current" : ""}`}
                onClick={() => onChange({ kind: "option", optionValue: option.value })}
              >
                {option.label}
                {option.common ? <span className="uu-dot" aria-hidden="true" /> : null}
              </button>
            </span>
          ))}
        </div>
      ) : null}

      {text ? (
        <button
          type="button"
          className="uu-iconbtn uu-open-clear"
          title={t.clear}
          aria-label={t.clear}
          onClick={() => onChange({ kind: "none" })}
        >
          <Icon name="i-clear" />
        </button>
      ) : null}
    </div>
  );
}

function RangeInput({
  axis,
  state,
  standIn,
  onChange,
  t,
}: {
  axis: Axis;
  state: AxisState;
  standIn: boolean;
  onChange: (next: AxisState) => void;
  t: Strings;
}) {
  const { min, max, unit } = axis.range ?? {};
  const value = state.kind === "number" ? String(state.value) : "";
  const parsed = state.kind === "number" ? state.value : undefined;

  // Out of the usual range is allowed through — the widget says so and moves on,
  // in the same tone as the rest of the row. It never blocks the value (P4).
  const outside =
    parsed !== undefined &&
    Number.isFinite(parsed) &&
    ((min !== undefined && parsed < min) || (max !== undefined && parsed > max));

  return (
    <div className="uu-range">
      <input
        type="number"
        className={`uu-input uu-input-num${standIn ? " is-standin" : ""}`}
        value={value}
        // No `min`/`max` attributes: they would make the browser block the value.
        onChange={(e) => {
          const raw = e.target.value;
          const next = Number(raw);
          onChange(
            raw !== "" && Number.isFinite(next)
              ? { kind: "number", value: next }
              : { kind: "none" },
          );
        }}
      />
      {unit ? <span className="uu-unit">{unit}</span> : null}
      {value ? (
        <button
          type="button"
          className="uu-iconbtn"
          title={t.clear}
          aria-label={t.clear}
          onClick={() => onChange({ kind: "none" })}
        >
          <Icon name="i-clear" />
        </button>
      ) : null}
      {outside && min !== undefined && max !== undefined ? (
        <span className="uu-note">{t.outOfRange(String(min), String(max))}</span>
      ) : null}
    </div>
  );
}

export function AxisRow({ axis, status, state, values, onChange, onRemove, t }: AxisRowProps) {
  const selected = new Set(values);
  // A value nobody chose must not look like a chosen one. These rows are on
  // screen from the start, and a filled control reads as a preselection — which
  // the brief forbids (P7).
  const standIn = status === "partial";

  const pickOne = (value: string) => {
    if (standIn) return onChange(axis.id, { kind: "option", optionValue: value });
    // Pressing the chosen chip again clears it.
    onChange(
      axis.id,
      selected.has(value) ? { kind: "none" } : { kind: "option", optionValue: value },
    );
  };

  const toggleMany = (value: string) => {
    const next = selected.has(value) ? values.filter((v) => v !== value) : [...values, value];
    // Emptying a defaulted multi has nowhere to land — there is no "explicitly
    // none" — so it returns to the stand-in, same as a cleared single choice.
    onChange(axis.id, next.length ? { kind: "options", optionValues: next } : { kind: "none" });
  };

  return (
    <div className="uu-row" data-axis={axis.id} data-origin={axis.origin ?? "model"}>
      <div className="uu-label">{axis.label}</div>

      <div className="uu-values">
        {axis.type === "range" ? (
          <RangeInput
            axis={axis}
            state={state}
            standIn={standIn}
            onChange={(next) => onChange(axis.id, next)}
            t={t}
          />
        ) : axis.type === "open" ? (
          <OpenInput
            axis={axis}
            state={state}
            standIn={standIn}
            onChange={(next) => onChange(axis.id, next)}
            t={t}
          />
        ) : (
          <div className="uu-chips">
            {(axis.options ?? []).map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                common={option.common}
                selected={selected.has(option.value)}
                standIn={standIn}
                onClick={() =>
                  axis.type === "multi" ? toggleMany(option.value) : pickOne(option.value)
                }
              />
            ))}
          </div>
        )}

        {axis.norm ? <div className="uu-norm">{axis.norm}</div> : null}
      </div>

      {/* Only a user-added axis can be deleted. A model axis is emptied instead,
          which needs no undo. */}
      {onRemove ? (
        <button
          type="button"
          className="uu-iconbtn uu-row-remove"
          title={t.axisRemove}
          aria-label={`${t.axisRemove}: ${axis.label}`}
          onClick={() => onRemove(axis.id)}
        >
          <Icon name="i-clear" />
        </button>
      ) : (
        <div className="uu-status" data-status={status}>
          <Icon name={STATUS_ICON[status]} />
        </div>
      )}
    </div>
  );
}
