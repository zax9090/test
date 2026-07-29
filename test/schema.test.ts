/**
 * The parser's job is to salvage.
 *
 * Everything it sees was written by a model under instruction, which means it is
 * usually right and occasionally malformed in ways no schema anticipated. The
 * rule is that a payload with nine good axes and one broken one yields nine —
 * whole-payload failure is signalled with `null` so the caller can retry once and
 * then fall back, and an empty widget never reaches the user.
 *
 * These are the cases that decide whether that holds.
 */

import { describe, expect, it } from "vitest";

import { allAxes, extractJson, fallbackUnfolded, parseUnfolded } from "../src/lib/schema.js";
import { assemble } from "../src/lib/assemble.js";

const axis = (over: Record<string, unknown> = {}) => ({
  id: "coat",
  label: "털색",
  type: "select",
  options: [{ value: "black", label: "검정", emit: "털색은 검은색." }],
  ...over,
});

const section = (axes: unknown[], over: Record<string, unknown> = {}) => ({
  id: "subject",
  label: "대상",
  axes,
  ...over,
});

/** A well-formed payload. `axes` swaps the axes inside the single section. */
const payload = (over: Record<string, unknown> = {}) => {
  const { axes, ...rest } = over as { axes?: unknown[] };
  return JSON.stringify({
    title: "t",
    intent: "고양이",
    sections: [section(axes ?? [axis()])],
    ...rest,
  });
};

describe("extractJson", () => {
  it("reads a bare object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips a code fence the prompt asked the model not to use", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("digs the object out of surrounding chatter", () => {
    expect(extractJson('Sure! Here you go:\n{"a":1}\nHope that helps.')).toEqual({ a: 1 });
  });

  it("returns undefined rather than throwing on junk", () => {
    for (const junk of ["", "no json here", "{unclosed", "```json\nnope\n```"]) {
      expect(() => extractJson(junk)).not.toThrow();
      expect(extractJson(junk)).toBeUndefined();
    }
  });
});

describe("parseUnfolded — salvage", () => {
  it("keeps the good axes and drops only the broken one", () => {
    const raw = payload({
      axes: [
        axis(),
        { id: "nolabel", type: "select", options: [] },
        axis({ id: "pose", label: "자세" }),
      ],
    });
    const parsed = parseUnfolded(raw, "고양이")!;
    expect(allAxes(parsed).map((a) => a.id)).toEqual(["coat", "pose"]);
  });

  it("returns null when nothing survives, so the caller can retry", () => {
    expect(parseUnfolded('{"sections":[]}', "고양이")).toBeNull();
    expect(parseUnfolded("not json", "고양이")).toBeNull();
    expect(parseUnfolded('{"no":"sections"}', "고양이")).toBeNull();
    expect(parseUnfolded('{"sections":"wrong type"}', "고양이")).toBeNull();
    // A section whose axes all fail leaves nothing behind.
    expect(parseUnfolded('{"sections":[{"label":"대상","axes":[{}]}]}', "고양이")).toBeNull();
  });

  it("falls back to the request when intent is missing", () => {
    const parsed = parseUnfolded(
      JSON.stringify({ sections: [section([axis()])] }),
      "  고양이 그려줘  ",
    )!;
    expect(parsed.intent).toBe("고양이 그려줘");
    expect(parsed.title).toBe("고양이 그려줘");
  });

  it("uses the label as the sentence when emit is missing", () => {
    const raw = payload({
      axes: [axis({ options: [{ value: "black", label: "검정" }] })],
    });
    const parsed = parseUnfolded(raw, "고양이")!;
    expect(allAxes(parsed)[0]!.options![0]!.emit).toBe("검정");
  });

  it("drops an option with neither label nor value", () => {
    const raw = payload({
      axes: [
        axis({ options: [{ emit: "떠돌이 문장" }, { value: "black", label: "검정", emit: "e" }] }),
      ],
    });
    expect(allAxes(parseUnfolded(raw, "고양이")!)[0]!.options).toHaveLength(1);
  });
});

describe("parseUnfolded — sections", () => {
  it("keeps the sections and their order", () => {
    const raw = JSON.stringify({
      intent: "고양이",
      sections: [
        { id: "subject", label: "대상", axes: [axis()] },
        { id: "frame", label: "화면", axes: [axis({ id: "ratio", label: "비율" })] },
      ],
    });
    const parsed = parseUnfolded(raw, "고양이")!;
    expect(parsed.sections.map((s) => s.label)).toEqual(["대상", "화면"]);
    expect(allAxes(parsed).map((a) => a.id)).toEqual(["coat", "ratio"]);
  });

  it("drops a section with no label or no surviving axes, keeping the rest", () => {
    const raw = JSON.stringify({
      intent: "고양이",
      sections: [
        { id: "nameless", axes: [axis()] },
        { id: "empty", label: "빈", axes: [] },
        { id: "frame", label: "화면", axes: [axis({ id: "ratio", label: "비율" })] },
      ],
    });
    expect(parseUnfolded(raw, "고양이")!.sections.map((s) => s.id)).toEqual(["frame"]);
  });

  it("gathers a flat axes payload into one unnamed section rather than rejecting it", () => {
    // An older model, or one that skimmed the instruction. The grouping is lost;
    // the widget is not.
    const raw = JSON.stringify({ intent: "고양이", axes: [axis()] });
    const parsed = parseUnfolded(raw, "고양이")!;
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0]!.label).toBe("");
    expect(allAxes(parsed)).toHaveLength(1);
  });

  it("makes axis ids distinct across sections, not just within one", () => {
    const raw = JSON.stringify({
      intent: "고양이",
      sections: [
        { id: "a", label: "가", axes: [axis()] },
        { id: "a", label: "나", axes: [axis()] },
      ],
    });
    const parsed = parseUnfolded(raw, "고양이")!;
    const axisIds = allAxes(parsed).map((a) => a.id);
    expect(new Set(axisIds).size).toBe(axisIds.length);
    expect(new Set(parsed.sections.map((s) => s.id)).size).toBe(2);
  });

  it("keeps a user-added section marked as such", () => {
    const raw = JSON.stringify({
      intent: "고양이",
      sections: [{ id: "mine", label: "내 묶음", origin: "user", axes: [axis()] }],
    });
    expect(parseUnfolded(raw, "고양이")!.sections[0]!.origin).toBe("user");
  });
});

describe("parseUnfolded — type repair", () => {
  it("infers select when the type is missing or unknown", () => {
    for (const type of [undefined, "dropdown", 42]) {
      const parsed = parseUnfolded(payload({ axes: [axis({ type })] }), "고양이")!;
      expect(allAxes(parsed)[0]!.type).toBe("select");
    }
  });

  it("infers range when a usable range block is present", () => {
    const raw = payload({
      axes: [{ id: "w", label: "가로", range: { unit: "px", emitTemplate: "가로 {value}px." } }],
    });
    expect(allAxes(parseUnfolded(raw, "고양이")!)[0]!.type).toBe("range");
  });

  it("does not leave a range axis that has no template — it would render dead", () => {
    const raw = payload({
      axes: [axis({ type: "range", range: { unit: "px" } })],
    });
    const parsed = allAxes(parseUnfolded(raw, "고양이")!)[0]!;
    expect(parsed.type).toBe("select");
    expect(parsed.range).toBeUndefined();
  });

  it("keeps a sample axis even with no options to show yet", () => {
    const raw = payload({ axes: [axis({ id: "voice", type: "sample", options: [] })] });
    expect(allAxes(parseUnfolded(raw, "고양이")!)[0]!.type).toBe("sample");
  });
});

describe("parseUnfolded — ids", () => {
  it("makes duplicate ids distinct so two rows cannot share one slot", () => {
    const raw = payload({ axes: [axis(), axis({ label: "털색2" })] });
    const ids = allAxes(parseUnfolded(raw, "고양이")!).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves the first of a duplicate pair alone, so fixes still resolve", () => {
    const raw = payload({
      axes: [axis({ id: "bg", label: "배경" }), axis({ id: "bg", label: "배경2" })],
      fixes: [{ label: "단색", set: { bg: "black" } }],
    });
    const parsed = parseUnfolded(raw, "고양이")!;

    expect(allAxes(parsed)[0]!.id).toBe("bg");
    expect(assemble(parsed, { selections: parsed.fixes![0]!.set })).toContain("털색은 검은색.");
  });

  it("invents ids by position when the model omits them", () => {
    const raw = payload({
      axes: [{ label: "털색", group: "core", options: [{ value: "b", label: "검정", emit: "e" }] }],
    });
    expect(allAxes(parseUnfolded(raw, "고양이")!)[0]!.id).toBe("axis-0");
  });
});

describe("parseUnfolded — fixes and symptoms", () => {
  it("caps fixes at four", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ label: `f${i}`, set: { coat: "black" } }));
    expect(parseUnfolded(payload({ fixes: many }), "고양이")!.fixes).toHaveLength(4);
  });

  it("drops a fix that sets nothing", () => {
    const raw = payload({
      fixes: [
        { label: "empty", set: {} },
        { label: "ok", set: { coat: "black" } },
      ],
    });
    expect(parseUnfolded(raw, "고양이")!.fixes).toHaveLength(1);
  });

  it("keeps symptoms and gives them ids when missing", () => {
    const raw = payload({
      symptoms: [{ label: "밋밋함", emit: "대비를 준다." }, { label: "산만함" }],
    });
    const symptoms = parseUnfolded(raw, "고양이")!.symptoms!;
    expect(symptoms.map((s) => s.id)).toEqual(["symptom-0", "symptom-1"]);
    expect(symptoms[1]!.emit).toBe("산만함");
  });

  it("omits fixes and symptoms entirely rather than leaving empty arrays", () => {
    const parsed = parseUnfolded(payload({ fixes: [], symptoms: "nope" }), "고양이")!;
    expect(parsed.fixes).toBeUndefined();
    expect(parsed.symptoms).toBeUndefined();
  });
});

describe("parseUnfolded — hostile input", () => {
  it("never throws, whatever it is handed", () => {
    const nasty = [
      "null",
      "[]",
      '"a string"',
      "123",
      '{"sections":[null,1,"x",[],{}]}',
      '{"sections":[{"label":"s","axes":[null,1,"x"]}]}',
      '{"sections":[{"label":"s"}]}',
      '{"intent":123,"title":{},"sections":[{"label":"s","axes":[{"label":"a","options":[{"value":"v","label":"l","emit":"e"}]}]}]}',
      '{"axes":[{"label":"a","default":{},"options":[{"value":"v","label":"l","emit":"e"}]}]}',
    ];
    for (const raw of nasty) {
      expect(() => parseUnfolded(raw, "req")).not.toThrow();
    }
  });

  it("ignores a default that is not a string or number", () => {
    const raw = payload({ axes: [axis({ default: { nope: true } })] });
    expect(allAxes(parseUnfolded(raw, "고양이")!)[0]!.default).toBeUndefined();
  });

  it("accepts an object as readily as a string", () => {
    const parsed = parseUnfolded(JSON.parse(payload()) as unknown, "고양이")!;
    expect(allAxes(parsed)).toHaveLength(1);
  });
});

describe("fallbackUnfolded", () => {
  it("matches the request's language", () => {
    expect(allAxes(fallbackUnfolded("고양이 그려줘"))[0]!.label).toBe("목적");
    expect(allAxes(fallbackUnfolded("draw a cat"))[0]!.label).toBe("Purpose");
  });

  it("marks nothing as common, since a usual value across all tasks is a guess", () => {
    for (const request of ["고양이 그려줘", "draw a cat"]) {
      const options = allAxes(fallbackUnfolded(request)).flatMap((a) => a.options ?? []);
      expect(options.some((o) => o.common)).toBe(false);
    }
  });

  it("sets no defaults, so an untouched fallback still assembles to the request", () => {
    const u = fallbackUnfolded("draw a cat");
    expect(assemble(u, { selections: {} })).toBe("draw a cat");
  });

  it("arrives as one unnamed section — there is no task to name groups after", () => {
    const u = fallbackUnfolded("draw a cat");
    expect(u.sections).toHaveLength(1);
    expect(u.sections[0]!.label).toBe("");
    expect(allAxes(u)).toHaveLength(5);
  });
});
