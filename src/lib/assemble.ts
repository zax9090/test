/**
 * The assembly engine.
 *
 * Pure and self-contained: same input, same output, no clock, no randomness, no
 * I/O. Everything the widget shows in the result tab comes from here, so the
 * copied text and the on-screen rows can never disagree.
 *
 * Order is fixed — intent, axes (core before extra), symptoms, freeform, source.
 *
 * An axis that was not decided contributes nothing (P2). It is not rendered as
 * "unspecified", not defaulted into a sentence, not mentioned at all — turning
 * more axes on must not make the prompt longer than what was actually chosen.
 */

import type { Axis, Option, Unfolded } from "./schema.js";

/** Which locale the assembled prose is written for. Only affects the source heading. */
export type AssembleLocale = "ko" | "en";

/**
 * A single axis selection.
 *
 * `string` for select/sample, `string[]` for multi, `number` for range. `null`
 * and `undefined` both mean untouched, so clearing a chip needs no special case.
 */
export type Selection = string | string[] | number | null | undefined;

export interface State {
  /** Axis id to chosen value. Ids with no matching axis are ignored. */
  selections: Record<string, Selection>;
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
  status: AxisStatus;
  /** The sentence this axis contributes. Empty when `unset`. */
  line: string;
  /** Values in play, for chip highlighting. Empty when `unset`. */
  values: string[];
}

const SOURCE_HEADING: Record<AssembleLocale, string> = { ko: "자료", en: "Source" };

/** Above this, or across more than one line, the source gets a heading of its own. */
const SOURCE_BLOCK_THRESHOLD = 200;

const VALUE_PLACEHOLDER = "{value}";

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
 * Turn one raw selection into its sentence.
 *
 * Returns `undefined` when the value cannot be rendered — an option id that no
 * longer exists, a blank multi-select, a non-numeric range. A stale value is
 * treated as untouched rather than as an error; the brief has no error state for
 * this, and throwing would take the whole prompt down over one bad chip.
 *
 * Out-of-range numbers are emitted unchanged: the widget informs, it does not
 * block (P4).
 */
function renderSelection(axis: Axis, raw: Selection): { line: string; values: string[] } | undefined {
  if (raw === null || raw === undefined) return undefined;

  if (Array.isArray(raw)) {
    const options = raw
      .map((v) => findOption(axis, v))
      .filter((o): o is Option => Boolean(o));
    if (options.length === 0) return undefined;
    // One line per axis, even when several values are on. Keeps "one axis
    // decided adds one entry" true for multi as well as select.
    return {
      line: options.map((o) => o.emit).join(" "),
      values: options.map((o) => o.value),
    };
  }

  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return undefined;
    const line = renderRange(axis, raw);
    return line ? { line, values: [String(raw)] } : undefined;
  }

  const value = raw.trim();
  if (!value) return undefined;

  const option = findOption(axis, value);
  if (option) return { line: option.emit, values: [option.value] };

  // A range axis whose value arrived as a string (form inputs give strings).
  if (axis.type === "range") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const line = renderRange(axis, parsed);
      if (line) return { line, values: [value] };
    }
  }

  return undefined;
}

/** core before extra, original order preserved inside each group. */
function ordered(axes: Axis[]): Axis[] {
  return [...axes.filter((a) => a.group === "core"), ...axes.filter((a) => a.group !== "core")];
}

/**
 * Work out the status and sentence of every axis, in output order.
 *
 * The widget renders the three states from this, and {@link assemble} builds the
 * text from the same list, so the two cannot drift.
 */
export function resolveAxes(unfolded: Unfolded, state: State): ResolvedAxis[] {
  const selections = state.selections ?? {};

  return ordered(unfolded.axes).map((axis) => {
    const chosen = renderSelection(axis, selections[axis.id]);
    if (chosen) {
      return { axis, status: "set" as const, line: chosen.line, values: chosen.values };
    }

    // Nothing chosen — a `default` stands in, and says so on screen.
    if (axis.default !== undefined && axis.default !== null) {
      const applied = renderSelection(axis, axis.default);
      if (applied) {
        return { axis, status: "partial" as const, line: applied.line, values: applied.values };
      }
    }

    return { axis, status: "unset" as const, line: "", values: [] };
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
  const blocks: string[] = [unfolded.intent.trim()];

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
