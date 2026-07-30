/**
 * The one invariant that matters here: a preset never carries the user's material.
 *
 * The spec asked for `stripSource(payload).source === undefined`. That check would
 * have passed while the material sat untouched three levels down in an option's
 * `preview`, so these tests plant material at every depth and shape the payload can
 * actually take, and assert on the serialised result rather than on one field.
 */

import { describe, expect, it } from "vitest";

import { draftFrom, stripMaterial, unfoldedFrom, type Preset } from "../src/lib/preset.js";
import type { Unfolded } from "../src/lib/schema.js";

/** A distinctive string, so finding it anywhere in the output is unambiguous. */
const MATERIAL = "예산을 3분기까지 동결한다는 결정";

const withPreview: Unfolded = {
  title: "회의록 요약",
  intent: "회의록 요약해줘",
  goal: { selected: "팀 공유용 정리", alternatives: ["임원 보고용 정리"] },
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
            // Written from the user's document, exactly as the instruction asks.
            { value: "plain", label: "담백하게", emit: "담백하게 쓴다.", preview: MATERIAL },
            { value: "warm", label: "부드럽게", emit: "부드럽게 쓴다." },
          ],
        },
        {
          id: "length",
          label: "분량",
          type: "range",
          range: { unit: "문장", emitTemplate: "{value}문장 이내로 쓴다." },
        },
      ],
    },
  ],
};

describe("stripMaterial", () => {
  it("removes a top-level source field", () => {
    expect(stripMaterial({ source: MATERIAL, keep: 1 })).toEqual({ keep: 1 });
  });

  it("removes material buried at any depth", () => {
    const deep = { a: { b: [{ c: { source: MATERIAL } }] } };
    expect(JSON.stringify(stripMaterial(deep))).not.toContain(MATERIAL);
  });

  it("removes a sample preview — the leak a source-only check would miss", () => {
    const stripped = stripMaterial(withPreview.sections);
    expect(JSON.stringify(stripped)).not.toContain(MATERIAL);
  });

  it("keeps everything that is not material", () => {
    const stripped = stripMaterial(withPreview.sections);
    const json = JSON.stringify(stripped);

    expect(json).toContain("담백하게");
    expect(json).toContain("담백하게 쓴다.");
    expect(json).toContain("문장 이내로 쓴다.");
    expect(json).toContain("형식");
  });

  it("does not mutate its input", () => {
    const before = JSON.stringify(withPreview);
    stripMaterial(withPreview);
    expect(JSON.stringify(withPreview)).toBe(before);
  });

  it("survives a cycle instead of hanging", () => {
    const cyclic: Record<string, unknown> = { source: MATERIAL, keep: 2 };
    cyclic.self = cyclic;
    expect(() => stripMaterial(cyclic)).not.toThrow();
    expect(JSON.stringify(stripMaterial(cyclic))).not.toContain(MATERIAL);
  });

  it("leaves primitives and null alone", () => {
    expect(stripMaterial(null)).toBeNull();
    expect(stripMaterial(7)).toBe(7);
    expect(stripMaterial("plain string")).toBe("plain string");
  });
});

describe("draftFrom", () => {
  const draft = () =>
    draftFrom("주간보고 정리", withPreview, { voice: "plain", length: 5 }, ["long"]);

  it("carries no material anywhere in what would be written", () => {
    expect(JSON.stringify(draft())).not.toContain(MATERIAL);
  });

  it("strips material out of the selections too, not just the axes", () => {
    const d = draftFrom("n", withPreview, { voice: "plain", source: MATERIAL });
    expect(JSON.stringify(d)).not.toContain(MATERIAL);
  });

  it("keeps the reading, the values and the symptoms", () => {
    const d = draft();
    expect(d.goal).toBe("팀 공유용 정리");
    expect(d.selections).toEqual({ voice: "plain", length: 5 });
    expect(d.symptoms).toEqual(["long"]);
    expect(d.intent).toBe("회의록 요약해줘");
  });

  it("does not keep the alternatives — only the reading that was settled", () => {
    expect(JSON.stringify(draft())).not.toContain("임원 보고용");
  });

  it("trims the name and leaves goal out when there was none", () => {
    const d = draftFrom("  이름  ", { ...withPreview, goal: undefined }, {});
    expect(d.name).toBe("이름");
    expect(d.goal).toBeUndefined();
  });
});

describe("unfoldedFrom", () => {
  const stored: Preset = {
    id: "p1",
    name: "주간보고 정리",
    intent: "회의록 요약해줘",
    goal: "팀 공유용 정리",
    sections: withPreview.sections,
    selections: { voice: "plain" },
    uses: 3,
    createdAt: 1,
    updatedAt: 2,
  };

  it("rebuilds something renderable with no model call", () => {
    const u = unfoldedFrom(stored);
    expect(u.intent).toBe("회의록 요약해줘");
    expect(u.sections).toHaveLength(1);
  });

  it("brings the goal back on screen, switchable by typing", () => {
    const u = unfoldedFrom(stored);
    expect(u.goal?.selected).toBe("팀 공유용 정리");
    // No stored alternatives — the field still shows and the box still accepts one.
    expect(u.goal?.alternatives).toEqual([]);
  });

  it("leaves the goal off when the preset had none", () => {
    expect(unfoldedFrom({ ...stored, goal: undefined }).goal).toBeUndefined();
  });
});
