/**
 * Which language the widget's own chrome speaks.
 *
 * The cases that matter are the mixed ones. Counting letters made a Korean
 * sentence with an English product name in it come out English, because the
 * product name had more letters than the grammar around it had syllables.
 */

import { describe, expect, it } from "vitest";

import { describeLanguage, detectLocale } from "../src/lib/locale.js";

describe("detectLocale", () => {
  it("reads a plain Korean request as Korean", () => {
    expect(detectLocale("고양이 이미지 만들어줘")).toBe("ko");
    expect(detectLocale("회의록 요약해줘")).toBe("ko");
  });

  it("reads a plain English request as English", () => {
    expect(detectLocale("Write a landing page for a bike shop")).toBe("en");
  });

  it("keeps a Korean sentence Korean when it names an English product", () => {
    // The case that was failing: ten Hangul syllables against ten Latin letters
    // tied and fell to English, though every word of grammar is Korean.
    expect(detectLocale("내가 등록한 unknown mcp 테스트 해줘")).toBe("ko");
    expect(detectLocale("GitHub Actions 워크플로 고쳐줘")).toBe("ko");
    expect(detectLocale("PostgreSQL 인덱스 설계 도와줘")).toBe("ko");
  });

  it("does not flip an English sentence for a short Korean quotation", () => {
    expect(detectLocale('Summarize the document titled "회의록" for me')).toBe("en");
    expect(detectLocale("The Korean word is 고양이, which means cat")).toBe("en");
  });

  it("ignores URLs, which say nothing about the surrounding language", () => {
    expect(detectLocale("https://example.com/really/long/path 이거 정리해줘")).toBe("ko");
    expect(detectLocale("이 페이지 www.some-site.co.kr 요약해줘")).toBe("ko");
    expect(detectLocale("Summarize https://example.com/article for me")).toBe("en");
  });

  it("falls back to English on empty or blank input", () => {
    expect(detectLocale("")).toBe("en");
    expect(detectLocale("   ")).toBe("en");
    expect(detectLocale("\n\t")).toBe("en");
  });

  it("falls back to English for a language the chrome does not speak", () => {
    expect(detectLocale("肉じゃがのレシピを書いて")).toBe("en");
    expect(detectLocale("Напиши статью")).toBe("en");
    expect(detectLocale("🎂🎉")).toBe("en");
  });

  it("counts a word once however long it is spelled", () => {
    // One noun each way, so the Korean grammar around it decides.
    expect(detectLocale("supercalifragilistic 해줘")).toBe("ko");
  });

  it("does not throw on anything", () => {
    for (const input of ["", "   ", "!!!", "123", "a".repeat(5000), "가".repeat(5000)]) {
      expect(() => detectLocale(input)).not.toThrow();
    }
  });
});

describe("describeLanguage", () => {
  it("names the language for the extraction prompt, beyond the two the chrome has", () => {
    expect(describeLanguage("고양이")).toBe("Korean");
    expect(describeLanguage("肉じゃが")).toBe("Japanese");
    expect(describeLanguage("红烧肉")).toBe("Chinese");
    expect(describeLanguage("Привет")).toBe("Russian");
    expect(describeLanguage("Write a page")).toBe("the same language as the request");
  });
});
