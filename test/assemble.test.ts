import { describe, expect, it } from "vitest";

import {
  assemble,
  assembledLength,
  emptyState,
  resolveAxes,
  type State,
} from "../src/lib/assemble.js";
import type { Unfolded } from "../src/lib/schema.js";

const cat: Unfolded = {
  title: "고양이 이미지",
  intent: "고양이 이미지 만들어줘",
  axes: [
    {
      id: "coat",
      label: "털색",
      group: "core",
      type: "select",
      options: [
        {
          value: "black",
          label: "검정",
          emit: "털색은 검은색으로, 밝은 배경과 대비되게 한다.",
          common: true,
        },
        { value: "white", label: "흰색", emit: "털색은 흰색으로 한다." },
      ],
    },
    {
      id: "pose",
      label: "자세",
      group: "core",
      type: "select",
      options: [
        { value: "lying", label: "누움", emit: "누워 있는 자세로 그린다." },
        { value: "sitting", label: "앉음", emit: "앉아 있는 자세로 그린다." },
      ],
    },
    {
      id: "mood",
      label: "분위기",
      group: "extra",
      type: "multi",
      options: [
        { value: "warm", label: "따뜻함", emit: "전체적으로 따뜻한 분위기로 한다." },
        { value: "quiet", label: "고요함", emit: "고요한 인상을 준다." },
      ],
    },
    {
      id: "width",
      label: "가로",
      group: "extra",
      type: "range",
      range: { unit: "px", min: 256, max: 2048, emitTemplate: "가로 {value}px로 만든다." },
    },
  ],
  symptoms: [
    { id: "flat", label: "밋밋함", emit: "명암 대비를 더 준다." },
    { id: "busy", label: "산만함", emit: "배경 요소를 줄인다." },
  ],
};

const state = (over: Partial<State> = {}): State => ({
  selections: {},
  locale: "ko",
  ...over,
});

// ── The four invariants the brief pins down ─────────────────────────────────

describe("invariants", () => {
  it("returns the request unchanged when nothing is decided", () => {
    expect(assemble(cat, emptyState)).toBe(cat.intent);
    expect(assemble(cat, state())).toBe(cat.intent);
  });

  it("adds exactly one line per decided axis", () => {
    const before = assemble(cat, state()).split("\n").filter(Boolean).length;
    const after = assemble(cat, state({ selections: { coat: "black" } }))
      .split("\n")
      .filter(Boolean).length;

    expect(after - before).toBe(1);
    expect(assemble(cat, state({ selections: { coat: "black" } }))).toBe(
      `${cat.intent}\n\n털색은 검은색으로, 밝은 배경과 대비되게 한다.`,
    );
  });

  it("is deterministic", () => {
    const s = state({
      selections: { coat: "black", pose: "lying", mood: ["warm", "quiet"], width: 1024 },
      symptoms: ["flat"],
      freeform: "손그림 느낌으로",
      source: "샴고양이는 눈이 파랗다.",
    });
    const once = assemble(cat, s);
    for (let i = 0; i < 20; i++) expect(assemble(cat, s)).toBe(once);
  });

  it("does not throw on axis ids that are not in the unfolded set", () => {
    const s = state({ selections: { nope: "gone", coat: "black", alsoNope: ["x"] } });
    expect(() => assemble(cat, s)).not.toThrow();
    expect(assemble(cat, s)).toContain("털색은 검은색");
    expect(assemble(cat, s)).not.toContain("gone");
  });

  it("does not throw when an axis is missing from state entirely", () => {
    expect(() => assemble(cat, { selections: {} })).not.toThrow();
    expect(() => assemble({ ...cat, axes: [] }, state())).not.toThrow();
    expect(assemble({ ...cat, axes: [] }, state())).toBe(cat.intent);
  });
});

// ── P2: an undecided axis leaves no trace ──────────────────────────────────

describe("empty axes vanish (P2)", () => {
  it("never mentions an axis that was not decided", () => {
    const text = assemble(cat, state({ selections: { coat: "black" } }));
    expect(text).not.toContain("자세");
    expect(text).not.toContain("분위기");
    expect(text).not.toContain("가로");
  });

  it("grows only by what was actually chosen", () => {
    const one = assemble(cat, state({ selections: { coat: "black" } }));
    const two = assemble(cat, state({ selections: { coat: "black", pose: "lying" } }));
    expect(two.length).toBeGreaterThan(one.length);
    expect(two).toBe(`${one}\n누워 있는 자세로 그린다.`);
  });

  it("treats cleared, blank and unknown values as undecided", () => {
    for (const value of [null, undefined, "", "   ", "nonexistent", [] as string[]]) {
      expect(assemble(cat, state({ selections: { coat: value } }))).toBe(cat.intent);
    }
  });
});

// ── Ordering ───────────────────────────────────────────────────────────────

describe("order", () => {
  it("runs intent, core axes, extra axes, symptoms, freeform, source", () => {
    const text = assemble(
      cat,
      state({
        selections: { width: 1024, coat: "black" },
        symptoms: ["flat"],
        freeform: "손그림 느낌으로",
        source: "샴고양이는 눈이 파랗다.",
      }),
    );

    const at = (needle: string) => text.indexOf(needle);
    expect(at(cat.intent)).toBe(0);
    expect(at("털색은 검은색")).toBeLessThan(at("가로 1024px"));
    expect(at("가로 1024px")).toBeLessThan(at("명암 대비"));
    expect(at("명암 대비")).toBeLessThan(at("손그림"));
    expect(at("손그림")).toBeLessThan(at("자료"));
  });

  it("keeps core ahead of extra regardless of the order they arrive in", () => {
    const shuffled: Unfolded = { ...cat, axes: [...cat.axes].reverse() };
    const text = assemble(shuffled, state({ selections: { coat: "black", width: 512 } }));
    expect(text.indexOf("털색은 검은색")).toBeLessThan(text.indexOf("가로 512px"));
  });
});

// ── The three result states ────────────────────────────────────────────────

describe("axis status", () => {
  it("marks chosen axes set and untouched ones unset", () => {
    const resolved = resolveAxes(cat, state({ selections: { coat: "black" } }));
    const byId = Object.fromEntries(resolved.map((r) => [r.axis.id, r]));

    expect(byId.coat?.status).toBe("set");
    expect(byId.coat?.values).toEqual(["black"]);
    expect(byId.pose?.status).toBe("unset");
    expect(byId.pose?.line).toBe("");
  });

  it("marks an axis with a default as decided-on-your-behalf", () => {
    const withDefault: Unfolded = {
      ...cat,
      axes: [{ ...cat.axes[0]!, default: "white" }, ...cat.axes.slice(1)],
    };
    const resolved = resolveAxes(withDefault, state());
    expect(resolved[0]!.status).toBe("partial");
    expect(resolved[0]!.line).toBe("털색은 흰색으로 한다.");
  });

  it("lets a user choice override the default", () => {
    const withDefault: Unfolded = {
      ...cat,
      axes: [{ ...cat.axes[0]!, default: "white" }, ...cat.axes.slice(1)],
    };
    const resolved = resolveAxes(withDefault, state({ selections: { coat: "black" } }));
    expect(resolved[0]!.status).toBe("set");
    expect(resolved[0]!.line).toContain("검은색");
  });

  it("copies set and partial lines but never delegated ones", () => {
    const withDefault: Unfolded = {
      ...cat,
      axes: [cat.axes[0]!, { ...cat.axes[1]!, default: "lying" }, ...cat.axes.slice(2)],
    };
    const text = assemble(withDefault, state({ selections: { coat: "black" } }));

    expect(text).toContain("털색은 검은색"); // set
    expect(text).toContain("누워 있는 자세"); // partial — decided on their behalf
    expect(text).not.toContain("따뜻한"); // unset — left to the AI
  });

  it("ignores a default that points at a value that no longer exists", () => {
    const stale: Unfolded = {
      ...cat,
      axes: [{ ...cat.axes[0]!, default: "chartreuse" }, ...cat.axes.slice(1)],
    };
    const resolved = resolveAxes(stale, state());
    expect(resolved[0]!.status).toBe("unset");
    expect(assemble(stale, state())).toBe(cat.intent);
  });
});

// ── multi and range ────────────────────────────────────────────────────────

describe("multi and range", () => {
  it("keeps a multi axis to one line however many values are on", () => {
    const text = assemble(cat, state({ selections: { mood: ["warm", "quiet"] } }));
    expect(text).toBe(`${cat.intent}\n\n전체적으로 따뜻한 분위기로 한다. 고요한 인상을 준다.`);
    expect(text.split("\n").filter(Boolean)).toHaveLength(2);
  });

  it("drops unknown values from a multi selection without losing the rest", () => {
    const text = assemble(cat, state({ selections: { mood: ["warm", "ghost"] } }));
    expect(text).toContain("따뜻한");
    expect(text).not.toContain("ghost");
  });

  it("fills the range template", () => {
    expect(assemble(cat, state({ selections: { width: 1024 } }))).toContain(
      "가로 1024px로 만든다.",
    );
  });

  it("accepts a range value that arrives as a string", () => {
    expect(assemble(cat, state({ selections: { width: "800" } }))).toContain("가로 800px로");
  });

  it("emits out-of-range values unchanged rather than blocking them (P4)", () => {
    expect(assemble(cat, state({ selections: { width: 99999 } }))).toContain("가로 99999px로");
    expect(assemble(cat, state({ selections: { width: 1 } }))).toContain("가로 1px로");
  });

  it("skips a range value that is not a number", () => {
    expect(assemble(cat, state({ selections: { width: "wide" } }))).toBe(cat.intent);
    expect(assemble(cat, state({ selections: { width: Number.NaN } }))).toBe(cat.intent);
  });
});

// ── source formatting ──────────────────────────────────────────────────────

describe("source", () => {
  it("inlines a short single-line source", () => {
    const text = assemble(cat, state({ source: "샴고양이는 눈이 파랗다." }));
    expect(text.endsWith("자료: 샴고양이는 눈이 파랗다.")).toBe(true);
  });

  it("gives long material a heading and a blank line", () => {
    const long = "가".repeat(300);
    const text = assemble(cat, state({ source: long }));
    expect(text).toContain(`자료\n\n${long}`);
  });

  it("gives multi-line material a heading even when short", () => {
    const text = assemble(cat, state({ source: "첫 줄\n둘째 줄" }));
    expect(text).toContain("자료\n\n첫 줄\n둘째 줄");
  });

  it("does not wrap the source in XML tags", () => {
    const text = assemble(cat, state({ source: "가".repeat(300) }));
    expect(text).not.toMatch(/<\/?[a-zA-Z_][\w-]*>/);
  });

  it("uses the English heading for an English request", () => {
    const text = assemble(cat, {
      selections: {},
      locale: "en",
      source: "Siamese cats have blue eyes.",
    });
    expect(text).toContain("Source: Siamese cats have blue eyes.");
  });
});

// ── misc ───────────────────────────────────────────────────────────────────

describe("freeform and counting", () => {
  it("appends freeform text as its own block", () => {
    const text = assemble(cat, state({ freeform: "손그림 느낌으로" }));
    expect(text).toBe(`${cat.intent}\n\n손그림 느낌으로`);
  });

  it("ignores whitespace-only freeform and source", () => {
    expect(assemble(cat, state({ freeform: "   ", source: "  \n " }))).toBe(cat.intent);
  });

  it("counts characters by code point", () => {
    expect(assembledLength("고양이")).toBe(3);
    expect(assembledLength("🐈‍⬛")).toBe(3); // cat + ZWJ + black square
  });
});

// ── serialization, so an Unfolded can later be frozen into a preset ────────

describe("serializable", () => {
  it("survives a JSON round trip unchanged", () => {
    const s = state({ selections: { coat: "black", mood: ["warm"], width: 1024 } });
    const round = JSON.parse(JSON.stringify(cat)) as Unfolded;
    expect(assemble(round, s)).toBe(assemble(cat, s));
  });
});
