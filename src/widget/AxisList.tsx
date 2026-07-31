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
import type { ConflictReport, ResolvedAxis } from "../lib/assemble.js";
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
  /** Live contradictions. Shown beside the rows they involve; never enforced. */
  conflicts: ConflictReport[];
  /** Axis ids that no longer apply given what is chosen. */
  hidden: Set<string>;
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

/**
 * How many decisions the list opens with.
 *
 * Three, because the review found that a wall of them reads as homework rather
 * than help. The rest are one click away and nothing is thrown out.
 */
const OPEN_WITH = 3;

/**
 * Which axes the list shows while it is folded.
 *
 * Taken in **declared order** rather than by an importance field. The model is
 * already told to put the axis that changes the result most at the top of each
 * section, so position already carries that judgement and no new one is asked
 * for — which is the whole reason `core`/`extra` was removed. See
 * docs/stage0-conflicts.md (C23).
 *
 * Three things are never folded away, whatever their position:
 *  - an axis the user has already answered, because hiding their own value would
 *    be losing it as far as they can tell
 *  - an axis in a live contradiction, which is the one thing that needs looking at
 *  - a user-added axis, which they put there on purpose
 */
function visibleWhileFolded(ordered: ResolvedAxis[], conflicts: ConflictReport[]): Set<string> {
  const shown = new Set(ordered.slice(0, OPEN_WITH).map((r) => r.axis.id));

  for (const entry of ordered) {
    const touched = entry.status !== "unset" || entry.state.kind === "delegated";
    const clashing = conflicts.some(
      (c) => c.axisId === entry.axis.id || c.against.includes(entry.axis.id),
    );
    if (touched || clashing || entry.axis.origin === "user") shown.add(entry.axis.id);
  }

  return shown;
}

export function AxisList({
  sections,
  resolved,
  onChange,
  onAddAxis,
  onRemoveAxis,
  onAddSection,
  conflicts,
  hidden,
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
  const [expanded, setExpanded] = useState(false);

  // Declared order, applicable only — an axis that does not apply is not a
  // decision being withheld.
  const ordered = sections
    .flatMap((section) => section.axes)
    .map((a) => byId.get(a.id))
    .filter((r): r is ResolvedAxis => Boolean(r))
    .filter((r) => r.applicable && !hidden.has(r.axis.id));

  const visible = expanded ? null : visibleWhileFolded(ordered, conflicts);
  const foldedAway = visible ? ordered.filter((r) => !visible.has(r.axis.id)).length : 0;

  return (
    <div className="uu-list">
      {sections.map((section) => {
        const drawn = section.axes.filter(
          (a) => byId.get(a.id)?.applicable && !hidden.has(a.id) && (!visible || visible.has(a.id)),
        );
        // While folded, a section whose axes are all folded away draws nothing —
        // a heading over an empty gap reads as a rendering fault.
        if (visible && drawn.length === 0) return null;

        return (
          <div className="uu-section" key={section.id}>
            {/* An unnamed section — the salvage path for a flat payload, and the
              generic fallback — draws no heading rather than an empty one. */}
            {section.label ? <h2 className="uu-section-label">{section.label}</h2> : null}

            {section.axes.map((axis) => {
              const r = byId.get(axis.id);
              // An axis that no longer applies is not drawn. It is not a judgement
              // about importance — it is a question this deliverable cannot answer.
              if (!r || hidden.has(axis.id)) return null;
              // Folded away for now. Still in the payload, still on the board, and
              // one click from here.
              if (visible && !visible.has(axis.id)) return null;

              const clashes = conflicts.filter(
                (c) => c.axisId === axis.id || c.against.includes(axis.id),
              );

              return (
                <div key={axis.id}>
                  <AxisRow
                    axis={axis}
                    status={r.status}
                    state={r.state}
                    values={r.values}
                    onChange={onChange}
                    clashing={clashes.length > 0}
                    {...(axis.origin === "user" ? { onRemove: onRemoveAxis } : {})}
                    t={t}
                  />

                  {/* Said where the choice was made, not at the end. Every
                    contradiction seen in real use was "I did not know" — so this
                    informs and leaves the choice standing (P4). */}
                  {clashes.map((c) => (
                    <div className="uu-clash" key={`${c.axisId}-${c.reason}`}>
                      {c.reason}
                    </div>
                  ))}
                </div>
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
        );
      })}

      {/*
        The count, and nothing else. No bar, no percentage, no "that's enough" —
        the fold itself is the signal that there is an end (P6).
      */}
      {foldedAway > 0 ? (
        <button type="button" className="uu-fold uu-more" onClick={() => setExpanded(true)}>
          {t.more(foldedAway)}
        </button>
      ) : null}

      {expanded ? (
        <button type="button" className="uu-fold uu-more" onClick={() => setExpanded(false)}>
          {t.less}
        </button>
      ) : null}

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
