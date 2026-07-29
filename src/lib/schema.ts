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
   * Only meaningful on a `sample` axis, where a label alone does not convey the
   * difference. Written by the extracting model along with the axes — there is
   * no second pass, because reaching a model again would mean another round
   * through the conversation.
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

export interface Axis {
  id: string;
  label: string;
  group: "core" | "extra";
  type: "select" | "multi" | "range" | "sample";
  options?: Option[];
  range?: AxisRange;
  /** One-line help. The usual range, not a preference. */
  norm?: string;
  /** When present the value is applied on the user's behalf. */
  default?: string | number | null;
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

export interface Unfolded {
  title: string;
  /** The user's request, possibly tidied. */
  intent: string;
  axes: Axis[];
  fixes?: Fix[];
  symptoms?: Symptom[];
}

const AXIS_TYPES = new Set(["select", "multi", "range", "sample"]);
const MAX_FIXES = 4;

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
  const options = Array.isArray(a.options)
    ? (a.options.map(parseOption).filter(Boolean) as Option[])
    : [];

  const rawRange = a.range && typeof a.range === "object" ? (a.range as Record<string, unknown>) : undefined;
  const emitTemplate = rawRange ? str(rawRange.emitTemplate) : undefined;
  const range: AxisRange | undefined =
    rawRange && emitTemplate
      ? {
          unit: str(rawRange.unit) ?? "",
          emitTemplate,
          ...(num(rawRange.min) !== undefined ? { min: num(rawRange.min) } : {}),
          ...(num(rawRange.max) !== undefined ? { max: num(rawRange.max) } : {}),
        }
      : undefined;

  // Trust the declared type only if it can actually be rendered; otherwise infer
  // from what the axis carries. A "range" with no usable template would render
  // as a dead row.
  let type: Axis["type"];
  if (rawType && AXIS_TYPES.has(rawType)) {
    type = rawType as Axis["type"];
    if (type === "range" && !range) type = options.length ? "select" : "sample";
  } else {
    type = range ? "range" : "select";
  }

  if (type !== "range" && options.length === 0 && type !== "sample") return undefined;

  const axis: Axis = {
    id,
    label,
    group: str(a.group) === "core" ? "core" : "extra",
    type,
  };
  if (options.length) axis.options = options;
  if (range) axis.range = range;

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

/**
 * Turn raw model output into an `Unfolded`, or `null` if nothing survives.
 *
 * `request` supplies the intent when the model omitted it, so the assembled
 * prompt is never empty even on a half-broken payload.
 */
export function parseUnfolded(raw: string | unknown, request: string): Unfolded | null {
  const data = typeof raw === "string" ? extractJson(raw) : raw;
  if (!data || typeof data !== "object") return null;

  const d = data as Record<string, unknown>;
  const axes = Array.isArray(d.axes)
    ? (d.axes.map(parseAxis).filter(Boolean) as Axis[])
    : [];
  if (axes.length === 0) return null;

  // Duplicate ids would make two rows share one slot in the selection state.
  const seen = new Set<string>();
  for (const axis of axes) {
    if (seen.has(axis.id)) axis.id = `${axis.id}-${seen.size}`;
    seen.add(axis.id);
  }

  const intent = str(d.intent) ?? request.trim();
  const unfolded: Unfolded = {
    title: str(d.title) ?? intent.slice(0, 60),
    intent,
    axes,
  };

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
 */
export function fallbackUnfolded(request: string): Unfolded {
  const intent = request.trim();
  const ko = detectLocale(intent) === "ko";

  const axes: Axis[] = ko
    ? [
        {
          id: "purpose",
          label: "목적",
          group: "core",
          type: "select",
          options: [
            { value: "inform", label: "설명", emit: "읽는 사람이 내용을 이해하는 것을 목적으로 한다." },
            { value: "persuade", label: "설득", emit: "읽는 사람의 판단을 바꾸는 것을 목적으로 한다." },
            { value: "record", label: "기록", emit: "나중에 다시 찾아볼 수 있게 남기는 것을 목적으로 한다." },
          ],
        },
        {
          id: "audience",
          label: "독자",
          group: "core",
          type: "select",
          options: [
            { value: "expert", label: "전문가", emit: "해당 분야를 아는 사람을 독자로 삼아 용어를 풀지 않는다." },
            { value: "general", label: "일반", emit: "배경지식이 없는 사람도 읽을 수 있게 용어를 풀어 쓴다." },
            { value: "self", label: "본인", emit: "본인만 보는 글이므로 설명을 생략하고 요점만 남긴다." },
          ],
        },
        {
          id: "length",
          label: "분량",
          group: "core",
          type: "select",
          options: [
            { value: "short", label: "짧게", emit: "핵심만 담아 짧게 쓴다." },
            { value: "medium", label: "보통", emit: "요점과 근거를 함께 담아 보통 길이로 쓴다." },
            { value: "long", label: "길게", emit: "배경과 예시까지 포함해 자세히 쓴다." },
          ],
        },
        {
          id: "format",
          label: "형식",
          group: "extra",
          type: "select",
          options: [
            { value: "prose", label: "줄글", emit: "문단으로 이어지는 줄글로 쓴다." },
            { value: "bullets", label: "목록", emit: "항목을 나눈 목록 형태로 쓴다." },
            { value: "table", label: "표", emit: "비교가 드러나도록 표로 정리한다." },
          ],
        },
        {
          id: "tone",
          label: "톤",
          group: "extra",
          type: "select",
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
          group: "core",
          type: "select",
          options: [
            { value: "inform", label: "Inform", emit: "The aim is for the reader to understand the material." },
            { value: "persuade", label: "Persuade", emit: "The aim is to change the reader's judgement." },
            { value: "record", label: "Record", emit: "The aim is a record that holds up when revisited later." },
          ],
        },
        {
          id: "audience",
          label: "Audience",
          group: "core",
          type: "select",
          options: [
            { value: "expert", label: "Expert", emit: "Written for someone in the field; terms are left unexplained." },
            { value: "general", label: "General", emit: "Written so someone without background can follow it; terms are explained." },
            { value: "self", label: "Just me", emit: "Written only for myself, so skip explanation and keep the points." },
          ],
        },
        {
          id: "length",
          label: "Length",
          group: "core",
          type: "select",
          options: [
            { value: "short", label: "Short", emit: "Keep it short — the essentials only." },
            { value: "medium", label: "Medium", emit: "Medium length, covering the points and the reasoning behind them." },
            { value: "long", label: "Long", emit: "Go into detail, including background and examples." },
          ],
        },
        {
          id: "format",
          label: "Format",
          group: "extra",
          type: "select",
          options: [
            { value: "prose", label: "Prose", emit: "Write it as connected paragraphs." },
            { value: "bullets", label: "List", emit: "Write it as a list of separated points." },
            { value: "table", label: "Table", emit: "Lay it out as a table so the comparison is visible." },
          ],
        },
        {
          id: "tone",
          label: "Tone",
          group: "extra",
          type: "select",
          options: [
            { value: "plain", label: "Plain", emit: "Keep the tone plain and unadorned." },
            { value: "formal", label: "Formal", emit: "Use a formal register." },
            { value: "casual", label: "Casual", emit: "Write it conversationally." },
          ],
        },
      ];

  return { title: intent.slice(0, 60), intent, axes };
}
