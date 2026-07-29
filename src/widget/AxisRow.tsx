/**
 * One axis: a fixed-width label, its values, and the status mark.
 *
 * The label column is a fixed width so the labels line up down the page and
 * skimming the column *is* the discovery — that alignment is the point of the
 * row, not decoration.
 *
 * Nothing is selected by default. `common` earns a dot, never a preselection
 * (P7) — telling the user what is usual is information; choosing it for them
 * would be a claim about their taste.
 */

import type { Axis } from "../lib/schema.js";
import type { AxisStatus, Selection } from "../lib/assemble.js";
import type { Strings } from "./i18n.js";
import { Icon, STATUS_ICON } from "./icons.js";
import { SampleCards } from "./SampleCards.js";

interface AxisRowProps {
  axis: Axis;
  status: AxisStatus;
  values: string[];
  onChange: (axisId: string, value: Selection) => void;
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
  /** Carrying a `default` the user has not touched — decided, but not by them. */
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

function RangeInput({
  axis,
  value,
  onChange,
  t,
}: {
  axis: Axis;
  value: string | undefined;
  onChange: (v: Selection) => void;
  t: Strings;
}) {
  const { min, max, unit } = axis.range ?? {};
  const parsed = value === undefined || value === "" ? undefined : Number(value);

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
        className="uu-input uu-input-num"
        value={value ?? ""}
        // No `min`/`max` attributes: they would make the browser block the value.
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
      />
      {unit ? <span className="uu-unit">{unit}</span> : null}
      {/* A chip clears by being clicked again; a typed number has no such
          affordance, so this is the one place the clear mark is needed. */}
      {value ? (
        <button
          type="button"
          className="uu-iconbtn"
          title={t.clear}
          aria-label={t.clear}
          onClick={() => onChange(null)}
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

export function AxisRow({ axis, status, values, onChange, t }: AxisRowProps) {
  const selected = new Set(values);
  const isMulti = axis.type === "multi";
  // A defaulted value must not look like a chosen one. With no fold left, these
  // axes are on screen from the start, and a filled chip nobody clicked reads as
  // a preselection — which the brief forbids (P7).
  const standIn = status === "partial";

  const toggleSingle = (value: string) => {
    // Clicking a stand-in adopts it. Clearing it would fall straight back to the
    // same default and nothing on screen would move, so the one thing the user
    // must be able to say about a value chosen for them — "yes, I mean it" —
    // would have no gesture at all.
    if (standIn) return onChange(axis.id, value);
    // Clicking the chosen chip again clears it.
    onChange(axis.id, selected.has(value) ? null : value);
  };

  const toggleMulti = (value: string) => {
    const next = selected.has(value) ? values.filter((v) => v !== value) : [...values, value];
    // Emptying a defaulted multi has nowhere to land — the schema has no
    // "explicitly none" — so it returns to the stand-in, same as a cleared select.
    onChange(axis.id, next.length ? next : null);
  };

  return (
    <div className="uu-row" data-axis={axis.id}>
      <div className="uu-label">{axis.label}</div>

      <div className="uu-values">
        {axis.type === "range" ? (
          <RangeInput axis={axis} value={values[0]} onChange={(v) => onChange(axis.id, v)} t={t} />
        ) : axis.type === "sample" ? (
          <SampleCards axis={axis} selected={selected} onPick={(value) => toggleSingle(value)} />
        ) : (
          <div className="uu-chips">
            {(axis.options ?? []).map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                common={option.common}
                selected={selected.has(option.value)}
                standIn={standIn}
                onClick={() => (isMulti ? toggleMulti(option.value) : toggleSingle(option.value))}
              />
            ))}
          </div>
        )}

        {axis.norm ? <div className="uu-norm">{axis.norm}</div> : null}
      </div>

      {/* Always the status mark. Clearing is re-clicking the chip, so the column
          stays a readout rather than becoming a second control. */}
      <div className="uu-status" data-status={status}>
        <Icon name={STATUS_ICON[status]} />
      </div>
    </div>
  );
}
