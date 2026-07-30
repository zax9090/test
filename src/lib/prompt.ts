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
  preview?: string;    // open axes: 2-3 lines showing what this direction reads like
}

interface Axis {
  id: string;
  label: string;
  type: 'open' | 'closed' | 'multi' | 'range';
  options?: Option[];       // 'open': examples, 3-6. 'closed'/'multi': the choices
  emitTemplate?: string;    // 'open' only, required, must contain {value}
  placeholder?: string;     // 'open' only: an example NOT in the list
  range?: { unit: string; min?: number; max?: number; emitTemplate: string };
  norm?: string;       // one line of help, e.g. "usually 32-48pt, 2-3x the body text"
  default?: string | number | null;   // if present, shown as decided-on-your-behalf
}

interface Section {
  id: string;
  label: string;       // a short noun phrase: "Subject", not "the subject of the image"
  axes: Axis[];
}

interface Goal {
  selected: string;        // the reading you built these axes for; one sentence
  alternatives: string[];  // 2-3 readings that would need different axes
}

interface Unfolded {
  title: string;
  intent: string;      // the user's request, optionally tidied
  goal?: Goal;         // omit when the request is already specific
  sections: Section[]; // 3-4 of them, 2+ axes each
  fixes?: { label: string; set: Record<string, string> }[];   // at most 4
  symptoms?: { id: string; label: string; emit: string }[];
}`;

export const TASK = `Find what the request leaves undecided.

If the request could be read several ways and the readings would need different
axes, pick the likeliest one, put it in \`goal.selected\` as a single sentence, and
build the axes for that reading. Put 2-3 other readings in \`alternatives\`:
- They must fork the axes, not the wording. "An informational site" and "a store"
  need different axes; "a nice site" and "a good site" do not.
- Do not stop to ask which one. Choose, build, and let the user switch.
- Omit \`goal\` entirely when the request is already specific enough that there is
  only one sensible reading. An unswitchable goal is just a hidden instruction.

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
- \`default\` only where a value genuinely must exist for the task to proceed.

Choosing between \`open\` and \`closed\` — ask one question: can the values of this
axis be listed exhaustively?
- Listable, and genuinely all of them: \`closed\`. Aspect ratio really is 1:1,
  16:9, 9:16. Two to five options.
- Not listable: \`open\`. Coat colour, breed, art style, lighting, tone, audience.
  There is no complete list, and a list of five would tell the user those are the
  options when they are not.
- When it is unclear, use \`open\`. Closing an axis hides values the user wanted;
  opening one that could have been closed costs nothing.

On an \`open\` axis:
- \`options\` are *examples*, not a menu. Give 3-6, picking the most common or the
  most unlike each other. The user will type something that is not there, and
  that is the expected outcome, not a failure.
- \`emitTemplate\` is required and must contain \`{value}\`. Whatever the user types
  goes in that slot verbatim, so write a sentence that reads correctly with any
  value: "The coat is {value}." — never "The coat is {value}, which photographs
  well", because that reason may be false for what they typed.
- \`placeholder\` should name a value that is *not* in \`options\`, so the box
  visibly invites something of the user's own.
- Give an option a \`preview\` when a label cannot convey the difference — voice,
  register, an opening line. 2-3 lines written in that direction, using the source
  material if there is any, so the difference can be read rather than imagined.`;

export interface PromptInput {
  request: string;
  source?: string;
  /** A reading the user picked or typed. Settles the goal instead of choosing one. */
  goal?: string;
}

/** Build the sampling instruction, source included when present. */
export function buildExtractionPrompt({ request, source, goal }: PromptInput): string {
  const clamped = clampSource(source);
  const chosen = goal?.trim();

  const parts = [
    TASK,
    "",
    `The request is written in ${describeLanguage(request)} — match it.`,
    "",
    "Request:",
    request.trim(),
  ];

  // The user has already settled the reading, so there is nothing to choose. The
  // alternatives still come back: switching once must not strand them on that
  // reading with no way back.
  if (chosen) {
    parts.push(
      "",
      "The user has chosen this reading. Build the axes for it and put it in",
      "`goal.selected` verbatim, with other readings still in `alternatives`:",
      chosen,
    );
  }

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
