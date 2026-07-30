/**
 * Presets in a file the user owns.
 *
 * This directory is the only place node APIs are allowed — the Worker has no
 * filesystem, so a local run is the one shape in which presets can exist at all.
 * `tsconfig.json` excludes it; `src/local/tsconfig.json` typechecks it against
 * node types instead.
 *
 * The file is the user's, on the user's disk, written by a server running as the
 * user. That is what makes storing `intent` here different from the remote Worker
 * keeping a request: there is no server-side retention to speak of. See
 * docs/stage0-conflicts.md (C12).
 *
 * Writes are atomic — a temporary file then a rename — so an interrupted save
 * cannot leave a half-written JSON file where the presets used to be.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Preset, PresetDraft } from "../lib/preset.js";
import {
  applyDraft,
  byRecency,
  defaultDeps,
  markUsed,
  type PresetStore,
  type StoreDeps,
} from "../lib/preset-store.js";

/** Overridable so a test never writes to a real home directory. */
export function defaultPath(): string {
  const base = process.env.UNKNOWN_UNKNOWNS_HOME ?? join(homedir(), ".unknown-unknowns");
  return join(base, "presets.json");
}

interface FileShape {
  version: 1;
  presets: Preset[];
}

export class FilePresetStore implements PresetStore {
  private loaded?: Map<string, Preset>;

  constructor(
    private path: string = defaultPath(),
    private deps: StoreDeps = defaultDeps,
  ) {}

  /**
   * Read the file, tolerating every way it can be unusable.
   *
   * A missing file is the normal first run. A corrupt one is treated as empty
   * rather than fatal: refusing to start because a preset file was mangled would
   * take away axis extraction too, and the brief is explicit that a storage
   * failure must not stop the part that never needed storage.
   */
  private async records(): Promise<Map<string, Preset>> {
    if (this.loaded) return this.loaded;

    const map = new Map<string, Preset>();
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      for (const preset of Array.isArray(parsed?.presets) ? parsed.presets : []) {
        if (preset && typeof preset.id === "string") map.set(preset.id, preset);
      }
    } catch {
      // Missing, unreadable or malformed — start from nothing.
    }

    this.loaded = map;
    return map;
  }

  private async flush(records: Map<string, Preset>): Promise<void> {
    const body: FileShape = { version: 1, presets: byRecency([...records.values()]) };
    await mkdir(dirname(this.path), { recursive: true });

    const temp = `${this.path}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(body, null, 2), "utf8");
    await rename(temp, this.path);
  }

  async list(): Promise<Preset[]> {
    return byRecency([...(await this.records()).values()]);
  }

  async get(id: string): Promise<Preset | undefined> {
    return (await this.records()).get(id);
  }

  async touch(id: string): Promise<Preset | undefined> {
    const records = await this.records();
    const used = markUsed(records, id, this.deps);
    if (used) await this.flush(records);
    return used;
  }

  async save(draft: PresetDraft, overwriteId?: string): Promise<Preset> {
    const records = await this.records();
    const saved = applyDraft(records, draft, this.deps, overwriteId);
    await this.flush(records);
    return saved;
  }

  async remove(id: string): Promise<boolean> {
    const records = await this.records();
    if (!records.delete(id)) return false;
    await this.flush(records);
    return true;
  }
}
