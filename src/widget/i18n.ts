/**
 * The widget's own words.
 *
 * Axis labels, values and help text arrive from the model already in the user's
 * language. Only the chrome needs switching, and only between Korean and
 * English — anything else falls back to English.
 *
 * Nothing here claims a result is good, optimal, complete, or improved (P5).
 */

import type { Locale } from "../lib/locale.js";

export interface Strings {
  map: string;
  tabList: string;
  tabResult: string;
  more: (n: number) => string;
  less: string;
  freeform: string;
  freeformPlaceholder: string;
  source: string;
  symptoms: string;
  sourcePlaceholder: string;
  onBehalf: (n: number) => string;
  delegated: string;
  copy: string;
  copied: string;
  send: string;
  chars: (n: number) => string;
  clear: string;
  preview: string;
  previewing: string;
  refold: string;
  refolding: string;
  outOfRange: (min: string, max: string) => string;
}

const ko: Strings = {
  map: "지도",
  tabList: "목록",
  tabResult: "결과",
  more: (n) => `더 정하기 (${n})`,
  less: "접기",
  freeform: "더 넣을 말",
  freeformPlaceholder: "",
  source: "자료",
  symptoms: "걸리는 점",
  sourcePlaceholder: "",
  onBehalf: (n) => `대신 정한 것 ${n}개`,
  delegated: "AI가 알아서 정함",
  copy: "복사",
  copied: "복사됨",
  send: "대화로 보내기",
  chars: (n) => `${n}자`,
  clear: "해제",
  preview: "미리보기",
  previewing: "쓰는 중",
  refold: "이 자료로 다시 펼치기",
  refolding: "펼치는 중",
  outOfRange: (min, max) => `보통 ${min}~${max} 범위입니다`,
};

const en: Strings = {
  map: "Map",
  tabList: "List",
  tabResult: "Result",
  more: (n) => `Decide more (${n})`,
  less: "Collapse",
  freeform: "Anything else",
  freeformPlaceholder: "",
  source: "Source",
  symptoms: "What's off",
  sourcePlaceholder: "",
  onBehalf: (n) => `Decided for you: ${n}`,
  delegated: "left to the AI",
  copy: "Copy",
  copied: "Copied",
  send: "Send to chat",
  chars: (n) => `${n} chars`,
  clear: "Clear",
  preview: "Preview",
  previewing: "Writing",
  refold: "Refold around this",
  refolding: "Refolding",
  outOfRange: (min, max) => `Usually between ${min} and ${max}`,
};

export function strings(locale: Locale): Strings {
  return locale === "ko" ? ko : en;
}
