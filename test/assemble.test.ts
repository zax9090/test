import { describe, expect, it } from "vitest";

import {
  assemble,
  assembledLength,
  describeSelection,
  emptyState,
  findConflicts,
  isApplicable,
  resolveAxes,
  type Selection,
  type State,
} from "../src/lib/assemble.js";
import { allAxes, type Unfolded } from "../src/lib/schema.js";

const cat: Unfolded = {
  title: "고양이 이미지",
  intent: "고양이 이미지 만들어줘",
  sections: [
    {
      id: "subject",
      label: "대상",
      axes: [
        {
          id: "coat",
          label: "털색",
          type: "closed",
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
          type: "closed",
          options: [
            { value: "lying", label: "누움", emit: "누워 있는 자세로 그린다." },
            { value: "sitting", label: "앉음", emit: "앉아 있는 자세로 그린다." },
          ],
        },
      ],
    },
    {
      id: "frame",
      label: "화면",
      axes: [
        {
          id: "mood",
          label: "분위기",
          type: "multi",
          options: [
            { value: "warm", label: "따뜻함", emit: "전체적으로 따뜻한 분위기로 한다." },
            { value: "quiet", label: "고요함", emit: "고요한 인상을 준다." },
          ],
        },
        {
          id: "width",
          label: "가로",
          type: "range",
          range: { unit: "px", min: 256, max: 2048, emitTemplate: "가로 {value}px로 만든다." },
        },
      ],
    },
  ],
  symptoms: [
    { id: "flat", label: "밋밋함", emit: "명암 대비를 더 준다." },
    { id: "busy", label: "산만함", emit: "배경 요소를 줄인다." },
  ],
};

/** Replace one axis wherever it lives, keeping the section shape intact. */
const withAxis = (u: Unfolded, id: string, patch: Record<string, unknown>): Unfolded => ({
  ...u,
  sections: u.sections.map((s) => ({
    ...s,
    axes: s.axes.map((a) => (a.id === id ? { ...a, ...patch } : a)),
  })),
});

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
    expect(() => assemble({ ...cat, sections: [] }, state())).not.toThrow();
    expect(assemble({ ...cat, sections: [] }, state())).toBe(cat.intent);
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

  it("follows the declared section order, not importance", () => {
    const swapped: Unfolded = { ...cat, sections: [...cat.sections].reverse() };
    const text = assemble(swapped, state({ selections: { coat: "black", width: 512 } }));
    // "화면" now comes first, so its axis leads.
    expect(text.indexOf("가로 512px")).toBeLessThan(text.indexOf("털색은 검은색"));
  });

  it("puts the goal on the line below the intent, above every axis", () => {
    const withGoal: Unfolded = {
      ...cat,
      goal: { selected: "사진처럼 사실적인 그림", alternatives: ["만화풍 그림"] },
    };
    const text = assemble(withGoal, state({ selections: { coat: "black" } }));

    expect(text.split("\n")[0]).toBe(cat.intent);
    expect(text.split("\n")[1]).toBe("사진처럼 사실적인 그림");
    expect(text.indexOf("사실적인")).toBeLessThan(text.indexOf("털색은 검은색"));
  });

  it("carries the goal even with nothing decided — it is instruction, not an axis", () => {
    const withGoal: Unfolded = {
      ...cat,
      goal: { selected: "사실적인 그림", alternatives: ["만화풍"] },
    };
    expect(assemble(withGoal, state())).toBe(`${cat.intent}\n사실적인 그림`);
  });

  it("never mentions the alternatives that were not taken", () => {
    const withGoal: Unfolded = {
      ...cat,
      goal: { selected: "사실적인 그림", alternatives: ["만화풍 그림", "수채화 느낌"] },
    };
    const text = assemble(withGoal, state({ selections: { coat: "black" } }));
    expect(text).not.toContain("만화풍");
    expect(text).not.toContain("수채화");
  });

  it("adds nothing when there is no goal", () => {
    expect(assemble(cat, state())).toBe(cat.intent);
  });

  it("never writes a section name into the prompt", () => {
    const text = assemble(cat, state({ selections: { coat: "black", width: 512 } }));
    expect(text).not.toContain("대상");
    expect(text).not.toContain("화면");
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
    const withDefault = withAxis(cat, "coat", { default: "white" });
    const resolved = resolveAxes(withDefault, state());
    expect(resolved[0]!.status).toBe("partial");
    expect(resolved[0]!.line).toBe("털색은 흰색으로 한다.");
  });

  it("lets a user choice override the default", () => {
    const withDefault = withAxis(cat, "coat", { default: "white" });
    const resolved = resolveAxes(withDefault, state({ selections: { coat: "black" } }));
    expect(resolved[0]!.status).toBe("set");
    expect(resolved[0]!.line).toContain("검은색");
  });

  it("copies set and partial lines but never delegated ones", () => {
    const withDefault = withAxis(cat, "pose", { default: "lying" });
    const text = assemble(withDefault, state({ selections: { coat: "black" } }));

    expect(text).toContain("털색은 검은색"); // set
    expect(text).toContain("누워 있는 자세"); // partial — decided on their behalf
    expect(text).not.toContain("따뜻한"); // unset — left to the AI
  });

  it("marks a value that came from a preset as decided-on-your-behalf", () => {
    const resolved = resolveAxes(cat, state({ loaded: { coat: "white" } }));
    expect(resolved[0]!.status).toBe("partial");
    expect(resolved[0]!.line).toBe("털색은 흰색으로 한다.");
  });

  it("lets a preset value outrank a model default — it is the user's own answer", () => {
    const withDefault = withAxis(cat, "coat", { default: "black" });
    const resolved = resolveAxes(withDefault, state({ loaded: { coat: "white" } }));
    expect(resolved[0]!.line).toBe("털색은 흰색으로 한다.");
  });

  it("lets this-time choice outrank a preset value", () => {
    const resolved = resolveAxes(
      cat,
      state({ loaded: { coat: "white" }, selections: { coat: "black" } }),
    );
    expect(resolved[0]!.status).toBe("set");
    expect(resolved[0]!.line).toContain("검은색");
  });

  it("copies a preset value into the prompt, like any other stand-in", () => {
    expect(assemble(cat, state({ loaded: { coat: "white" } }))).toBe(
      `${cat.intent}\n\n털색은 흰색으로 한다.`,
    );
  });

  it("carries a preset value for a multi axis, which a default could not hold", () => {
    const resolved = resolveAxes(cat, state({ loaded: { mood: ["warm", "quiet"] } }));
    const byId = Object.fromEntries(resolved.map((r) => [r.axis.id, r]));
    expect(byId.mood?.status).toBe("partial");
    expect(byId.mood?.values).toEqual(["warm", "quiet"]);
  });

  it("ignores a preset value for an axis that no longer exists", () => {
    expect(() => assemble(cat, state({ loaded: { gone: "x" } }))).not.toThrow();
    expect(assemble(cat, state({ loaded: { gone: "x" } }))).toBe(cat.intent);
  });

  it("ignores a default that points at a value that no longer exists", () => {
    const stale = withAxis(cat, "coat", { default: "chartreuse" });
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

// ── axes that depend on each other ─────────────────────────────────────────

describe("applicability and conflicts", () => {
  const linked: Unfolded = {
    title: "웹사이트",
    intent: "웹사이트 설계해줘",
    sections: [
      {
        id: "shape",
        label: "형태",
        axes: [
          {
            id: "deliverable",
            label: "결과물",
            type: "closed",
            options: [
              { value: "code", label: "코드", emit: "코드로 만든다." },
              { value: "plan", label: "기획서", emit: "기획서로 쓴다." },
            ],
          },
          {
            id: "stack",
            label: "스택",
            type: "closed",
            showIf: { deliverable: ["code"] },
            options: [{ value: "react", label: "React", emit: "React로 만든다." }],
          },
          {
            id: "count",
            label: "축 개수",
            type: "closed",
            conflicts: [{ with: { specificity: "over" }, reason: "이미 구체적이면 축이 없다" }],
            options: [{ value: "8", label: "8개", emit: "축을 8개 만든다." }],
          },
          {
            id: "specificity",
            label: "구체성",
            type: "closed",
            options: [{ value: "over", label: "이미 구체적", emit: "이미 구체적이다." }],
          },
        ],
      },
    ],
  };

  const resolve = (selections: Record<string, Selection>) =>
    resolveAxes(linked, { selections, locale: "ko" });

  const axisById = (id: string) => allAxes(linked).find((a) => a.id === id)!;

  it("shows a dependent axis while its governing axis is unanswered", () => {
    // Hiding before the premise is visible would make it vanish for a reason
    // the user cannot yet see.
    expect(isApplicable(axisById("stack"), resolve({}))).toBe(true);
  });

  it("hides an axis that stops applying", () => {
    expect(isApplicable(axisById("stack"), resolve({ deliverable: "plan" }))).toBe(false);
    expect(isApplicable(axisById("stack"), resolve({ deliverable: "code" }))).toBe(true);
  });

  it("leaves an independent axis always applicable", () => {
    expect(isApplicable(axisById("deliverable"), resolve({ deliverable: "plan" }))).toBe(true);
  });

  it("reports a live contradiction, naming both sides", () => {
    const found = findConflicts(linked, resolve({ count: "8", specificity: "over" }));
    expect(found).toHaveLength(1);
    expect(found[0]!.axisId).toBe("count");
    expect(found[0]!.against).toEqual(["specificity"]);
    expect(found[0]!.reason).toContain("이미 구체적");
  });

  it("reports nothing until both sides are actually chosen", () => {
    expect(findConflicts(linked, resolve({ count: "8" }))).toEqual([]);
    expect(findConflicts(linked, resolve({ specificity: "over" }))).toEqual([]);
    expect(findConflicts(linked, resolve({}))).toEqual([]);
  });

  it("does not block the contradiction — both lines still reach the prompt", () => {
    // Informing at the moment of choosing is the fix; refusing would only take
    // away the case where someone knows and means it (P4, C20).
    const text = assemble(linked, {
      selections: { count: "8", specificity: "over" },
      locale: "ko",
    });
    expect(text).toContain("축을 8개 만든다.");
    expect(text).toContain("이미 구체적이다.");
  });

  it("ignores a rule pointing at an axis that no longer exists", () => {
    const stale: Unfolded = {
      ...linked,
      sections: [
        {
          ...linked.sections[0]!,
          axes: linked.sections[0]!.axes.filter((a) => a.id !== "specificity"),
        },
      ],
    };
    expect(() =>
      findConflicts(stale, resolveAxes(stale, { selections: { count: "8" } })),
    ).not.toThrow();
    expect(findConflicts(stale, resolveAxes(stale, { selections: { count: "8" } }))).toEqual([]);
  });

  it("takes no notice of a typed value — no rule can have been written about it", () => {
    const typed = resolve({ specificity: { kind: "typed", text: "over" } });
    expect(findConflicts(linked, typed)).toEqual([]);
  });
});

describe("an inapplicable axis contributes nothing", () => {
  const linked: Unfolded = {
    title: "웹사이트",
    intent: "웹사이트 설계해줘",
    sections: [
      {
        id: "shape",
        label: "형태",
        axes: [
          {
            id: "deliverable",
            label: "결과물",
            type: "closed",
            options: [
              { value: "code", label: "코드", emit: "코드로 만든다." },
              { value: "plan", label: "기획서", emit: "기획서로 쓴다." },
            ],
          },
          {
            id: "stack",
            label: "스택",
            type: "closed",
            showIf: { deliverable: ["code"] },
            options: [{ value: "react", label: "React", emit: "React로 만든다." }],
          },
        ],
      },
    ],
  };

  it("drops the sentence of an axis that stopped applying", () => {
    // The row is gone from the screen, so its line must be gone from the prompt.
    // Leaving it in would put a sentence in the text that the user can no longer
    // see to remove.
    const text = assemble(linked, {
      selections: { deliverable: "plan", stack: "react" },
      locale: "ko",
    });
    expect(text).toContain("기획서로 쓴다.");
    expect(text).not.toContain("React로 만든다.");
  });

  it("keeps it while the axis does apply", () => {
    const text = assemble(linked, {
      selections: { deliverable: "code", stack: "react" },
      locale: "ko",
    });
    expect(text).toContain("React로 만든다.");
  });

  it("reports the axis as undecided rather than deleting it", () => {
    const resolved = resolveAxes(linked, { selections: { deliverable: "plan", stack: "react" } });
    const stack = resolved.find((r) => r.axis.id === "stack")!;
    // Still in the list, so a value survives a temporary switch away and back.
    expect(stack.applicable).toBe(false);
    expect(stack.status).toBe("unset");
    expect(stack.line).toBe("");
  });

  it("restores the value when the axis applies again", () => {
    const selections = { deliverable: "code", stack: "react" };
    expect(assemble(linked, { selections, locale: "ko" })).toContain("React로 만든다.");
  });
});

// ── the structure sent alongside the prose ─────────────────────────────────

describe("describeSelection", () => {
  const report = (over: Partial<State> = {}, extra?: { fixApplied?: string }) =>
    describeSelection(cat, state(over), extra);

  it("separates chosen, decided-for-you and untouched", () => {
    // A flat list of values cannot tell "left to the AI" from "a value was applied
    // on their behalf", and those two want different treatment.
    const withDefault = withAxis(cat, "pose", { default: "lying" });
    const r = describeSelection(withDefault, state({ selections: { coat: "black" } }));

    expect(Object.keys(r.chosen)).toEqual(["coat"]);
    expect(Object.keys(r.standIn)).toEqual(["pose"]);
    expect(r.untouched).toEqual(["mood", "width"]);
  });

  it("carries provenance, which the prose cannot", () => {
    const open: Unfolded = withAxis(cat, "coat", {
      type: "open",
      emitTemplate: "털색은 {value}.",
    });

    const pressed = describeSelection(open, state({ selections: { coat: "black" } }));
    expect(pressed.chosen.coat?.kind).toBe("option");

    const typed = describeSelection(
      open,
      state({ selections: { coat: { kind: "typed", text: "고등어 태비" } } }),
    );
    expect(typed.chosen.coat?.kind).toBe("typed");
    expect(typed.chosen.coat?.value).toBe("고등어 태비");
  });

  it("keeps the label and the section, so the grouping survives the trip", () => {
    const r = report({ selections: { coat: "black" } });
    expect(r.chosen.coat?.label).toBe("털색");
    expect(r.chosen.coat?.section).toBe("subject");
  });

  it("reports a multi selection as a list and a range as a number", () => {
    const r = report({ selections: { mood: ["warm", "quiet"], width: 1024 } });
    expect(r.chosen.mood?.value).toEqual(["warm", "quiet"]);
    expect(r.chosen.mood?.kind).toBe("options");
    expect(r.chosen.width?.value).toBe(1024);
    expect(r.chosen.width?.kind).toBe("number");
  });

  it("carries the intent and the goal", () => {
    const withGoal: Unfolded = {
      ...cat,
      goal: { selected: "사실적인 그림", alternatives: ["만화풍"] },
    };
    const r = describeSelection(withGoal, state());
    expect(r.intent).toBe(cat.intent);
    expect(r.goal).toBe("사실적인 그림");
  });

  it("carries symptoms, freeform and the applied correction", () => {
    const r = report(
      { symptoms: ["flat"], freeform: "손그림 느낌으로" },
      { fixApplied: "더 짧게" },
    );
    expect(r.symptoms).toEqual(["flat"]);
    expect(r.freeform).toBe("손그림 느낌으로");
    expect(r.fixApplied).toBe("더 짧게");
  });

  it("drops a symptom id that no longer exists", () => {
    expect(report({ symptoms: ["ghost"] }).symptoms).toBeUndefined();
  });

  it("never carries the source material, and has no field for it", () => {
    const r = report({ source: "예산 동결 결정", selections: { coat: "black" } });
    expect(JSON.stringify(r)).not.toContain("예산 동결");
    expect("source" in r).toBe(false);
  });

  it("names contradictions the user was warned about and kept", () => {
    const clashing: Unfolded = withAxis(cat, "coat", {
      conflicts: [{ with: { pose: "lying" }, reason: "누운 자세에서는 털색이 드러나지 않는다" }],
    });
    const r = describeSelection(clashing, state({ selections: { coat: "black", pose: "lying" } }));
    expect(r.conflicts).toHaveLength(1);
    expect(r.conflicts?.[0]?.reason).toContain("드러나지 않는다");
  });

  it("lists an inapplicable axis apart from an untouched one", () => {
    const linked: Unfolded = withAxis(cat, "pose", { showIf: { coat: ["white"] } });
    const r = describeSelection(linked, state({ selections: { coat: "black" } }));

    // Not skipped — never asked. The model should not treat the two the same.
    expect(r.inapplicable).toContain("pose");
    expect(r.untouched).not.toContain("pose");
  });

  it("agrees with the prose about what was decided", () => {
    const s = state({ selections: { coat: "black", mood: ["warm"] } });
    const r = describeSelection(cat, s);
    const text = assemble(cat, s);

    for (const id of Object.keys(r.chosen)) {
      expect(text).toContain(
        cat.sections.flatMap((x) => x.axes).find((a) => a.id === id)!.label ? "" : "",
      );
    }
    // Every chosen axis contributed a line, and no untouched one did.
    expect(text.split("\n").filter(Boolean)).toHaveLength(1 + Object.keys(r.chosen).length);
  });
});

// ── handing an axis to the AI on purpose ───────────────────────────────────

describe("delegated", () => {
  const delegated = { kind: "delegated" as const };

  it("contributes nothing, like an axis nobody touched", () => {
    expect(assemble(cat, state({ selections: { coat: delegated } }))).toBe(cat.intent);
  });

  it("overrides a model default — otherwise it would not be delegating", () => {
    const withDefault = withAxis(cat, "coat", { default: "white" });
    // Untouched, the default stands in.
    expect(assemble(withDefault, state())).toContain("털색은 흰색");
    // Handed over, nothing does.
    expect(assemble(withDefault, state({ selections: { coat: delegated } }))).toBe(cat.intent);
  });

  it("overrides a value loaded from a preset too", () => {
    const s = state({ loaded: { coat: "white" }, selections: { coat: delegated } });
    expect(assemble(cat, s)).toBe(cat.intent);
  });

  it("resolves as undecided but keeps the state, so the screen can tell them apart", () => {
    const resolved = resolveAxes(cat, state({ selections: { coat: delegated } }));
    expect(resolved[0]!.status).toBe("unset");
    expect(resolved[0]!.state.kind).toBe("delegated");
    expect(resolved[0]!.line).toBe("");
  });

  it("is reported apart from untouched — one is a decision, the other is not", () => {
    const r = describeSelection(cat, state({ selections: { coat: delegated } }));
    expect(r.delegated).toEqual(["coat"]);
    expect(r.untouched).not.toContain("coat");
    expect(r.untouched).toContain("pose");
  });

  it("goes back to undecided when taken back", () => {
    const resolved = resolveAxes(cat, state({ selections: { coat: { kind: "none" } } }));
    expect(resolved[0]!.state.kind).toBe("none");
  });
});
