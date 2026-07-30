/**
 * The `Unfolded` shape and a repair-oriented parser for model output.
 *
 * Validation here salvages rather than rejects. A model that returns nine good
 * axes and one malformed one should yield nine axes, not an error — the brief's
 * rule is that an empty widget must never happen. Whole-payload failure is
 * signalled by returning `null`, which the caller answers with one retry and
 * then the generic fallback.
 *
 * Everything is plain JSON and stays serializable, so an `Unfolded` can later be
 * frozen into a preset without a format change.
 */

import { detectLocale } from "./locale.js";

export interface Option {
  value: string;
  label: string;
  /** Sentence inserted into the prompt. Carries its own reason. */
  emit: string;
  /** Marks a usual value with a small dot. Never auto-selected. */
  common?: boolean;
  /**
   * Two or three lines showing what this direction actually reads like.
   *
   * `open` axes only, where a label alone does not convey the difference.
   * Written by the extracting model along with the axes — there is no second
   * pass, because reaching a model again would mean another round through the
   * conversation.
   *
   * Never stored in a preset: previews are written from the user's material, so
   * keeping one would keep the material. See `lib/preset.ts`.
   */
  preview?: string;
}

export interface AxisRange {
  unit: string;
  min?: number;
  max?: number;
  /** Template containing `{value}`, e.g. "제목은 {value}pt로." */
  emitTemplate: string;
}

/**
 * How an axis is answered.
 *
 * The question that decides it is whether the values can be listed exhaustively.
 * `털색` cannot — mackerel tabby, cream, point, russian blue all exist and a list
 * of five would quietly tell the user those are the options. `비율` can: 1:1,
 * 16:9, 9:16 really is all of them.
 *
 * When it is unclear the answer is `open`. Closing an axis that should be open
 * hides values the user would have wanted; opening one that could have been
 * closed costs a little redundancy and nothing else.
 */
export type AxisType = "open" | "closed" | "multi" | "range";

export interface Axis {
  id: string;
  label: string;
  type: AxisType;
  /** Choices on `closed`/`multi`. On `open` these are *examples*, not a menu. */
  options?: Option[];
  /**
   * Sentence for a value the user typed, containing `{value}`.
   *
   * Required on `open`, because the whole point is that the value may be one
   * nobody listed. A missing or placeholder-less template is synthesised rather
   * than treated as fatal — see `parseAxis`.
   */
  emitTemplate?: string;
  range?: AxisRange;
  /** One-line help. The usual range, not a preference. */
  norm?: string;
  /** When present the value is applied on the user's behalf. */
  default?: string | number | null;
  /** `open` only. Hints that typing something unlisted is expected. */
  placeholder?: string;
  /** `user` axes are added in the widget; they carry no options, norm or default. */
  origin?: "model" | "user";
}

/**
 * What an axis currently holds, and where it came from.
 *
 * The provenance is load-bearing, not bookkeeping: a chip the user pressed emits
 * the sentence the model wrote for it, reason included, while the same text typed
 * by hand can only be dropped into `emitTemplate`. Those are different sentences,
 * so the state has to remember which happened.
 *
 * `options` is not in the brief's list, which covers `open`/`range` and stops.
 * `multi` still needs to hold several chips at once, so it is added here rather
 * than left to a second parallel representation.
 */
export type AxisState =
  | { kind: "none" }
  | { kind: "option"; optionValue: string }
  | { kind: "options"; optionValues: string[] }
  | { kind: "typed"; text: string }
  | { kind: "number"; value: number };

export const NO_STATE: AxisState = { kind: "none" };

/** The one template a user-added axis emits through. Never stored, always this. */
export const USER_AXIS_TEMPLATE = "{label}: {value}";

export const VALUE_PLACEHOLDER = "{value}";

/** Examples above this stop being examples and start reading as a menu. */
const MAX_OPEN_EXAMPLES = 6;

/**
 * A named group of axes.
 *
 * Replaces the old core/extra split. Importance was a judgement the model made
 * on the user's behalf, and what matters depends on their situation — whereas
 * what an axis is *about* is a property of the axis. Three or four named groups
 * also cut the number of things to scan from eleven to four, which the fold was
 * only ever a workaround for.
 */
export interface Section {
  id: string;
  /** A short noun phrase. "Subject", not "the subject of the image". */
  label: string;
  axes: Axis[];
  origin?: "model" | "user";
}

export interface Fix {
  label: string;
  set: Record<string, string>;
}

export interface Symptom {
  id: string;
  label: string;
  emit: string;
}

/**
 * The reading of the request the axes were built for.
 *
 * "Design me a website" needs different axes depending on whether it is meant to
 * inform or to sell, so the model picks the likeliest reading, builds axes for
 * it, and hands back the readings it did not take. Nothing stops to ask first —
 * the widget arrives with axes already in it (P3).
 *
 * `alternatives` is what makes the goal showable. With none, the field would draw
 * nothing while `selected` still went into the prompt, and a sentence the user is
 * never shown is exactly the background wrapping the brief forbids — so a goal
 * with no alternatives is dropped whole. See docs/stage0-conflicts.md (C11).
 */
export interface Goal {
  /** The reading taken this time. One sentence. */
  selected: string;
  /** Readings that would have produced genuinely different axes. */
  alternatives: string[];
}

export interface Unfolded {
  title: string;
  /** The user's request, possibly tidied. */
  intent: string;
  goal?: Goal;
  sections: Section[];
  fixes?: Fix[];
  symptoms?: Symptom[];
}

/** Every axis across every section, in display order. */
export function allAxes(unfolded: Unfolded): Axis[] {
  return unfolded.sections.flatMap((s) => s.axes);
}

const MAX_FIXES = 4;
/** Enough to show a real fork without turning the field into a menu. */
const MAX_ALTERNATIVES = 3;

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/**
 * Pull the JSON object out of a model response.
 *
 * The prompt forbids code fences and preamble, but models add them anyway, so
 * strip fences and fall back to the outermost brace pair.
 */
export function extractJson(raw: string): unknown {
  if (!raw) return undefined;
  let text = raw.trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();

  try {
    return JSON.parse(text);
  } catch {
    // Fall through to brace scanning.
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function parseOption(raw: unknown, index: number): Option | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;

  const label = str(o.label) ?? str(o.value);
  if (!label) return undefined;
  const value = str(o.value) ?? `opt-${index}`;

  // An option with no emit is still usable — the label becomes the sentence.
  // Dropping it would silently lose a choice the model meant to offer.
  const emit = str(o.emit) ?? label;

  const option: Option = { value, label, emit };
  if (o.common === true) option.common = true;

  const preview = str(o.preview);
  if (preview) option.preview = preview;

  return option;
}

function parseAxis(raw: unknown, index: number): Axis | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const a = raw as Record<string, unknown>;

  const label = str(a.label);
  if (!label) return undefined;
  const id = str(a.id) ?? `axis-${index}`;

  const rawType = str(a.type);
  let options = Array.isArray(a.options)
    ? (a.options.map(parseOption).filter(Boolean) as Option[])
    : [];

  const rawRange =
    a.range && typeof a.range === "object" ? (a.range as Record<string, unknown>) : undefined;
  const rangeTemplate = rawRange ? str(rawRange.emitTemplate) : undefined;
  const range: AxisRange | undefined =
    rawRange && rangeTemplate
      ? {
          unit: str(rawRange.unit) ?? "",
          emitTemplate: rangeTemplate,
          ...(num(rawRange.min) !== undefined ? { min: num(rawRange.min) } : {}),
          ...(num(rawRange.max) !== undefined ? { max: num(rawRange.max) } : {}),
        }
      : undefined;

  // Trust the declared type only where it can actually be rendered. `sample` is
  // gone; a payload still using it was describing an axis judged by reading the
  // options, which is what `open` with previews now is.
  let type: AxisType;
  if (rawType === "open" || rawType === "closed" || rawType === "multi") {
    type = rawType;
  } else if (rawType === "range") {
    // A range with no usable template is not a range. Fall back on what it carries.
    type = range ? "range" : "open";
  } else if (rawType === "sample" || rawType === "select") {
    // The two retired names. `select` meant "pick from this list", which is
    // `closed` only if the list is genuinely complete — and it usually was not,
    // which is the reason this rewrite happened. Opening is the safer default.
    type = options.length > 0 && options.length <= 5 ? "closed" : "open";
  } else {
    type = range ? "range" : "open";
  }

  if (type === "range" && !range) type = "open";

  let emitTemplate = str(a.emitTemplate);

  if (type === "open") {
    // Examples past a handful stop reading as examples. Trimmed rather than
    // rejected: the axis is still worth having, only the tail is noise.
    if (options.length > MAX_OPEN_EXAMPLES) options = options.slice(0, MAX_OPEN_EXAMPLES);

    // The brief says drop an `open` axis whose template has no `{value}`. Losing
    // a whole axis is the one outcome this tool cannot afford — an axis nobody
    // sees is exactly the failure it exists to prevent — so the template is
    // synthesised from the label instead, the same shape a user-added axis uses.
    if (!emitTemplate || !emitTemplate.includes(VALUE_PLACEHOLDER)) {
      emitTemplate = USER_AXIS_TEMPLATE.replace("{label}", label);
    }
  } else {
    emitTemplate = undefined;
  }

  // `closed` and `multi` are nothing but their chips, so with none they cannot be
  // answered at all. `open` always has its box.
  if ((type === "closed" || type === "multi") && options.length === 0) return undefined;

  const axis: Axis = { id, label, type };
  if (options.length) axis.options = options;
  if (emitTemplate) axis.emitTemplate = emitTemplate;
  if (range) axis.range = range;

  const placeholder = str(a.placeholder);
  if (type === "open" && placeholder) axis.placeholder = placeholder;

  if (a.origin === "user") axis.origin = "user";

  // A user-added axis carries no options, norm, common or default: inventing a
  // usual value for an item the model never thought of would be making it up.
  if (axis.origin === "user") {
    delete axis.options;
    return axis;
  }

  const norm = str(a.norm);
  if (norm) axis.norm = norm;

  const def = str(a.default) ?? num(a.default);
  if (def !== undefined) axis.default = def;

  return axis;
}

function parseFixes(raw: unknown): Fix[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const fixes: Fix[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    const label = str(f.label);
    if (!label || !f.set || typeof f.set !== "object") continue;

    const set: Record<string, string> = {};
    for (const [k, v] of Object.entries(f.set as Record<string, unknown>)) {
      const value = str(v);
      if (value) set[k] = value;
    }
    if (Object.keys(set).length) fixes.push({ label, set });
    if (fixes.length === MAX_FIXES) break;
  }
  return fixes.length ? fixes : undefined;
}

function parseSymptoms(raw: unknown): Symptom[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const symptoms: Symptom[] = [];
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const label = str(s.label);
    if (!label) continue;
    symptoms.push({
      id: str(s.id) ?? `symptom-${i}`,
      label,
      emit: str(s.emit) ?? label,
    });
  }
  return symptoms.length ? symptoms : undefined;
}

function parseSection(raw: unknown, index: number): Section | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const s = raw as Record<string, unknown>;

  const label = str(s.label);
  if (!label) return undefined;

  const axes = Array.isArray(s.axes)
    ? (s.axes.map((a, i) => parseAxis(a, i)).filter(Boolean) as Axis[])
    : [];
  if (axes.length === 0) return undefined;

  const section: Section = { id: str(s.id) ?? `section-${index}`, label, axes };
  if (s.origin === "user") section.origin = "user";
  return section;
}

/**
 * Parse the goal, or `undefined` if there is no showable one.
 *
 * Dropped whole when `alternatives` comes back empty. The field would have
 * nothing to offer, and `selected` would still be written into the prompt — a
 * line the user never saw and cannot change, which is the background wrapping the
 * brief rules out. A goal nobody can switch is not a goal, it is a hidden
 * instruction.
 *
 * Alternatives that merely restate the selected reading are dropped too: the
 * whole value of the field is that the readings fork.
 */
function parseGoal(raw: unknown): Goal | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const g = raw as Record<string, unknown>;

  const selected = str(g.selected);
  if (!selected) return undefined;

  const seen = new Set([selected]);
  const alternatives: string[] = [];
  for (const entry of Array.isArray(g.alternatives) ? g.alternatives : []) {
    const text = str(entry);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    alternatives.push(text);
    if (alternatives.length === MAX_ALTERNATIVES) break;
  }

  if (alternatives.length === 0) return undefined;
  return { selected, alternatives };
}

/**
 * Turn raw model output into an `Unfolded`, or `null` if nothing survives.
 *
 * `request` supplies the intent when the model omitted it, so the assembled
 * prompt is never empty even on a half-broken payload.
 *
 * A payload that still uses a flat `axes` array — an older model, or one that
 * skimmed the instruction — is gathered into a single unnamed section rather
 * than rejected. The grouping is lost, which is a worse widget, but it is not a
 * broken one.
 */
export function parseUnfolded(raw: string | unknown, request: string): Unfolded | null {
  const data = typeof raw === "string" ? extractJson(raw) : raw;
  if (!data || typeof data !== "object") return null;

  const d = data as Record<string, unknown>;

  let sections = Array.isArray(d.sections)
    ? (d.sections.map(parseSection).filter(Boolean) as Section[])
    : [];

  if (sections.length === 0) {
    const flat = Array.isArray(d.axes) ? (d.axes.map(parseAxis).filter(Boolean) as Axis[]) : [];
    if (flat.length === 0) return null;
    sections = [{ id: "axes", label: "", axes: flat }];
  }

  // Duplicate ids would make two rows share one slot in the selection state,
  // and sections make collisions likelier since each is written separately.
  const seenAxes = new Set<string>();
  const seenSections = new Set<string>();
  for (const section of sections) {
    if (seenSections.has(section.id)) section.id = `${section.id}-${seenSections.size}`;
    seenSections.add(section.id);
    for (const axis of section.axes) {
      if (seenAxes.has(axis.id)) axis.id = `${axis.id}-${seenAxes.size}`;
      seenAxes.add(axis.id);
    }
  }

  const intent = str(d.intent) ?? request.trim();
  const unfolded: Unfolded = {
    title: str(d.title) ?? intent.slice(0, 60),
    intent,
    sections,
  };

  const goal = parseGoal(d.goal);
  if (goal) unfolded.goal = goal;

  const fixes = parseFixes(d.fixes);
  if (fixes) unfolded.fixes = fixes;

  const symptoms = parseSymptoms(d.symptoms);
  if (symptoms) unfolded.symptoms = symptoms;

  return unfolded;
}

/**
 * Generic axes for when extraction fails twice.
 *
 * Purpose, audience, length, format, tone — the five that apply to almost any
 * request. Deliberately unopinionated: no option is marked `common`, because
 * guessing a usual value across all possible tasks would be a preference claim.
 *
 * They arrive as one unnamed section. Inventing group names for axes this
 * generic would be naming for the sake of naming — the whole point of a section
 * label is that it fits the actual task, and here there is no task to fit.
 */
export function fallbackUnfolded(request: string): Unfolded {
  const intent = request.trim();
  const ko = detectLocale(intent) === "ko";

  const axes: Axis[] = ko
    ? [
        {
          id: "purpose",
          label: "목적",
          type: "open",
          emitTemplate: "글의 목적은 {value}.",
          options: [
            {
              value: "inform",
              label: "설명",
              emit: "읽는 사람이 내용을 이해하는 것을 목적으로 한다.",
            },
            {
              value: "persuade",
              label: "설득",
              emit: "읽는 사람의 판단을 바꾸는 것을 목적으로 한다.",
            },
            {
              value: "record",
              label: "기록",
              emit: "나중에 다시 찾아볼 수 있게 남기는 것을 목적으로 한다.",
            },
          ],
        },
        {
          id: "audience",
          label: "독자",
          type: "open",
          emitTemplate: "읽는 사람은 {value}.",
          options: [
            {
              value: "expert",
              label: "전문가",
              emit: "해당 분야를 아는 사람을 독자로 삼아 용어를 풀지 않는다.",
            },
            {
              value: "general",
              label: "일반",
              emit: "배경지식이 없는 사람도 읽을 수 있게 용어를 풀어 쓴다.",
            },
            {
              value: "self",
              label: "본인",
              emit: "본인만 보는 글이므로 설명을 생략하고 요점만 남긴다.",
            },
          ],
        },
        {
          id: "length",
          label: "분량",
          type: "open",
          emitTemplate: "분량은 {value}.",
          options: [
            { value: "short", label: "짧게", emit: "핵심만 담아 짧게 쓴다." },
            { value: "medium", label: "보통", emit: "요점과 근거를 함께 담아 보통 길이로 쓴다." },
            { value: "long", label: "길게", emit: "배경과 예시까지 포함해 자세히 쓴다." },
          ],
        },
        {
          id: "format",
          label: "형식",
          type: "open",
          emitTemplate: "형식은 {value}.",
          options: [
            { value: "prose", label: "줄글", emit: "문단으로 이어지는 줄글로 쓴다." },
            { value: "bullets", label: "목록", emit: "항목을 나눈 목록 형태로 쓴다." },
            { value: "table", label: "표", emit: "비교가 드러나도록 표로 정리한다." },
          ],
        },
        {
          id: "tone",
          label: "톤",
          type: "open",
          emitTemplate: "톤은 {value}.",
          options: [
            { value: "plain", label: "담백하게", emit: "수식을 줄이고 담백한 톤으로 쓴다." },
            { value: "formal", label: "격식", emit: "격식을 갖춘 문어체로 쓴다." },
            { value: "casual", label: "구어체", emit: "대화하듯 편한 구어체로 쓴다." },
          ],
        },
      ]
    : [
        {
          id: "purpose",
          label: "Purpose",
          type: "open",
          emitTemplate: "The purpose is {value}.",
          options: [
            {
              value: "inform",
              label: "Inform",
              emit: "The aim is for the reader to understand the material.",
            },
            {
              value: "persuade",
              label: "Persuade",
              emit: "The aim is to change the reader's judgement.",
            },
            {
              value: "record",
              label: "Record",
              emit: "The aim is a record that holds up when revisited later.",
            },
          ],
        },
        {
          id: "audience",
          label: "Audience",
          type: "open",
          emitTemplate: "The reader is {value}.",
          options: [
            {
              value: "expert",
              label: "Expert",
              emit: "Written for someone in the field; terms are left unexplained.",
            },
            {
              value: "general",
              label: "General",
              emit: "Written so someone without background can follow it; terms are explained.",
            },
            {
              value: "self",
              label: "Just me",
              emit: "Written only for myself, so skip explanation and keep the points.",
            },
          ],
        },
        {
          id: "length",
          label: "Length",
          type: "open",
          emitTemplate: "The length is {value}.",
          options: [
            { value: "short", label: "Short", emit: "Keep it short — the essentials only." },
            {
              value: "medium",
              label: "Medium",
              emit: "Medium length, covering the points and the reasoning behind them.",
            },
            {
              value: "long",
              label: "Long",
              emit: "Go into detail, including background and examples.",
            },
          ],
        },
        {
          id: "format",
          label: "Format",
          type: "open",
          emitTemplate: "The format is {value}.",
          options: [
            { value: "prose", label: "Prose", emit: "Write it as connected paragraphs." },
            { value: "bullets", label: "List", emit: "Write it as a list of separated points." },
            {
              value: "table",
              label: "Table",
              emit: "Lay it out as a table so the comparison is visible.",
            },
          ],
        },
        {
          id: "tone",
          label: "Tone",
          type: "open",
          emitTemplate: "The tone is {value}.",
          options: [
            { value: "plain", label: "Plain", emit: "Keep the tone plain and unadorned." },
            { value: "formal", label: "Formal", emit: "Use a formal register." },
            { value: "casual", label: "Casual", emit: "Write it conversationally." },
          ],
        },
      ];

  return {
    title: intent.slice(0, 60),
    intent,
    sections: [{ id: "general", label: "", axes }],
  };
}
