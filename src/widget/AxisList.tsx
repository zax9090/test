/**
 * The list tab.
 *
 * Axes are grouped into named sections rather than split by importance and
 * folded. Importance was a judgement made on the user's behalf; what an axis is
 * *about* is a property of the axis, and the section name doubles as a signpost —
 * seeing "Setting" is enough to decide whether to read what is under it.
 *
 * Everything is open. The fold is gone because the thing it was working around —
 * eleven rows with no structure — is gone too: three or four named groups is
 * already a scannable number of units (P6).
 *
 * No counters, no progress, no sufficiency wording anywhere near a section. A
 * count beside a heading would read as a target.
 */

import { useState } from "preact/hooks";

import type { AxisState } from "../lib/schema.js";
import type { ResolvedAxis } from "../lib/assemble.js";
import type { Section, Symptom } from "../lib/schema.js";
import type { Strings } from "./i18n.js";
import { AxisRow } from "./AxisRow.js";
import { Icon, STATUS_ICON } from "./icons.js";

interface AxisListProps {
  sections: Section[];
  resolved: ResolvedAxis[];
  onChange: (axisId: string, next: AxisState) => void;
  /** Add an empty user axis to a section, and hand back its id to focus. */
  onAddAxis: (sectionId: string) => void;
  onRemoveAxis: (axisId: string) => void;
  onAddSection: (label: string) => void;
  symptoms: Symptom[];
  chosenSymptoms: string[];
  onSymptom: (id: string) => void;
  freeform: string;
  onFreeform: (value: string) => void;
  source: string;
  onSource: (value: string) => void;
  /** Absent until the box holds material the axes were not built from. */
  onRefold?: () => void;
  refolding: boolean;
  t: Strings;
}

/** The `+ 묶음 추가` line, and the name box it turns into. */
function NewSection({ onAdd, t }: { onAdd: (label: string) => void; t: Strings }) {
  const [naming, setNaming] = useState(false);
  const [label, setLabel] = useState("");

  if (!naming) {
    return (
      <button type="button" className="uu-add uu-add-section" onClick={() => setNaming(true)}>
        {t.sectionAdd}
      </button>
    );
  }

  // An empty name adds nothing: a group with no heading is indistinguishable
  // from the ungrouped rows around it.
  const commit = () => {
    const trimmed = label.trim();
    if (trimmed) onAdd(trimmed);
    setLabel("");
    setNaming(false);
  };

  return (
    <div className="uu-new-section">
      <input
        type="text"
        className="uu-input"
        value={label}
        placeholder={t.sectionNamePlaceholder}
        autoFocus
        onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setNaming(false);
        }}
        onBlur={commit}
      />
    </div>
  );
}

export function AxisList({
  sections,
  resolved,
  onChange,
  onAddAxis,
  onRemoveAxis,
  onAddSection,
  symptoms,
  chosenSymptoms,
  onSymptom,
  freeform,
  onFreeform,
  source,
  onSource,
  onRefold,
  refolding,
  t,
}: AxisListProps) {
  const byId = new Map(resolved.map((r) => [r.axis.id, r]));

  return (
    <div className="uu-list">
      {sections.map((section) => (
        <div className="uu-section" key={section.id}>
          {/* An unnamed section — the salvage path for a flat payload, and the
              generic fallback — draws no heading rather than an empty one. */}
          {section.label ? <h2 className="uu-section-label">{section.label}</h2> : null}

          {section.axes.map((axis) => {
            const r = byId.get(axis.id);
            if (!r) return null;
            return (
              <AxisRow
                key={axis.id}
                axis={axis}
                status={r.status}
                state={r.state}
                values={r.values}
                onChange={onChange}
                {...(axis.origin === "user" ? { onRemove: onRemoveAxis } : {})}
                t={t}
              />
            );
          })}

          {/*
            Adding inside the group is the point. Looking at background and
            lighting is what makes "humidity" occur to someone; a blank line at
            the bottom of the whole list does not.
          */}
          <button
            type="button"
            className="uu-add uu-add-axis"
            onClick={() => onAddAxis(section.id)}
          >
            {t.axisAdd}
          </button>
        </div>
      ))}

      {/* The way out when an item belongs to no group that exists yet. */}
      <NewSection onAdd={onAddSection} t={t} />

      {/*
        Not an axis — these say what is wrong with the result rather than what it
        should be, which is why they sit after the axes and carry their own
        sentences. Multi-select: several things can be off at once.
      */}
      {symptoms.length > 0 ? (
        <div className="uu-section">
          <div className="uu-row">
            <div className="uu-label">{t.symptoms}</div>
            <div className="uu-values">
              <div className="uu-chips">
                {symptoms.map((symptom) => {
                  const on = chosenSymptoms.includes(symptom.id);
                  return (
                    <button
                      key={symptom.id}
                      type="button"
                      className={`uu-chip${on ? " is-on" : ""}`}
                      aria-pressed={on}
                      onClick={() => onSymptom(symptom.id)}
                    >
                      {symptom.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="uu-status" data-status={chosenSymptoms.length ? "set" : "unset"}>
              <Icon name={STATUS_ICON[chosenSymptoms.length ? "set" : "unset"]} />
            </div>
          </div>
        </div>
      ) : null}

      <div className="uu-section">
        {/* Always present, so a value outside the offered set never has nowhere to go (P4). */}
        <div className="uu-row">
          <div className="uu-label">{t.freeform}</div>
          <div className="uu-values">
            <input
              type="text"
              className="uu-input"
              value={freeform}
              placeholder={t.freeformPlaceholder}
              onChange={(e) => onFreeform(e.target.value)}
            />
          </div>
          <div className="uu-status" />
        </div>

        <div className="uu-row">
          <div className="uu-label">{t.source}</div>
          <div className="uu-values">
            <textarea
              className="uu-input uu-textarea"
              value={source}
              placeholder={t.sourcePlaceholder}
              rows={2}
              onChange={(e) => onSource(e.target.value)}
            />
            {/*
              Offered only once the box holds something the axes were not built
              from. The brief has the extractor fit axes to the material, and
              material can arrive long after the first pass — but re-extracting is
              the user's call, not something to fire on every keystroke.

              No icon: the eight symbols mean value, absence and confirmation, none
              of them means "do this again", and nothing decorative is allowed in.
            */}
            {onRefold ? (
              <button
                type="button"
                className="uu-refresh uu-refold"
                onClick={onRefold}
                disabled={refolding}
              >
                {refolding ? t.refolding : t.refold}
              </button>
            ) : null}
          </div>
          <div className="uu-status" />
        </div>
      </div>
    </div>
  );
}
