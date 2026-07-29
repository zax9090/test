/**
 * Language detection for widget chrome.
 *
 * Axis labels, values and help text come from the model, so they already match
 * the request's language. Only the widget's own words (tab names, buttons) need
 * switching — Korean and English, everything else falls back to English.
 */

export type Locale = "ko" | "en";

// Counting uses the /g forms; the has-any checks use the plain forms, because
// `RegExp.test` on a /g regex is stateful and would alternate between calls.
const HANGUL_G = /[가-힣ᄀ-ᇿ㄰-㆏]/g;
const LATIN_G = /[A-Za-z]/g;

const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;
const KANA = /[぀-ヿ]/;
const HAN = /[一-鿿]/;
const CYRILLIC = /[Ѐ-ӿ]/;
const ARABIC = /[؀-ۿ]/;

/**
 * Pick the widget chrome language for a request.
 *
 * Counts Hangul against Latin letters rather than looking for a single match,
 * so an English request quoting a Korean phrase still reads as English. Ties
 * and empty input go to English, per the fallback rule.
 */
export function detectLocale(text: string): Locale {
  if (!text) return "en";
  const hangul = text.match(HANGUL_G)?.length ?? 0;
  const latin = text.match(LATIN_G)?.length ?? 0;
  return hangul > latin ? "ko" : "en";
}

/**
 * Name the request's language for the extraction prompt.
 *
 * Deliberately broader than {@link Locale}: the model should label axes in
 * whatever language the user wrote in, not just the two the chrome supports.
 * Kana is checked before Han so Japanese isn't misread as Chinese.
 */
export function describeLanguage(text: string): string {
  if (HANGUL.test(text)) return "Korean";
  if (KANA.test(text)) return "Japanese";
  if (HAN.test(text)) return "Chinese";
  if (CYRILLIC.test(text)) return "Russian";
  if (ARABIC.test(text)) return "Arabic";
  return "the same language as the request";
}
