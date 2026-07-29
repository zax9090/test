/**
 * The list tab.
 *
 * Core axes are open; everything else sits behind one collapsed header that
 * shows a count and nothing else (P6). There is no "that's enough" line, no
 * divider, no progress bar, no completeness figure — the fold itself is what
 * says where the end is, and any wording on top of it would be a claim the tool
 * cannot back up.
 */

import type { ResolvedAxis, Selection } from "../lib/assemble.js";
import type { Symptom } from "../lib/schema.js";
import type { Strings } from "./i18n.js";
import { AxisRow } from "./AxisRow.js";
import { Icon, STATUS_ICON } from "./icons.js";

interface AxisListProps {
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
  extrasOpen: boolean;
  onToggleExtras: () => void;
  t: Strings;
}

export function AxisList({
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
  extrasOpen,
  onToggleExtras,
  t,
}: AxisListProps) {
  const core = resolved.filter((r) => r.axis.group === "core");
  const extra = resolved.filter((r) => r.axis.group !== "core");

  const rows = (items: ResolvedAxis[]) =>
    items.map((r) => (
      <AxisRow
        key={r.axis.id}
        axis={r.axis}
        status={r.status}
        values={r.values}
        onChange={onChange}
        t={t}
      />
    ));

  return (
    <div className="uu-list">
      {rows(core)}

      {extra.length > 0 ? (
        <>
          <button type="button" className="uu-fold" onClick={onToggleExtras} aria-expanded={extrasOpen}>
            <Icon name={extrasOpen ? "i-less" : "i-more"} />
            <span>{extrasOpen ? t.less : t.more(extra.length)}</span>
          </button>
          {extrasOpen ? rows(extra) : null}
        </>
      ) : null}

      {/*
        Not an axis — these say what is wrong with the result rather than what it
        should be, which is why they sit after the axes and carry their own
        sentences. Multi-select: several things can be off at once.
      */}
      {symptoms.length > 0 ? (
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
      ) : null}

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
          */}
          {onRefold ? (
            <button
              type="button"
              className="uu-refresh uu-refold"
              onClick={onRefold}
              disabled={refolding}
            >
              <Icon name="i-set" />
              <span>{refolding ? t.refolding : t.refold}</span>
            </button>
          ) : null}
        </div>
        <div className="uu-status" />
      </div>
    </div>
  );
}
