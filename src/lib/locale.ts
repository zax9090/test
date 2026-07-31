/**
 * Language detection for widget chrome.
 *
 * Axis labels, values and help text come from the model, so they already match
 * the request's language. Only the widget's own words (tab names, buttons) need
 * switching — Korean and English, everything else falls back to English.
 */

export type Locale = "ko" | "en";

/** Stripped before counting: a link says nothing about the sentence's language. */
const URL_G = /\b(?:https?:\/\/|www\.)\S+|\b[\w.-]+\.(?:com|net|org|io|dev|app|co\.kr|kr)\b\S*/gi;

/** Word-ish runs, so a product name counts once rather than once per letter. */
const TOKEN_G = /[^\s,./()[\]{}"'`|]+/g;

const HANGUL = /[가-힣ᄀ-ᇿ㄰-㆏]/;
const LATIN = /[A-Za-z]/;
const KANA = /[぀-ヿ]/;
const HAN = /[一-鿿]/;
const CYRILLIC = /[Ѐ-ӿ]/;
const ARABIC = /[؀-ۿ]/;

/**
 * Pick the widget chrome language for a request.
 *
 * Counted by *word*, not by letter. Letter counting failed on the ordinary case
 * of a Korean sentence carrying an English product name — "내가 등록한 unknown
 * mcp 테스트 해줘" is ten Hangul syllables against ten Latin letters, a tie that
 * fell to English, even though every word of grammar in it is Korean. One
 * English noun should weigh the same as one Korean noun, however it is spelled.
 *
 * A word counts as Korean if it contains any Hangul, and as English only if it
 * is Latin throughout — so "테스트" and "unknown" are one each, and a Korean word
 * with a Latin suffix still reads Korean.
 *
 * URLs are removed first: a link is not evidence of the language around it.
 *
 * A tie goes to Korean whenever any Korean is present. "GitHub Actions 워크플로
 * 고쳐줘" is two words each way, and it is plainly a Korean sentence: borrowing an
 * English noun into Korean grammar is ordinary, while the reverse — an English
 * sentence built from an equal number of Korean words — is not a thing people
 * write. An English sentence quoting a Korean phrase is still English, because
 * one quoted phrase loses to the sentence's many words.
 *
 * Empty input and scripts the chrome does not speak fall back to English.
 */
export function detectLocale(text: string): Locale {
  if (!text?.trim()) return "en";

  const withoutUrls = text.replace(URL_G, " ");
  let korean = 0;
  let english = 0;

  for (const token of withoutUrls.match(TOKEN_G) ?? []) {
    if (HANGUL.test(token)) korean += 1;
    else if (LATIN.test(token)) english += 1;
    // Digits, punctuation and other scripts count for neither side.
  }

  return korean > 0 && korean >= english ? "ko" : "en";
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
