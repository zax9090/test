/**
 * Widget behaviour, driven over the real `ui/` protocol.
 *
 * The harness page mounts the built widget in an iframe and talks to it with
 * `AppBridge` — the same class a compliant host uses — so this exercises the
 * handshake, the tool-result delivery and the rendered DOM, not a mock.
 *
 *   npm run build:widget && npm run build:harness && npx playwright test
 */

import { expect, test } from "@playwright/test";

const PAYLOAD = {
  content: [{ type: "text", text: "{}" }],
  structuredContent: {
    locale: "ko",
    requestId: "test",
    unfolded: {
      title: "고양이 이미지",
      intent: "고양이 이미지 만들어줘",
      axes: [
        {
          id: "coat",
          label: "털색",
          group: "core",
          type: "select",
          norm: "보통 단색이 인식률이 높습니다",
          options: [
            { value: "black", label: "검정", emit: "털색은 검은색으로 한다.", common: true },
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
          id: "light",
          label: "조명",
          group: "extra",
          type: "select",
          default: "soft",
          options: [
            { value: "soft", label: "부드럽게", emit: "부드러운 조명을 쓴다." },
            { value: "hard", label: "강하게", emit: "강한 조명을 쓴다." },
          ],
        },
        {
          id: "bg",
          label: "배경",
          group: "extra",
          type: "select",
          options: [{ value: "plain", label: "단색", emit: "배경은 단색으로 한다." }],
        },
        {
          id: "width",
          label: "가로",
          group: "extra",
          type: "range",
          range: { unit: "px", min: 256, max: 2048, emitTemplate: "가로 {value}px로 만든다." },
        },
      ],
      fixes: [{ label: "단색 배경", set: { bg: "plain" } }],
    },
  },
};

/** Load the harness with a payload and wait until the widget has rendered. */
async function open(page, payload = PAYLOAD) {
  await page.addInitScript((p) => {
    window.__payload = p;
  }, payload);
  await page.goto("/host.html");
  await page.waitForFunction(() => window.__harness?.ready === true);

  const frame = page.frameLocator("#app");
  await expect(frame.locator(".uu-header")).toBeVisible();
  return frame;
}

const resultTab = (frame) => frame.locator(".uu-tab", { hasText: "결과" });
const prompt = (frame) => frame.locator(".uu-prompt");

test("renders the request and its core axes", async ({ page }) => {
  const frame = await open(page);

  await expect(frame.locator(".uu-header-text")).toHaveText("고양이 이미지 만들어줘");
  await expect(frame.locator(".uu-label").filter({ hasText: "털색" })).toBeVisible();
  await expect(frame.locator(".uu-label").filter({ hasText: "자세" })).toBeVisible();
  await expect(frame.locator(".uu-norm")).toHaveText("보통 단색이 인식률이 높습니다");
});

test("folds extra axes behind a count, with no wording beyond the number", async ({ page }) => {
  const frame = await open(page);

  const fold = frame.locator(".uu-fold").first();
  await expect(fold).toHaveText("더 정하기 (3)");

  // Extras are hidden until asked for.
  await expect(frame.locator(".uu-label").filter({ hasText: "배경" })).toHaveCount(0);
  await fold.click();
  await expect(frame.locator(".uu-label").filter({ hasText: "배경" })).toBeVisible();

  // P6 / "do not": no sufficiency claim, no progress, no completeness figure.
  const text = await frame.locator(".uu-list").innerText();
  expect(text).not.toMatch(/충분|완성도|최적화|%/);
});

test("nothing is preselected, including the common value", async ({ page }) => {
  const frame = await open(page);

  await expect(frame.locator(".uu-chip.is-on")).toHaveCount(0);
  // `common` shows a dot and nothing more.
  await expect(frame.locator(".uu-chip", { hasText: "검정" }).locator(".uu-dot")).toHaveCount(1);
});

test("touching a chip changes the result", async ({ page }) => {
  const frame = await open(page);

  // The opening text is the request plus whatever a `default` decided on the
  // user's behalf — `light` carries one. Nothing else.
  await expect(prompt(frame)).toHaveText("고양이 이미지 만들어줘\n\n부드러운 조명을 쓴다.");

  await frame.locator(".uu-chip", { hasText: "검정" }).click();
  await expect(prompt(frame)).toContainText("털색은 검은색으로 한다.");

  await frame.locator(".uu-chip", { hasText: "누움" }).click();
  await expect(prompt(frame)).toContainText("누워 있는 자세로 그린다.");
});

test("clicking a selected chip clears it, restoring the earlier text exactly", async ({ page }) => {
  const frame = await open(page);
  const chip = frame.locator(".uu-chip", { hasText: "검정" });

  const before = await prompt(frame).innerText();

  await chip.click();
  await expect(chip).toHaveClass(/is-on/);
  await expect(prompt(frame)).toContainText("털색은 검은색");

  await chip.click();
  await expect(chip).not.toHaveClass(/is-on/);
  await expect(prompt(frame)).toHaveText(before);
});

test("an undecided axis leaves no trace in the prompt", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-chip", { hasText: "검정" }).click();

  const text = await prompt(frame).innerText();
  expect(text).toContain("털색은 검은색");
  expect(text).not.toContain("자세");
  expect(text).not.toContain("배경");
});

test("shows the three result states and folds the decided-for-you group", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-chip", { hasText: "검정" }).click();
  await resultTab(frame).click();

  // set
  await expect(frame.locator(".uu-lines").first()).toContainText("털색은 검은색");

  // partial — `light` carries a default, and the group shows only a count until
  // opened. (Its sentence is in the prompt regardless: a defaulted value is
  // copied. What is folded away is the per-axis line, not the effect.)
  const partialGroup = frame.locator(".uu-dim-mid");
  const partialFold = partialGroup.locator(".uu-fold");
  await expect(partialFold).toHaveText(/대신 정한 것 1개/);
  await expect(partialGroup.locator(".uu-line-btn")).toHaveCount(0);
  await partialFold.click();
  await expect(partialGroup.locator(".uu-line-btn")).toContainText("부드러운 조명을 쓴다.");

  // unset — shown, dimmed
  await expect(frame.locator(".uu-dim")).toContainText("AI가 알아서 정함");
});

test("the delegated lines are on screen but not in the copied text", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-chip", { hasText: "검정" }).click();
  await resultTab(frame).click();

  await expect(frame.locator(".uu-dim")).toContainText("배경");
  // The prompt itself carries the chosen and the defaulted, never the delegated.
  const text = await prompt(frame).innerText();
  expect(text).toContain("털색은 검은색");
  expect(text).toContain("부드러운 조명"); // partial is copied
  expect(text).not.toContain("AI가 알아서 정함");
  expect(text).not.toContain("배경은 단색");
});

test("a delegated line opens its chips in place, not in the list tab", async ({ page }) => {
  const frame = await open(page);
  await resultTab(frame).click();

  const line = frame.locator(".uu-line-btn", { hasText: "배경" });
  await line.click();

  // Chips appear inline, and the result tab is still the one showing.
  await expect(frame.locator(".uu-inline-edit .uu-chip", { hasText: "단색" })).toBeVisible();
  await expect(resultTab(frame)).toHaveAttribute("aria-selected", "true");

  await frame.locator(".uu-inline-edit .uu-chip", { hasText: "단색" }).click();
  await expect(prompt(frame)).toContainText("배경은 단색으로 한다.");
});

test("a range accepts a value outside its stated bounds", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-fold").first().click();

  const input = frame.locator(".uu-input-num");
  await input.fill("99999");
  await expect(prompt(frame)).toContainText("가로 99999px로 만든다.");
  // Told, not blocked.
  await expect(frame.locator(".uu-note")).toContainText("보통 256~2048");
});

test("a correction button applies its whole set", async ({ page }) => {
  const frame = await open(page);
  await resultTab(frame).click();

  await frame.locator(".uu-fixes .uu-chip", { hasText: "단색 배경" }).click();
  await expect(prompt(frame)).toContainText("배경은 단색으로 한다.");
});

test("tab state survives switching", async ({ page }) => {
  const frame = await open(page);

  await frame.locator(".uu-fold").first().click();
  await frame.locator(".uu-chip", { hasText: "검정" }).click();
  await resultTab(frame).click();
  await frame.locator(".uu-tab", { hasText: "목록" }).click();

  // Still expanded, still selected.
  await expect(frame.locator(".uu-label").filter({ hasText: "배경" })).toBeVisible();
  await expect(frame.locator(".uu-chip", { hasText: "검정" })).toHaveClass(/is-on/);
});

test("send hands the assembled prompt to the host", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-chip", { hasText: "검정" }).click();
  await resultTab(frame).click();
  await frame.locator(".uu-btn", { hasText: "대화로 보내기" }).click();

  await expect
    .poll(() => page.evaluate(() => window.__harness.sent.length))
    .toBeGreaterThan(0);

  const sent = await page.evaluate(() => window.__harness.sent[0]);
  expect(sent.role).toBe("user");
  expect(sent.text).toContain("털색은 검은색");
  expect(sent.text).not.toContain("AI가 알아서 정함");
});

test("shows a character count and no quality figure", async ({ page }) => {
  const frame = await open(page);
  await resultTab(frame).click();

  await expect(frame.locator(".uu-count")).toHaveText(/^\d+자$/);
  const text = await frame.locator(".uu-result").innerText();
  expect(text).not.toMatch(/점수|품질|최적화|개선|완성도|\d+%/);
});

test("switches its own chrome to English for an English request", async ({ page }) => {
  const frame = await open(page, {
    content: [{ type: "text", text: "{}" }],
    structuredContent: {
      locale: "en",
      unfolded: {
        title: "Launch note",
        intent: "Write a launch announcement",
        axes: [
          {
            id: "tone",
            label: "Tone",
            group: "core",
            type: "select",
            options: [{ value: "plain", label: "Plain", emit: "Keep the tone plain." }],
          },
        ],
      },
    },
  });

  await expect(frame.locator(".uu-tab").first()).toHaveText("List");
  await expect(frame.locator(".uu-tab").nth(1)).toHaveText("Result");
});

// ── the map ────────────────────────────────────────────────────────────────

const setIframeWidth = (page, px) =>
  page.evaluate((w) => {
    document.querySelector("#app").style.width = `${w}px`;
  }, px);

test("the map is folded until asked for", async ({ page }) => {
  const frame = await open(page);

  await expect(frame.locator(".uu-header-btn")).toContainText("고양이 이미지 만들어줘");
  await expect(frame.locator(".uu-maplabel")).toHaveText("지도");
  await expect(frame.locator(".uu-map")).toHaveCount(0);

  await frame.locator(".uu-header-btn").click();
  await expect(frame.locator(".uu-map")).toBeVisible();
});

test("draws every axis, centred on the request", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-header-btn").click();

  await expect(frame.locator(".uu-node")).toHaveCount(5);
  await expect(frame.locator(".uu-map-intent")).toContainText("고양이");
  // core inside, extra outside
  await expect(frame.locator(".uu-node.is-extra")).toHaveCount(3);
});

test("spokes are solid for decided axes and dashed for undecided ones", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-chip", { hasText: "검정" }).click();
  await frame.locator(".uu-header-btn").click();

  const coat = frame.locator('[data-node="coat"] line');
  const pose = frame.locator('[data-node="pose"] line');

  await expect(coat).not.toHaveAttribute("stroke-dasharray", /.+/);
  await expect(pose).toHaveAttribute("stroke-dasharray", "3 3");
});

test("a node moves to its axis in the list instead of editing it", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-header-btn").click();

  const before = await prompt(frame).innerText();
  await frame.locator('[data-node="pose"] .uu-node-hit').click();

  // Navigates, never edits.
  await expect(frame.locator(".uu-tab", { hasText: "목록" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(prompt(frame)).toHaveText(before);
  await expect(frame.locator('.uu-row[data-axis="pose"]')).toBeInViewport();
});

test("a node inside the fold opens the fold on the way", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-header-btn").click();

  // `bg` is an extra, so its row is not rendered yet.
  await expect(frame.locator('.uu-row[data-axis="bg"]')).toHaveCount(0);
  await frame.locator('[data-node="bg"] .uu-node-hit').click();
  await expect(frame.locator('.uu-row[data-axis="bg"]')).toBeInViewport();
});

test("no map at all below the narrow threshold", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-header-btn").click();
  await expect(frame.locator(".uu-map")).toBeVisible();

  await setIframeWidth(page, 440);

  // Header only — and the toggle goes with it, so there is nothing to open.
  await expect(frame.locator(".uu-map")).toHaveCount(0);
  await expect(frame.locator(".uu-header-btn")).toHaveCount(0);
  await expect(frame.locator(".uu-header")).toContainText("고양이 이미지 만들어줘");

  await setIframeWidth(page, 640);
  await expect(frame.locator(".uu-header-btn")).toBeVisible();
});

test("uses no emoji anywhere in its own chrome", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-fold").first().click();
  const list = await frame.locator(".uu-root").innerText();
  await resultTab(frame).click();
  const result = await frame.locator(".uu-root").innerText();

  const emoji = /\p{Extended_Pictographic}/u;
  expect(emoji.test(list)).toBe(false);
  expect(emoji.test(result)).toBe(false);
});
