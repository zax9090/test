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

import { extractJson, fallbackUnfolded, parseUnfolded } from "../src/lib/schema.js";
import { assemble } from "../src/lib/assemble.js";

const axis = (over: Record<string, unknown> = {}) => ({
  id: "coat",
  label: "털색",
  group: "core",
  type: "select",
  options: [{ value: "black", label: "검정", emit: "털색은 검은색." }],
  ...over,
});

const payload = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ title: "t", intent: "고양이", axes: [axis()], ...over });

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
    const raw = JSON.stringify({
      title: "t",
      intent: "고양이",
      axes: [
        axis(),
        { id: "nolabel", group: "extra", type: "select", options: [] },
        axis({ id: "pose", label: "자세" }),
      ],
    });
    const parsed = parseUnfolded(raw, "고양이")!;
    expect(parsed.axes.map((a) => a.id)).toEqual(["coat", "pose"]);
  });

  it("returns null when nothing survives, so the caller can retry", () => {
    expect(parseUnfolded('{"axes":[]}', "고양이")).toBeNull();
    expect(parseUnfolded("not json", "고양이")).toBeNull();
    expect(parseUnfolded('{"no":"axes"}', "고양이")).toBeNull();
    expect(parseUnfolded('{"axes":"wrong type"}', "고양이")).toBeNull();
  });

  it("falls back to the request when intent is missing", () => {
    const parsed = parseUnfolded(JSON.stringify({ axes: [axis()] }), "  고양이 그려줘  ")!;
    expect(parsed.intent).toBe("고양이 그려줘");
    expect(parsed.title).toBe("고양이 그려줘");
  });

  it("uses the label as the sentence when emit is missing", () => {
    const raw = payload({
      axes: [axis({ options: [{ value: "black", label: "검정" }] })],
    });
    const parsed = parseUnfolded(raw, "고양이")!;
    expect(parsed.axes[0]!.options![0]!.emit).toBe("검정");
  });

  it("drops an option with neither label nor value", () => {
    const raw = payload({
      axes: [
        axis({ options: [{ emit: "떠돌이 문장" }, { value: "black", label: "검정", emit: "e" }] }),
      ],
    });
    expect(parseUnfolded(raw, "고양이")!.axes[0]!.options).toHaveLength(1);
  });
});

describe("parseUnfolded — type repair", () => {
  it("infers select when the type is missing or unknown", () => {
    for (const type of [undefined, "dropdown", 42]) {
      const parsed = parseUnfolded(payload({ axes: [axis({ type })] }), "고양이")!;
      expect(parsed.axes[0]!.type).toBe("select");
    }
  });

  it("infers range when a usable range block is present", () => {
    const raw = payload({
      axes: [
        {
          id: "w",
          label: "가로",
          group: "core",
          range: { unit: "px", emitTemplate: "가로 {value}px." },
        },
      ],
    });
    expect(parseUnfolded(raw, "고양이")!.axes[0]!.type).toBe("range");
  });

  it("does not leave a range axis that has no template — it would render dead", () => {
    const raw = payload({
      axes: [axis({ type: "range", range: { unit: "px" } })],
    });
    const parsed = parseUnfolded(raw, "고양이")!;
    expect(parsed.axes[0]!.type).toBe("select");
    expect(parsed.axes[0]!.range).toBeUndefined();
  });

  it("keeps a sample axis even with no options to show yet", () => {
    const raw = payload({ axes: [axis({ id: "voice", type: "sample", options: [] })] });
    expect(parseUnfolded(raw, "고양이")!.axes[0]!.type).toBe("sample");
  });

  it("treats an unknown group as extra", () => {
    const raw = payload({ axes: [axis({ group: "important" })] });
    expect(parseUnfolded(raw, "고양이")!.axes[0]!.group).toBe("extra");
  });
});

describe("parseUnfolded — ids", () => {
  it("makes duplicate ids distinct so two rows cannot share one slot", () => {
    const raw = payload({ axes: [axis(), axis({ label: "털색2" })] });
    const ids = parseUnfolded(raw, "고양이")!.axes.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("leaves the first of a duplicate pair alone, so fixes still resolve", () => {
    const raw = payload({
      axes: [axis({ id: "bg", label: "배경" }), axis({ id: "bg", label: "배경2" })],
      fixes: [{ label: "단색", set: { bg: "black" } }],
    });
    const parsed = parseUnfolded(raw, "고양이")!;

    expect(parsed.axes[0]!.id).toBe("bg");
    expect(assemble(parsed, { selections: parsed.fixes![0]!.set })).toContain("털색은 검은색.");
  });

  it("invents ids by position when the model omits them", () => {
    const raw = payload({
      axes: [{ label: "털색", group: "core", options: [{ value: "b", label: "검정", emit: "e" }] }],
    });
    expect(parseUnfolded(raw, "고양이")!.axes[0]!.id).toBe("axis-0");
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
      '{"axes":[null,1,"x",[],{}]}',
      '{"axes":[{"label":"a","options":[null,1,"x"]}]}',
      '{"intent":123,"title":{},"axes":[{"label":"a","options":[{"value":"v","label":"l","emit":"e"}]}]}',
      '{"axes":[{"label":"a","default":{},"options":[{"value":"v","label":"l","emit":"e"}]}]}',
    ];
    for (const raw of nasty) {
      expect(() => parseUnfolded(raw, "req")).not.toThrow();
    }
  });

  it("ignores a default that is not a string or number", () => {
    const raw = payload({ axes: [axis({ default: { nope: true } })] });
    expect(parseUnfolded(raw, "고양이")!.axes[0]!.default).toBeUndefined();
  });

  it("accepts an object as readily as a string", () => {
    const parsed = parseUnfolded(JSON.parse(payload()) as unknown, "고양이")!;
    expect(parsed.axes).toHaveLength(1);
  });
});

describe("fallbackUnfolded", () => {
  it("matches the request's language", () => {
    expect(fallbackUnfolded("고양이 그려줘").axes[0]!.label).toBe("목적");
    expect(fallbackUnfolded("draw a cat").axes[0]!.label).toBe("Purpose");
  });

  it("marks nothing as common, since a usual value across all tasks is a guess", () => {
    for (const request of ["고양이 그려줘", "draw a cat"]) {
      const options = fallbackUnfolded(request).axes.flatMap((a) => a.options ?? []);
      expect(options.some((o) => o.common)).toBe(false);
    }
  });

  it("sets no defaults, so an untouched fallback still assembles to the request", () => {
    const u = fallbackUnfolded("draw a cat");
    expect(assemble(u, { selections: {} })).toBe("draw a cat");
  });

  it("gives three core axes and keeps the rest folded away", () => {
    const u = fallbackUnfolded("draw a cat");
    expect(u.axes.filter((a) => a.group === "core")).toHaveLength(3);
    expect(u.axes.filter((a) => a.group === "extra")).toHaveLength(2);
  });
});
