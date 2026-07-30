/**
 * The file round trip, in a temporary directory.
 *
 * Lives beside the implementation rather than in `test/` because it imports
 * `node:fs` — the root project typechecks against Workers types, where that module
 * does not exist. The local tsconfig covers this file.
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { draftFrom } from "../lib/preset.js";
import type { StoreDeps } from "../lib/preset-store.js";
import type { Unfolded } from "../lib/schema.js";
import { FilePresetStore } from "./file-store.js";

const unfolded: Unfolded = {
  title: "회의록",
  intent: "회의록 요약해줘",
  sections: [
    {
      id: "form",
      label: "형식",
      axes: [
        {
          id: "voice",
          label: "문체",
          type: "open",
          emitTemplate: "문체는 {value}.",
          options: [
            // Written from the user's document — must not reach the file.
            { value: "plain", label: "담백하게", emit: "담백하게.", preview: "예산 동결 결정" },
          ],
        },
      ],
    },
  ],
};

const deps: StoreDeps = { now: () => 1_000, id: () => "fixed-id" };

let dir: string;
let path: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "uu-presets-"));
  path = join(dir, "nested", "presets.json");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FilePresetStore", () => {
  it("starts empty when the file does not exist yet", async () => {
    expect(await new FilePresetStore(path, deps).list()).toEqual([]);
  });

  it("writes a preset and reads it back through a fresh instance", async () => {
    await new FilePresetStore(path, deps).save(draftFrom("주간보고", unfolded, { voice: "plain" }));

    const reopened = await new FilePresetStore(path, deps).list();
    expect(reopened).toHaveLength(1);
    expect(reopened[0]!.name).toBe("주간보고");
    expect(reopened[0]!.selections).toEqual({ voice: "plain" });
    expect(reopened[0]!.intent).toBe("회의록 요약해줘");
  });

  it("creates the directory it was pointed at", async () => {
    await new FilePresetStore(path, deps).save(draftFrom("주간보고", unfolded, {}));
    expect(JSON.parse(await readFile(path, "utf8")).version).toBe(1);
  });

  it("never writes the material to disk", async () => {
    await new FilePresetStore(path, deps).save(draftFrom("주간보고", unfolded, {}));
    // The assertion is on the bytes on disk, not on an object in memory.
    expect(await readFile(path, "utf8")).not.toContain("예산 동결");
  });

  it("treats a corrupt file as empty rather than failing to start", async () => {
    const store = new FilePresetStore(path, deps);
    await store.save(draftFrom("주간보고", unfolded, {}));
    await writeFile(path, "{ this is not json", "utf8");

    // Extraction must survive a mangled preset file — only presets are lost.
    const reopened = new FilePresetStore(path, deps);
    expect(await reopened.list()).toEqual([]);
    await expect(reopened.save(draftFrom("다시", unfolded, {}))).resolves.toBeDefined();
  });

  it("skips entries that are not presets, keeping the ones that are", async () => {
    await writeFile(
      path.replace("/nested/", "/"),
      JSON.stringify({ version: 1, presets: [null, 7, { id: "ok", name: "keep" }] }),
      "utf8",
    ).catch(() => undefined);

    const flat = new FilePresetStore(path.replace("/nested/", "/"), deps);
    expect((await flat.list()).map((p) => p.name)).toEqual(["keep"]);
  });

  it("persists a use count across instances", async () => {
    const first = new FilePresetStore(path, deps);
    const saved = await first.save(draftFrom("주간보고", unfolded, {}));
    await first.touch(saved.id);

    const reopened = await new FilePresetStore(path, deps).get(saved.id);
    expect(reopened?.uses).toBe(1);
    expect(reopened?.lastUsedAt).toBe(1_000);
  });

  it("leaves no temporary file behind", async () => {
    await new FilePresetStore(path, deps).save(draftFrom("주간보고", unfolded, {}));
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(join(dir, "nested"));
    expect(entries.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
