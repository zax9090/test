/**
 * The assembly engine.
 *
 * Pure and self-contained: same input, same output, no clock, no randomness, no
 * I/O. Everything the widget shows in the result tab comes from here, so the
 * copied text and the on-screen rows can never disagree.
 *
 * Order is fixed — intent, then the sections in the order they were declared and
 * the axes in the order each section lists them, then symptoms, freeform, source.
 *
 * Section names are not written into the prompt. They organise the screen; they
 * are not instructions, and a model reading "Environment" above a sentence would
 * be reading something the user never said.
 *
 * An axis that was not decided contributes nothing (P2). It is not rendered as
 * "unspecified", not defaulted into a sentence, not mentioned at all — turning
 * more axes on must not make the prompt longer than what was actually chosen.
 */

import {
  allAxes,
  NO_STATE,
  VALUE_PLACEHOLDER,
  type Axis,
  type AxisState,
  type Option,
  type Unfolded,
} from "./schema.js";

/** Which locale the assembled prose is written for. Only affects the source heading. */
export type AssembleLocale = "ko" | "en";

/**
 * A selection as it may arrive from anywhere.
 *
 * The widget holds {@link AxisState}, which carries provenance. But a stored
 * preset, a `fixes` entry and a model `default` are all plain values, and older
 * payloads used plain values throughout. {@link toState} narrows any of them.
 */
export type Selection = AxisState | string | string[] | number | null | undefined;

/**
 * Normalise anything into an {@link AxisState}.
 *
 * The axis is needed, not optional: whether a bare string is a pressed chip or
 * typed text depends on whether the axis offers it as an option, and that is the
 * difference between emitting the model's sentence and emitting the template.
 * Guessing wrong would attribute a reason the user never saw to a value they
 * typed themselves.
 */
export function toState(axis: Axis, raw: Selection): AxisState {
  if (raw === null || raw === undefined) return NO_STATE;

  if (typeof raw === "object" && !Array.isArray(raw) && "kind" in raw) return raw;

  if (Array.isArray(raw)) {
    const known = raw.filter((v) => findOption(axis, v));
    return known.length ? { kind: "options", optionValues: known } : NO_STATE;
  }

  if (typeof raw === "number") {
    return Number.isFinite(raw) ? { kind: "number", value: raw } : NO_STATE;
  }

  const text = raw.trim();
  if (!text) return NO_STATE;

  if (findOption(axis, text)) return { kind: "option", optionValue: text };

  // A range value that arrived as a string, which is what a number input gives.
  if (axis.type === "range") {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? { kind: "number", value: parsed } : NO_STATE;
  }

  return { kind: "typed", text };
}

export interface State {
  /** Axis id to chosen value. Ids with no matching axis are ignored. */
  selections: Record<string, Selection>;
  /**
   * Values that came from a preset.
   *
   * Applied where the user has not chosen, and reported as `partial` — the same
   * status a model `default` gets, for the same reason: the value is decided but
   * not decided *this time*. They are the user's own earlier choices, which is
   * exactly why they must stay visible rather than be adopted silently (P7).
   *
   * Separate from `default` because a `default` is a single scalar and a stored
   * multi-select is an array.
   */
  loaded?: Record<string, Selection>;
  /** Ids of the selected symptoms. */
  symptoms?: string[];
  /** The free-text box. Always available (P4). */
  freeform?: string;
  /** Material pasted into the source box. */
  source?: string;
  locale?: AssembleLocale;
}

export const emptyState: State = { selections: {} };

/**
 * How an axis ended up.
 *
 * `set` — the user chose. `partial` — nothing chosen but the axis carries a
 * `default`, so a value was applied on their behalf. `unset` — left to the AI,
 * shown on screen but never copied.
 */
export type AxisStatus = "set" | "partial" | "unset";

export interface ResolvedAxis {
  axis: Axis;
  /** Which section the axis was declared in, so the list can group its rows. */
  sectionId: string;
  status: AxisStatus;
  /** What the row should render, provenance included. */
  state: AxisState;
  /** The sentence this axis contributes. Empty when `unset`. */
  line: string;
  /** Values in play, for marking the matching example. Empty when `unset`. */
  values: string[];
  /**
   * Whether the axis still applies, given what else is chosen.
   *
   * An inapplicable axis is reported `unset` and contributes nothing, so the
   * prompt cannot carry a sentence from a row the user can no longer see. The
   * flag is kept so the widget can skip drawing it without recomputing.
   */
  applicable: boolean;
}

const SOURCE_HEADING: Record<AssembleLocale, string> = { ko: "자료", en: "Source" };

/** Above this, or across more than one line, the source gets a heading of its own. */
const SOURCE_BLOCK_THRESHOLD = 200;

function findOption(axis: Axis, value: string): Option | undefined {
  return axis.options?.find((o) => o.value === value);
}

/** Render a range value through its template, tolerating a template with no placeholder. */
function renderRange(axis: Axis, value: number): string | undefined {
  const template = axis.range?.emitTemplate;
  if (!template) return undefined;
  const text = String(value);
  return template.includes(VALUE_PLACEHOLDER)
    ? template.split(VALUE_PLACEHOLDER).join(text)
    : `${template} ${text}${axis.range?.unit ?? ""}`.trim();
}

/**
 * Turn one axis state into its sentence.
 *
 * Which sentence depends on where the value came from. A pressed chip emits the
 * sentence the model wrote for that option, reason and all. The very same words
 * typed by hand emit the axis template instead, because the reason was the
 * model's and the user never saw it — attaching it to their own words would put a
 * justification in their mouth.
 *
 * Returns `undefined` when nothing can be rendered: an option that no longer
 * exists, an empty multi-select, a non-numeric range. Stale values are treated as
 * untouched rather than as errors; throwing would take the whole prompt down over
 * one bad chip.
 *
 * Out-of-range numbers are emitted unchanged — the widget informs, it does not
 * block (P4).
 */
function renderState(axis: Axis, state: AxisState): { line: string; values: string[] } | undefined {
  switch (state.kind) {
    case "none":
      return undefined;

    case "option": {
      const option = findOption(axis, state.optionValue);
      return option ? { line: option.emit, values: [option.value] } : undefined;
    }

    case "options": {
      const options = state.optionValues
        .map((v) => findOption(axis, v))
        .filter((o): o is Option => Boolean(o));
      if (options.length === 0) return undefined;
      // One line per axis however many values are on, so "one axis decided adds
      // one entry" stays true for multi as well.
      return {
        line: options.map((o) => o.emit).join(" "),
        values: options.map((o) => o.value),
      };
    }

    case "typed": {
      const text = state.text.trim();
      if (!text) return undefined;
      const template = axis.emitTemplate;
      // No template means no way to place the value in a sentence. Emitting the
      // bare text would be indistinguishable from the freeform box, which is a
      // different thing with a different purpose.
      if (!template?.includes(VALUE_PLACEHOLDER)) return undefined;
      return { line: template.split(VALUE_PLACEHOLDER).join(text), values: [text] };
    }

    case "number": {
      if (!Number.isFinite(state.value)) return undefined;
      const line = renderRange(axis, state.value);
      return line ? { line, values: [String(state.value)] } : undefined;
    }
  }
}

/**
 * Work out the status and sentence of every axis, in output order.
 *
 * The widget renders the three states from this, and {@link assemble} builds the
 * text from the same list, so the two cannot drift.
 */
export function resolveAxes(unfolded: Unfolded, state: State): ResolvedAxis[] {
  const selections = state.selections ?? {};
  const sectionOf = new Map<string, string>();
  for (const section of unfolded.sections) {
    for (const axis of section.axes) sectionOf.set(axis.id, section.id);
  }

  const resolved: ResolvedAxis[] = allAxes(unfolded).map((axis) => {
    const sectionId = sectionOf.get(axis.id) ?? "";
    const own = toState(axis, selections[axis.id]);
    const chosen = renderState(axis, own);
    if (chosen) {
      return {
        axis,
        sectionId,
        status: "set" as const,
        applicable: true,
        state: own,
        line: chosen.line,
        values: chosen.values,
      };
    }

    // Nothing chosen this time. A preset value stands in first — it is the user's
    // own earlier answer, so it outranks whatever the model would have defaulted to.
    const stored = toState(axis, state.loaded?.[axis.id]);
    const fromPreset = renderState(axis, stored);
    if (fromPreset) {
      return {
        axis,
        sectionId,
        status: "partial" as const,
        applicable: true,
        state: stored,
        line: fromPreset.line,
        values: fromPreset.values,
      };
    }

    // Failing that, a `default` stands in, and says so on screen.
    if (axis.default !== undefined && axis.default !== null) {
      const fallback = toState(axis, axis.default);
      const applied = renderState(axis, fallback);
      if (applied) {
        return {
          axis,
          sectionId,
          status: "partial" as const,
          applicable: true,
          state: fallback,
          line: applied.line,
          values: applied.values,
        };
      }
    }

    return {
      axis,
      sectionId,
      status: "unset" as const,
      applicable: true,
      state: NO_STATE,
      line: "",
      values: [],
    };
  });

  // Second pass, against the fully resolved list: an axis that no longer applies
  // is reported as undecided and contributes nothing. Doing this here rather than
  // in the widget is what stops a hidden row from quietly leaving its sentence in
  // the prompt — a sentence the user can no longer see to remove.
  return resolved.map((entry) =>
    isApplicable(entry.axis, resolved)
      ? entry
      : { ...entry, applicable: false, status: "unset" as const, line: "", values: [] },
  );
}

function renderSource(source: string, locale: AssembleLocale): string {
  const text = source.trim();
  const heading = SOURCE_HEADING[locale];

  // Long or multi-line material gets a heading and a blank line so the boundary
  // is unmistakable. No XML tags — those are not the default here.
  if (text.length > SOURCE_BLOCK_THRESHOLD || text.includes("\n")) {
    return `${heading}\n\n${text}`;
  }
  return `${heading}: ${text}`;
}

/**
 * Build the prompt.
 *
 * With nothing decided this returns the request unchanged — the widget always
 * has something copyable the moment it appears (P3).
 *
 * Never throws. Unknown axis ids in `state`, stale option values and malformed
 * ranges are all skipped.
 */
/**
 * The value an axis currently holds, as a plain string, for matching conditions.
 *
 * Only option values can take part in a dependency: a typed value is the user's
 * own words and the model has no way to have written a rule about it.
 */
function conditionValues(resolved: ResolvedAxis): string[] {
  const { state } = resolved;
  if (state.kind === "option") return [state.optionValue];
  if (state.kind === "options") return state.optionValues;
  return [];
}

/**
 * Whether an axis applies at all right now.
 *
 * `showIf` is for axes that stop *applying* — a stack is not a question you can
 * answer about a plan document. It is not a way to hide axes judged unimportant;
 * that was `core`/`extra`, and sections replaced it.
 *
 * An unmatched condition on an axis nobody has touched leaves the axis showing.
 * Hiding it before the governing axis is answered would make it vanish for a
 * reason the user cannot see yet.
 */
export function isApplicable(axis: Axis, resolved: ResolvedAxis[]): boolean {
  if (!axis.showIf) return true;

  const byId = new Map(resolved.map((r) => [r.axis.id, r]));
  return Object.entries(axis.showIf).every(([axisId, allowed]) => {
    const governing = byId.get(axisId);
    if (!governing) return true;

    const held = conditionValues(governing);
    // Not yet answered: keep showing rather than hide on an unstated premise.
    if (held.length === 0) return true;
    return held.some((v) => allowed.includes(v));
  });
}

export interface ConflictReport {
  /** The axis carrying the rule. */
  axisId: string;
  /** The value of that axis the rule is attached to, when it has one. */
  reason: string;
  /** Axis ids on the other side, so the widget can mark both. */
  against: string[];
}

/**
 * Every contradiction currently live.
 *
 * Reported, never blocked. The widget dims the clashing values and shows the
 * reason at the moment of choosing; it does not refuse the choice. Every
 * contradiction seen in real use was "I did not know", so saying it early is the
 * whole fix — and refusing would only take away the case where someone knows and
 * means it anyway (P4, docs/stage0-conflicts.md C20).
 */
export function findConflicts(unfolded: Unfolded, resolved: ResolvedAxis[]): ConflictReport[] {
  const byId = new Map(resolved.map((r) => [r.axis.id, r]));
  const reports: ConflictReport[] = [];

  for (const axis of allAxes(unfolded)) {
    const own = byId.get(axis.id);
    // A rule on an axis nobody has answered has nothing to clash with yet.
    if (!axis.conflicts || !own || conditionValues(own).length === 0) continue;

    for (const rule of axis.conflicts) {
      const against = Object.entries(rule.with);
      const holds = against.every(([otherId, value]) => {
        const other = byId.get(otherId);
        return other ? conditionValues(other).includes(value) : false;
      });

      if (holds) {
        reports.push({
          axisId: axis.id,
          reason: rule.reason,
          against: against.map(([otherId]) => otherId),
        });
      }
    }
  }

  return reports;
}

export function assemble(unfolded: Unfolded, state: State): string {
  const locale = state.locale ?? "en";

  // The goal rides with the intent, on the line below it. Unlike an axis it *is*
  // part of the instruction — it says which reading of the request the rest of the
  // prompt was built for. It is on screen and switchable, so it is never a
  // sentence the user did not see.
  const opening = unfolded.goal
    ? `${unfolded.intent.trim()}\n${unfolded.goal.selected.trim()}`
    : unfolded.intent.trim();
  const blocks: string[] = [opening];

  const axisLines = resolveAxes(unfolded, state)
    .filter((r) => r.status !== "unset")
    .map((r) => r.line.trim())
    .filter(Boolean);
  if (axisLines.length) blocks.push(axisLines.join("\n"));

  const selectedSymptoms = new Set(state.symptoms ?? []);
  const symptomLines = (unfolded.symptoms ?? [])
    .filter((s) => selectedSymptoms.has(s.id))
    .map((s) => s.emit.trim())
    .filter(Boolean);
  if (symptomLines.length) blocks.push(symptomLines.join("\n"));

  const freeform = state.freeform?.trim();
  if (freeform) blocks.push(freeform);

  const source = state.source?.trim();
  if (source) blocks.push(renderSource(source, locale));

  return blocks.filter(Boolean).join("\n\n");
}

/**
 * One axis, as the model should see it.
 *
 * `kind` is the provenance, and it is the field that makes the report worth
 * sending: `option` means the user took a value the model wrote, `typed` means
 * they wrote their own. Reading the assembled prose, those are indistinguishable.
 */
export interface ReportedAxis {
  kind: AxisState["kind"];
  label: string;
  /** Which section it was declared in, so the grouping survives the trip. */
  section: string;
  value: string | string[] | number;
}

/**
 * The structure behind the prompt.
 *
 * Sent *alongside* the assembled text, never instead of it. The prose is what the
 * user copies and what the brief calls the deliverable; this is what lets the
 * model see which axis a sentence came from and check the combination. Replacing
 * the prose with ids would have left `[복사]` nothing to copy — see
 * docs/stage0-conflicts.md (C18).
 *
 * The three groups are the point. A flat list of chosen values cannot tell "left
 * to the AI" from "a value was applied on their behalf", and those want different
 * treatment: the first is genuinely open, the second is a decision the user may
 * not have noticed making.
 *
 * The source material is not here, and there is no field for it.
 */
export interface SelectionReport {
  intent: string;
  goal?: string;
  /** Axes the user decided themselves. */
  chosen: Record<string, ReportedAxis>;
  /** Decided by a `default` or a loaded preset, not by the user this time. */
  standIn: Record<string, ReportedAxis>;
  /** Ids the user never touched — left to the AI. */
  untouched: string[];
  /** Ids that stopped applying, so the model knows they were not skipped. */
  inapplicable: string[];
  symptoms?: string[];
  freeform?: string;
  /** Contradictions live at send time. The user was told and proceeded anyway. */
  conflicts?: ConflictReport[];
  /** The correction button that filled these values, when one did. */
  fixApplied?: string;
}

function reportValue(state: AxisState): string | string[] | number | undefined {
  switch (state.kind) {
    case "option":
      return state.optionValue;
    case "options":
      return state.optionValues;
    case "typed":
      return state.text;
    case "number":
      return state.value;
    case "none":
      return undefined;
  }
}

/**
 * Describe what was decided, in structure rather than prose.
 *
 * Pure, like everything else here, and built from the same `resolveAxes` output
 * the rows and the text come from — so the three cannot disagree about what the
 * user chose.
 */
export function describeSelection(
  unfolded: Unfolded,
  state: State,
  extra: { fixApplied?: string } = {},
): SelectionReport {
  const resolved = resolveAxes(unfolded, state);

  const report: SelectionReport = {
    intent: unfolded.intent.trim(),
    chosen: {},
    standIn: {},
    untouched: [],
    inapplicable: [],
  };

  if (unfolded.goal) report.goal = unfolded.goal.selected;

  for (const entry of resolved) {
    const id = entry.axis.id;

    if (!entry.applicable) {
      report.inapplicable.push(id);
      continue;
    }

    const value = reportValue(entry.state);
    if (entry.status === "unset" || value === undefined) {
      report.untouched.push(id);
      continue;
    }

    const reported: ReportedAxis = {
      kind: entry.state.kind,
      label: entry.axis.label,
      section: entry.sectionId,
      value,
    };
    if (entry.status === "set") report.chosen[id] = reported;
    else report.standIn[id] = reported;
  }

  const symptoms = state.symptoms?.filter((id) =>
    (unfolded.symptoms ?? []).some((s) => s.id === id),
  );
  if (symptoms?.length) report.symptoms = symptoms;

  const freeform = state.freeform?.trim();
  if (freeform) report.freeform = freeform;

  const conflicts = findConflicts(unfolded, resolved);
  if (conflicts.length) report.conflicts = conflicts;

  if (extra.fixApplied) report.fixApplied = extra.fixApplied;

  return report;
}

/** Character count for the result tab. Length only — never a quality score (P5). */
export function assembledLength(text: string): number {
  return [...text].length;
}
