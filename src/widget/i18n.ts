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
  refold: string;
  refolding: string;
  refoldContext: string;
  refoldAsk: (intent: string) => string;
  outOfRange: (min: string, max: string) => string;
  goal: string;
  goalOwnPlaceholder: string;
  goalSwitch: string;
  goalSwitching: string;
  goalCost: string;
  goalAsk: (intent: string, reading: string) => string;
  presets: string;
  presetPick: string;
  presetSave: string;
  presetSaveConfirm: string;
  presetSaveNew: string;
  presetOverwrite: string;
  presetDelete: string;
  presetNamePlaceholder: string;
  presetLoaded: string;
  axisAdd: string;
  axisRemove: string;
  sectionAdd: string;
  axisLabelPlaceholder: string;
  axisValuePlaceholder: string;
  sectionNamePlaceholder: string;
  tabBoard: string;
  board: string;
  panelTitle: string;
  close: string;
  back: string;
  unnamedSection: string;
  decidedOf: (decided: number, total: number) => string;
  derivedFrom: (axisId: string) => string;
  stUnset: string;
  stDefault: string;
  stChosen: string;
  stMultiple: string;
  stNotApplicable: string;
  stConflict: string;
  stDelegated: string;
  delegate: string;
  undelegate: string;
  proceed: string;
}

const ko: Strings = {
  map: "지도",
  tabList: "목록",
  tabResult: "결과",
  more: (n) => `더 정하기 (${n})`,
  less: "접기",
  freeform: "더 넣을 말",
  freeformPlaceholder: "축으로 잡히지 않는 요구가 있다면",
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
  refold: "이 자료로 다시 펼치기",
  refolding: "다시 펼치는 중",
  refoldContext: "사용자가 unknown-unknowns 위젯의 자료 칸에 아래 자료를 넣었습니다.",
  refoldAsk: (intent) => `방금 넣은 자료에 맞춰 "${intent}"를 다시 펼쳐줘.`,
  outOfRange: (min, max) => `보통 ${min}~${max} 범위입니다`,
  goal: "목표",
  goalOwnPlaceholder: "다르게 읽기",
  goalSwitch: "이걸로",
  goalSwitching: "새 축을 뽑는 중",
  goalCost: "목표를 바꾸면 축이 새로 만들어져서 지금 고른 값은 사라집니다",
  goalAsk: (intent, reading) => `"${intent}"를 "${reading}"으로 보고 다시 펼쳐줘.`,
  presets: "프리셋",
  presetPick: "불러오기",
  presetSave: "프리셋으로 저장",
  presetSaveConfirm: "저장",
  presetSaveNew: "새로 저장",
  presetOverwrite: "덮어쓰기",
  presetDelete: "삭제",
  presetNamePlaceholder: "이름",
  presetLoaded: "프리셋에서 불러옴",
  axisAdd: "+ 항목 추가",
  axisRemove: "삭제",
  sectionAdd: "+ 묶음 추가",
  axisLabelPlaceholder: "항목 이름 (예: 털 길이)",
  axisValuePlaceholder: "이 항목을 어떻게 할지",
  sectionNamePlaceholder: "묶음 이름",
  tabBoard: "구조",
  board: "결정 상태 보드",
  panelTitle: "자세히",
  close: "닫기",
  back: "뒤로",
  unnamedSection: "묶음",
  decidedOf: (decided, total) => `${total}개 중 ${decided}개 정함`,
  derivedFrom: (axisId) => `${axisId}에 따라 정해집니다`,
  stUnset: "미정",
  stDefault: "기본값",
  stChosen: "선택됨",
  stMultiple: "여러 값 선택됨",
  stNotApplicable: "해당 없음",
  stConflict: "충돌",
  stDelegated: "AI에 맡김",
  delegate: "AI에 맡기기",
  undelegate: "직접 정하기",
  proceed: "이대로 진행",
};

const en: Strings = {
  map: "Map",
  tabList: "List",
  tabResult: "Result",
  more: (n) => `Decide more (${n})`,
  less: "Collapse",
  freeform: "Anything else",
  freeformPlaceholder: "Anything the axes do not cover",
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
  refold: "Refold around this",
  refolding: "Refolding",
  refoldContext:
    "The user put the following material into the unknown-unknowns widget's source box.",
  refoldAsk: (intent) => `Unfold "${intent}" again, fitted to the material I just added.`,
  outOfRange: (min, max) => `Usually between ${min} and ${max}`,
  goal: "Goal",
  goalOwnPlaceholder: "Read it differently",
  goalSwitch: "Use this",
  goalSwitching: "Building new axes",
  goalCost: "Switching the goal rebuilds the axes, so the values you picked will be lost",
  goalAsk: (intent, reading) => `Unfold "${intent}" again, read as "${reading}".`,
  presets: "Presets",
  presetPick: "Load",
  presetSave: "Save as preset",
  presetSaveConfirm: "Save",
  presetSaveNew: "Save as new",
  presetOverwrite: "Overwrite",
  presetDelete: "Delete",
  presetNamePlaceholder: "Name",
  presetLoaded: "from a preset",
  axisAdd: "+ Add an item",
  axisRemove: "Remove",
  sectionAdd: "+ Add a group",
  axisLabelPlaceholder: "Item name (e.g. coat length)",
  axisValuePlaceholder: "What to do about it",
  sectionNamePlaceholder: "Group name",
  tabBoard: "Structure",
  board: "Decision status board",
  panelTitle: "Details",
  close: "Close",
  back: "Back",
  unnamedSection: "Group",
  decidedOf: (decided, total) => `${decided} of ${total} decided`,
  derivedFrom: (axisId) => `Settled by ${axisId}`,
  stUnset: "Undecided",
  stDefault: "Default",
  stChosen: "Chosen",
  stMultiple: "Several chosen",
  stNotApplicable: "Not applicable",
  stConflict: "Conflict",
  stDelegated: "Left to the AI",
  delegate: "Leave to the AI",
  undelegate: "Decide myself",
  proceed: "Go with this",
};

export function strings(locale: Locale): Strings {
  return locale === "ko" ? ko : en;
}
