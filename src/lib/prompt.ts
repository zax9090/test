/**
 * The axis-extraction instruction.
 *
 * One text, two deliveries. Where the host implements sampling the server sends
 * it through `sampling/createMessage`. Where it does not — which is every Claude
 * surface today — the same instruction is carried in the tool description, and
 * the host model produces the axes as tool arguments.
 *
 * Keeping a single source means the two routes cannot drift into producing
 * differently-shaped axes.
 */

import { describeLanguage } from "./locale.js";

/** Source cap from the brief. Anything longer keeps only the head. */
export const SOURCE_LIMIT = 8_000;

export function clampSource(source: string | undefined): string | undefined {
  if (!source) return undefined;
  const trimmed = source.trim();
  if (!trimmed) return undefined;
  return trimmed.length > SOURCE_LIMIT ? trimmed.slice(0, SOURCE_LIMIT) : trimmed;
}

export const SCHEMA = `interface Option {
  value: string;
  label: string;
  emit: string;        // the sentence inserted into the prompt; include the reason
  common?: boolean;    // usual value; shown as a small dot, never auto-selected
  preview?: string;    // sample axes only: 2-3 lines showing what this reads like
}

interface Axis {
  id: string;
  label: string;
  type: 'select' | 'multi' | 'range' | 'sample';
  options?: Option[];
  range?: { unit: string; min?: number; max?: number; emitTemplate: string };
  norm?: string;       // one line of help, e.g. "usually 32-48pt, 2-3x the body text"
  default?: string | number | null;   // if present, shown as decided-on-your-behalf
}

interface Section {
  id: string;
  label: string;       // a short noun phrase: "Subject", not "the subject of the image"
  axes: Axis[];
}

interface Unfolded {
  title: string;
  intent: string;      // the user's request, optionally tidied
  sections: Section[]; // 3-4 of them, 2+ axes each
  fixes?: { label: string; set: Record<string, string> }[];   // at most 4
  symptoms?: { id: string; label: string; emit: string }[];
}`;

export const TASK = `Find what the request leaves undecided.

List the things the user could still specify but hasn't, as axes with choices.
If source material is given, fit the axes to what the material actually contains.
Do not cap the count artificially — pull every axis that genuinely matters.

Then group those axes by what they are about, into sections:
- 3-4 sections, each holding 2 or more axes. One axis per section is not a
  grouping, it is the same flat list with extra headings.
- Name the sections for this task. There is no fixed taxonomy: an image might
  divide into subject, frame and setting, a piece of writing into audience,
  content and form.
- A section label is a short noun phrase. "Subject", not "the subject of the
  image" — a heading long enough to read is a heading that gets in the way of
  scanning.
- Inside a section, put the axis that changes the result most at the top. Do not
  mark it in any way; the position is the whole signal.

Rules for the values you write:
- Write every label, option label, \`emit\` sentence and \`norm\` in the same
  language the user wrote their request in.
- \`emit\` is a full sentence that will be pasted into a prompt, and it carries its
  own reason. Not "black" but "The cat's coat is black, so it reads clearly
  against a light background."
- \`norm\` states the usual range as information, never as a recommendation about
  the user's taste. "Usually 32-48pt" is fine; "you'll want 40pt" is not.
- \`common\` marks a conventional value. It is a dot on the chip, not a default.
- Use \`range\` for anything continuous (size, count, duration) and give an
  \`emitTemplate\` containing \`{value}\`.
- Use \`sample\` for axes best judged by seeing a sample rather than reading a
  label — voice, register, opening line. On those, give every option a
  \`preview\`: 2-3 lines written in that direction, using the source material if
  there is any, so the difference can be read rather than imagined.
- \`default\` only where a value genuinely must exist for the task to proceed.`;

export interface PromptInput {
  request: string;
  source?: string;
}

/** Build the sampling instruction, source included when present. */
export function buildExtractionPrompt({ request, source }: PromptInput): string {
  const clamped = clampSource(source);

  const parts = [
    TASK,
    "",
    `The request is written in ${describeLanguage(request)} — match it.`,
    "",
    "Request:",
    request.trim(),
  ];

  if (clamped) {
    parts.push(
      "",
      "Source material:",
      clamped,
      ...(clamped.length === SOURCE_LIMIT ? ["(truncated)"] : []),
    );
  }

  parts.push(
    "",
    "Reply with JSON matching this shape:",
    "",
    SCHEMA,
    "",
    "Output the JSON object only. No code fence, no preamble, no trailing commentary.",
  );

  return parts.join("\n");
}
