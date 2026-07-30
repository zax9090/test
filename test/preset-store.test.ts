/**
 * The store contract, on the implementation that needs no disk.
 *
 * The file-backed store shares `applyDraft`, `markUsed` and `byRecency` with this
 * one, so the counter and ordering rules are pinned here once rather than twice.
 * Its own round trip is covered in `src/local/file-store.test.ts`.
 */

import { describe, expect, it } from "vitest";

import { draftFrom } from "../src/lib/preset.js";
import { MemoryPresetStore, byRecency, type StoreDeps } from "../src/lib/preset-store.js";
import type { Preset } from "../src/lib/preset.js";
import type { Unfolded } from "../src/lib/schema.js";

/** A clock and an id source that move only when told to. */
function fakeDeps(): StoreDeps & { at: number; next: number } {
  const deps = {
    at: 1_000,
    next: 0,
    now() {
      return deps.at;
    },
    id() {
      deps.next += 1;
      return `id-${deps.next}`;
    },
  };
  return deps;
}

const unfolded: Unfolded = {
  title: "회의록",
  intent: "회의록 요약해줘",
  sections: [
    {
      id: "form",
      label: "형식",
      axes: [
        {
          id: "length",
          label: "분량",
          type: "closed",
          options: [{ value: "short", label: "짧게", emit: "짧게 쓴다." }],
        },
      ],
    },
  ],
};

const draft = (name: string, selections: Record<string, unknown> = { length: "short" }) =>
  draftFrom(name, unfolded, selections);

describe("saving", () => {
  it("assigns an id and starts the counter at zero", async () => {
    const deps = fakeDeps();
    const store = new MemoryPresetStore(deps);
    const saved = await store.save(draft("주간보고"));

    expect(saved.id).toBe("id-1");
    expect(saved.uses).toBe(0);
    expect(saved.createdAt).toBe(1_000);
    expect(saved.lastUsedAt).toBeUndefined();
  });

  it("overwrites in place, keeping the original id, createdAt and use count", async () => {
    const deps = fakeDeps();
    const store = new MemoryPresetStore(deps);
    const first = await store.save(draft("주간보고"));
    await store.touch(first.id);

    deps.at = 2_000;
    const again = await store.save(draft("주간보고", { length: "long" }), first.id);

    expect(again.id).toBe(first.id);
    expect(again.createdAt).toBe(1_000);
    expect(again.updatedAt).toBe(2_000);
    expect(again.uses).toBe(1); // an overwrite is not a fresh preset
    expect(again.selections).toEqual({ length: "long" });
    expect(await store.list()).toHaveLength(1);
  });

  it("saving without an overwrite id makes a second preset", async () => {
    const store = new MemoryPresetStore(fakeDeps());
    await store.save(draft("주간보고"));
    await store.save(draft("주간보고"));
    expect(await store.list()).toHaveLength(2);
  });

  it("strips material even when handed a draft that still carries it", async () => {
    const store = new MemoryPresetStore(fakeDeps());
    const saved = await store.save({
      name: "n",
      intent: "i",
      sections: [],
      // A caller that bypassed `draftFrom`. The store must not rely on them.
      selections: { source: "예산 동결 결정" } as Record<string, unknown>,
    });
    expect(JSON.stringify(saved)).not.toContain("예산 동결");
  });
});

describe("using", () => {
  it("counts a load as a use and records when", async () => {
    const deps = fakeDeps();
    const store = new MemoryPresetStore(deps);
    const saved = await store.save(draft("주간보고"));

    deps.at = 5_000;
    const used = await store.touch(saved.id);
    expect(used?.uses).toBe(1);
    expect(used?.lastUsedAt).toBe(5_000);
  });

  it("returns undefined for a preset that is not there", async () => {
    const store = new MemoryPresetStore(fakeDeps());
    expect(await store.touch("ghost")).toBeUndefined();
    expect(await store.get("ghost")).toBeUndefined();
    expect(await store.remove("ghost")).toBe(false);
  });

  it("deletes", async () => {
    const store = new MemoryPresetStore(fakeDeps());
    const saved = await store.save(draft("주간보고"));
    expect(await store.remove(saved.id)).toBe(true);
    expect(await store.list()).toHaveLength(0);
  });
});

describe("ordering", () => {
  it("puts the most recently used first", async () => {
    const deps = fakeDeps();
    const store = new MemoryPresetStore(deps);

    const a = await store.save(draft("A"));
    deps.at = 1_100;
    const b = await store.save(draft("B"));

    // B is newer, so it leads until A is actually reached for.
    expect((await store.list()).map((p) => p.name)).toEqual(["B", "A"]);

    deps.at = 1_200;
    await store.touch(a.id);
    expect((await store.list()).map((p) => p.name)).toEqual(["A", "B"]);
    expect(b.name).toBe("B");
  });

  it("falls back to creation time for presets never loaded", () => {
    const base = { sections: [], selections: {}, uses: 0, updatedAt: 0, intent: "i" };
    const presets = [
      { ...base, id: "1", name: "old", createdAt: 10 },
      { ...base, id: "2", name: "new", createdAt: 20 },
    ] as Preset[];
    expect(byRecency(presets).map((p) => p.name)).toEqual(["new", "old"]);
  });

  it("does not mutate the list it was given", () => {
    const base = { sections: [], selections: {}, uses: 0, updatedAt: 0, intent: "i" };
    const presets = [
      { ...base, id: "1", name: "a", createdAt: 10 },
      { ...base, id: "2", name: "b", createdAt: 20 },
    ] as Preset[];
    byRecency(presets);
    expect(presets.map((p) => p.name)).toEqual(["a", "b"]);
  });
});
