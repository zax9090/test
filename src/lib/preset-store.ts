/**
 * The preset store contract, and an in-memory implementation.
 *
 * Kept free of any filesystem import so it typechecks against the Worker's type
 * set and can be tested without touching a disk. The file-backed implementation
 * lives in `src/local/`, which is the only place node APIs are allowed.
 *
 * Every write goes through {@link stripMaterial} here as well as in `draftFrom`.
 * That is deliberate belt-and-braces: the guarantee "a stored preset holds no
 * material" should not depend on which of two callers remembered.
 */

import { stripMaterial, type Preset, type PresetDraft } from "./preset.js";

export interface PresetStore {
  /** Most recently used first, so the list reflects what is actually reached for. */
  list(): Promise<Preset[]>;
  get(id: string): Promise<Preset | undefined>;
  /** Bumps `uses` and `lastUsedAt`. Reading a preset is using it. */
  touch(id: string): Promise<Preset | undefined>;
  save(draft: PresetDraft, overwriteId?: string): Promise<Preset>;
  remove(id: string): Promise<boolean>;
}

/** Injected so tests are not at the mercy of the clock. */
export interface StoreDeps {
  now: () => number;
  id: () => string;
}

export const defaultDeps: StoreDeps = {
  now: () => Date.now(),
  id: () => crypto.randomUUID(),
};

/**
 * Sorted newest-used first, falling back to creation order for presets never
 * loaded. §3 allows ordering by use; it does not allow inferring taste from it,
 * so this is the only place `uses` is read.
 */
export function byRecency(presets: Preset[]): Preset[] {
  return [...presets].sort((a, b) => (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt));
}

/**
 * Apply a draft to a record set, returning the saved preset.
 *
 * Shared by every implementation so the counter and timestamp rules cannot drift
 * between them. `overwriteId` keeps the original `createdAt` and `uses` — an
 * overwrite is the same preset with different values, not a new one.
 */
export function applyDraft(
  records: Map<string, Preset>,
  draft: PresetDraft,
  deps: StoreDeps,
  overwriteId?: string,
): Preset {
  const clean = stripMaterial(draft);
  const at = deps.now();
  const existing = overwriteId ? records.get(overwriteId) : undefined;

  const preset: Preset = {
    id: existing?.id ?? deps.id(),
    name: clean.name,
    intent: clean.intent,
    sections: clean.sections,
    selections: clean.selections,
    uses: existing?.uses ?? 0,
    createdAt: existing?.createdAt ?? at,
    updatedAt: at,
    ...(clean.goal ? { goal: clean.goal } : {}),
    ...(clean.symptoms?.length ? { symptoms: clean.symptoms } : {}),
    ...(existing?.lastUsedAt !== undefined ? { lastUsedAt: existing.lastUsedAt } : {}),
  };

  records.set(preset.id, preset);
  return preset;
}

/** Bump the use counter. Returns the updated record, or undefined if it is gone. */
export function markUsed(
  records: Map<string, Preset>,
  id: string,
  deps: StoreDeps,
): Preset | undefined {
  const found = records.get(id);
  if (!found) return undefined;

  const used: Preset = { ...found, uses: found.uses + 1, lastUsedAt: deps.now() };
  records.set(id, used);
  return used;
}

/** For tests and for the remote server, which has nowhere to write. */
export class MemoryPresetStore implements PresetStore {
  private records = new Map<string, Preset>();

  constructor(private deps: StoreDeps = defaultDeps) {}

  async list(): Promise<Preset[]> {
    return byRecency([...this.records.values()]);
  }

  async get(id: string): Promise<Preset | undefined> {
    return this.records.get(id);
  }

  async touch(id: string): Promise<Preset | undefined> {
    return markUsed(this.records, id, this.deps);
  }

  async save(draft: PresetDraft, overwriteId?: string): Promise<Preset> {
    return applyDraft(this.records, draft, this.deps, overwriteId);
  }

  async remove(id: string): Promise<boolean> {
    return this.records.delete(id);
  }
}
