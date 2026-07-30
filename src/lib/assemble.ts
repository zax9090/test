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

  return allAxes(unfolded).map((axis) => {
    const sectionId = sectionOf.get(axis.id) ?? "";
    const own = toState(axis, selections[axis.id]);
    const chosen = renderState(axis, own);
    if (chosen) {
      return {
        axis,
        sectionId,
        status: "set" as const,
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
          state: fallback,
          line: applied.line,
          values: applied.values,
        };
      }
    }

    return { axis, sectionId, status: "unset" as const, state: NO_STATE, line: "", values: [] };
  });
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

/** Character count for the result tab. Length only — never a quality score (P5). */
export function assembledLength(text: string): number {
  return [...text].length;
}
