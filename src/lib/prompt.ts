/**
 * The axis-extraction instruction.
 *
 * One text, two delivery routes: handed to `sampling/createMessage` when the
 * client supports sampling, and returned as tool-result text for the host model
 * to act on when it doesn't. Keeping a single source means the two paths can't
 * drift into producing differently-shaped axes.
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

const SCHEMA = `interface Option {
  value: string;
  label: string;
  emit: string;        // the sentence inserted into the prompt; include the reason
  common?: boolean;    // usual value; shown as a small dot, never auto-selected
}

interface Axis {
  id: string;
  label: string;
  group: 'core' | 'extra';
  type: 'select' | 'multi' | 'range' | 'sample';
  options?: Option[];
  range?: { unit: string; min?: number; max?: number; emitTemplate: string };
  norm?: string;       // one line of help, e.g. "usually 32-48pt, 2-3x the body text"
  default?: string | number | null;   // if present, shown as decided-on-your-behalf
}

interface Unfolded {
  title: string;
  intent: string;      // the user's request, optionally tidied
  axes: Axis[];        // no count limit
  fixes?: { label: string; set: Record<string, string> }[];   // at most 4
  symptoms?: { id: string; label: string; emit: string }[];
}`;

export const TASK = `Find what this request leaves undecided.

List the things the user could still specify but hasn't, as axes with choices.
If source material is given, fit the axes to what the material actually contains.
Do not cap the count artificially — pull every axis that genuinely matters.
Mark the 3-4 that change the result most as \`core\`; everything else is \`extra\`.

Rules for the values you write:
- \`emit\` is a full sentence that will be pasted into a prompt, and it carries its
  own reason. Not "black" but "The cat's coat is black, so it reads clearly
  against a light background."
- \`norm\` states the usual range as information, never as a recommendation about
  the user's taste. "Usually 32-48pt" is fine; "you'll want 40pt" is not.
- \`common\` marks a conventional value. It is a dot on the chip, not a default.
- Use \`range\` for anything continuous (size, count, duration) and give an
  \`emitTemplate\` containing \`{value}\`.
- Use \`sample\` for axes best judged by seeing a sample rather than reading a label.
- \`default\` only where a value genuinely must exist for the task to proceed.`;

export interface PromptInput {
  request: string;
  source?: string;
}

/** Build the full instruction, source included when present. */
export function buildExtractionPrompt({ request, source }: PromptInput): string {
  const clamped = clampSource(source);
  const language = describeLanguage(request);

  const parts = [
    TASK,
    "",
    `Write every label, option label, \`emit\` sentence and \`norm\` in ${language}.`,
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

/**
 * The same instruction, addressed to the host model.
 *
 * Used when the client has no sampling capability — which, as of the 2026-01-26
 * apps extension, includes Claude. The host model reads this, produces the JSON,
 * and calls `unfold` again with it, at which point the widget renders. See
 * docs/stage0-conflicts.md (C1).
 */
export function buildHostFallbackPrompt(input: PromptInput): string {
  return [
    buildExtractionPrompt(input),
    "",
    "---",
    "",
    "Then call `unfold` again with the identical `request` and `source` you were",
    "given, plus `unfolded` set to the JSON string you just produced. That second",
    "call renders the widget. Do not show the JSON to the user and do not answer",
    "the request itself — the user decides from the widget first.",
  ].join("\n");
}
