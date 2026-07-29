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

import type { ResolvedAxis, Selection } from "../lib/assemble.js";
import type { Section, Symptom } from "../lib/schema.js";
import type { Strings } from "./i18n.js";
import { AxisRow } from "./AxisRow.js";
import { Icon, STATUS_ICON } from "./icons.js";

interface AxisListProps {
  sections: Section[];
  resolved: ResolvedAxis[];
  onChange: (axisId: string, value: Selection) => void;
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

export function AxisList({
  sections,
  resolved,
  onChange,
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
                values={r.values}
                onChange={onChange}
                t={t}
              />
            );
          })}
        </div>
      ))}

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
