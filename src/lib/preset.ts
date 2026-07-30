/**
 * What a preset is, and what must never be inside one.
 *
 * Pure: no I/O, no clock, no filesystem. The store is a separate module so this
 * one can be reasoned about — and tested — on its own.
 *
 * A preset holds the reading, the axis structure and the values that were chosen.
 * It does not hold the material the task was about. In repeat work the material is
 * the only thing that changes, so it is not a thing worth saving; saving it would
 * only create something to look after.
 *
 * Where a preset lives matters to that promise. The remote Worker keeps nothing
 * (P1) and registers no preset tools at all. Presets exist only when the server is
 * running locally, as the user, writing a file the user owns — which is why storing
 * `intent` here is not the server retaining a request. See
 * docs/stage0-conflicts.md (C12).
 */

import type { Section, Unfolded } from "./schema.js";

/**
 * Field names that carry the user's material, at any depth.
 *
 * `source` is the box itself. `preview` is subtler and was nearly missed: the
 * extraction instruction tells the model to write sample previews "using the
 * source material if there is any", so a preview is the user's document in
 * paraphrase. It lives inside `sections`, which is exactly what a preset stores,
 * and a check that only looks for a key called `source` would never have caught
 * it. §7 rules out keeping the material "in any form", so it goes.
 *
 * The cost is real and accepted: a loaded preset's sample axes have no previews,
 * so those directions must be read as labels until the axes are rebuilt.
 */
const MATERIAL_KEYS = new Set(["source", "preview"]);

/** What actually gets written down. */
export interface Preset {
  id: string;
  name: string;
  /** The request line. On a local file this is the user's own note to themselves. */
  intent: string;
  goal?: string;
  sections: Section[];
  /** Axis id to chosen value, as the widget held it. */
  selections: Record<string, unknown>;
  symptoms?: string[];
  uses: number;
  lastUsedAt?: number;
  createdAt: number;
  updatedAt: number;
}

/** A preset on its way in, before the store assigns ids and counters. */
export interface PresetDraft {
  name: string;
  intent: string;
  goal?: string;
  sections: Section[];
  selections: Record<string, unknown>;
  symptoms?: string[];
}

/**
 * Remove the user's material from anything, however deeply it is buried.
 *
 * Walks every object and array rather than checking the top level, because the
 * leak this exists to stop is not at the top level — it is a `preview` string
 * three levels down inside an option. Cycles are tolerated: a self-referential
 * payload returns what it can rather than hanging.
 *
 * Returns a new value. The input is never mutated, so a caller cannot accidentally
 * strip the live widget state it is about to render.
 */
export function stripMaterial<T>(value: T): T {
  return walk(value, new WeakSet()) as T;
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (Array.isArray(value)) {
    if (seen.has(value)) return [];
    seen.add(value);
    return value.map((entry) => walk(entry, seen));
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) return {};
    seen.add(value);

    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (MATERIAL_KEYS.has(key)) continue;
      out[key] = walk(entry, seen);
    }
    return out;
  }

  return value;
}

/**
 * Build the draft a save writes.
 *
 * Everything passes through {@link stripMaterial} on the way in, so the store
 * cannot be handed material even by a caller that forgot. The freeform box is
 * dropped outright — it is this-time-only text, not a setting.
 */
export function draftFrom(
  name: string,
  unfolded: Unfolded,
  selections: Record<string, unknown>,
  symptoms?: string[],
): PresetDraft {
  const draft: PresetDraft = {
    name: name.trim(),
    intent: unfolded.intent.trim(),
    sections: stripMaterial(unfolded.sections),
    selections: stripMaterial(selections),
  };

  if (unfolded.goal) draft.goal = unfolded.goal.selected;
  if (symptoms?.length) draft.symptoms = [...symptoms];
  return draft;
}

/**
 * Turn a stored preset back into something the widget can render.
 *
 * No model call: the axes are already written down. The goal comes back as a
 * `Goal` with no alternatives, which the parser would normally drop — here it is
 * built directly because a loaded goal is not a reading the model just took, it is
 * one the user settled earlier, and it is on screen and editable either way.
 */
export function unfoldedFrom(preset: Preset): Unfolded {
  const unfolded: Unfolded = {
    title: preset.name,
    intent: preset.intent,
    sections: preset.sections,
  };
  if (preset.goal) unfolded.goal = { selected: preset.goal, alternatives: [] };
  return unfolded;
}
