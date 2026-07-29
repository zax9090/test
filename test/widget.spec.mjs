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

// ── sample axes and preview ────────────────────────────────────────────────

const SAMPLE_PAYLOAD = {
  content: [{ type: "text", text: "{}" }],
  structuredContent: {
    locale: "ko",
    requestId: "req-1",
    canPreview: true,
    unfolded: {
      title: "요약",
      intent: "회의록을 요약해줘",
      axes: [
        {
          id: "voice",
          label: "문체",
          group: "core",
          type: "sample",
          options: [
            {
              value: "plain",
              label: "담백하게",
              emit: "담백한 문체로 쓴다.",
              preview: "예산은 3분기까지 동결된다.\n채용은 두 자리만 유지한다.",
            },
            {
              value: "warm",
              label: "부드럽게",
              emit: "부드러운 문체로 쓴다.",
              preview: "예산은 당분간 그대로 가기로 했습니다.\n채용은 두 자리만 열어두려 합니다.",
            },
            { value: "terse", label: "아주 짧게", emit: "아주 짧게 쓴다." },
          ],
        },
      ],
    },
  },
};

async function openSamples(page, { reply = null, hold = false } = {}) {
  await page.addInitScript(
    ({ r, h }) => {
      window.__previewReply = r;
      window.__holdPreview = h;
    },
    { r: reply, h: hold },
  );
  return open(page, SAMPLE_PAYLOAD);
}

test("a sample axis shows each direction as readable text, not a label", async ({ page }) => {
  const frame = await openSamples(page);

  await expect(frame.locator(".uu-card")).toHaveCount(3);
  await expect(frame.locator(".uu-card").first()).toContainText("예산은 3분기까지 동결된다.");
  // A direction with no sample yet is still offered — the card is just lighter.
  await expect(frame.locator(".uu-card").nth(2)).toContainText("아주 짧게");
});

test("picking a card decides the axis", async ({ page }) => {
  const frame = await openSamples(page);

  await frame.locator(".uu-card", { hasText: "담백하게" }).click();
  await expect(prompt(frame)).toContainText("담백한 문체로 쓴다.");
  await expect(frame.locator(".uu-card.is-on")).toHaveCount(1);
});

test("preview only runs when its button is pressed", async ({ page }) => {
  const frame = await openSamples(page, { reply: { plain: "새로 쓴 샘플." } });

  // Nothing fired on render, which is the point — sampling asks for approval.
  await expect
    .poll(() => page.evaluate(() => window.__harness.toolCalls.length))
    .toBe(0);

  await frame.locator(".uu-refresh").click();
  await expect.poll(() => page.evaluate(() => window.__harness.toolCalls.length)).toBe(1);

  const call = await page.evaluate(() => window.__harness.toolCalls[0]);
  expect(call.name).toBe("preview");
  expect(call.arguments.requestId).toBe("req-1");
  expect(call.arguments.axisId).toBe("voice");
});

test("fresh samples replace the old ones", async ({ page }) => {
  const frame = await openSamples(page, {
    reply: { plain: "새로 쓴 담백한 샘플.", warm: "새로 쓴 부드러운 샘플." },
  });

  await frame.locator(".uu-refresh").click();
  await expect(frame.locator(".uu-card").first()).toContainText("새로 쓴 담백한 샘플.");
  await expect(frame.locator(".uu-card").nth(1)).toContainText("새로 쓴 부드러운 샘플.");
});

test("the cards stay put while new text is being written", async ({ page }) => {
  const frame = await openSamples(page, { reply: { plain: "나중에 도착." }, hold: true });

  await frame.locator(".uu-refresh").click();

  // Mid-flight: old text still there, no skeleton, no spinner, nothing blank.
  await expect(frame.locator(".uu-card").first()).toContainText("예산은 3분기까지 동결된다.");
  await expect(frame.locator(".uu-refresh")).toBeDisabled();
  await expect(frame.locator(".uu-cards")).toBeVisible();

  await page.evaluate(() => {
    window.__holdPreview = false;
  });
  await expect(frame.locator(".uu-card").first()).toContainText("나중에 도착.");
});

test("a failed preview says nothing and loses nothing", async ({ page }) => {
  const frame = await openSamples(page, { reply: null });

  await frame.locator(".uu-refresh").click();
  await expect.poll(() => page.evaluate(() => window.__harness.toolCalls.length)).toBe(1);

  // Old cards intact, button usable again, and no banner anywhere.
  await expect(frame.locator(".uu-card").first()).toContainText("예산은 3분기까지 동결된다.");
  await expect(frame.locator(".uu-refresh")).toBeEnabled();
  const text = await frame.locator(".uu-root").innerText();
  expect(text).not.toMatch(/실패|오류|에러|error|failed/i);
});

test("the current source box is what preview is grounded in", async ({ page }) => {
  const frame = await openSamples(page, { reply: { plain: "x" } });

  await frame.locator(".uu-textarea").fill("나중에 붙여넣은 회의록");
  await frame.locator(".uu-refresh").click();
  await expect.poll(() => page.evaluate(() => window.__harness.toolCalls.length)).toBe(1);

  const call = await page.evaluate(() => window.__harness.toolCalls[0]);
  expect(call.arguments.source).toBe("나중에 붙여넣은 회의록");
});

// ── symptoms ───────────────────────────────────────────────────────────────

const SYMPTOM_PAYLOAD = {
  content: [{ type: "text", text: "{}" }],
  structuredContent: {
    locale: "ko",
    requestId: "req-s",
    canPreview: false,
    unfolded: {
      title: "고양이",
      intent: "고양이 이미지 만들어줘",
      axes: [
        {
          id: "coat",
          label: "털색",
          group: "core",
          type: "select",
          options: [{ value: "black", label: "검정", emit: "털색은 검은색." }],
        },
      ],
      symptoms: [
        { id: "flat", label: "밋밋함", emit: "명암 대비를 더 준다." },
        { id: "busy", label: "산만함", emit: "배경 요소를 줄인다." },
      ],
    },
  },
};

test("symptoms are offered, and reach the prompt", async ({ page }) => {
  const frame = await open(page, SYMPTOM_PAYLOAD);

  await expect(frame.locator(".uu-label").filter({ hasText: "걸리는 점" })).toBeVisible();
  await expect(prompt(frame)).toHaveText("고양이 이미지 만들어줘");

  await frame.locator(".uu-chip", { hasText: "밋밋함" }).click();
  await expect(prompt(frame)).toContainText("명암 대비를 더 준다.");

  // Several things can be off at once.
  await frame.locator(".uu-chip", { hasText: "산만함" }).click();
  await expect(prompt(frame)).toContainText("배경 요소를 줄인다.");

  // And they clear like any other chip.
  await frame.locator(".uu-chip", { hasText: "밋밋함" }).click();
  await expect(prompt(frame)).not.toContainText("명암 대비");
});

test("symptoms land after the axes in the prompt", async ({ page }) => {
  const frame = await open(page, SYMPTOM_PAYLOAD);
  await frame.locator(".uu-chip", { hasText: "검정" }).click();
  await frame.locator(".uu-chip", { hasText: "밋밋함" }).click();

  const text = await prompt(frame).innerText();
  expect(text.indexOf("털색은 검은색")).toBeLessThan(text.indexOf("명암 대비"));
});

// ── source round trip ──────────────────────────────────────────────────────

test("material given with the request shows up in the box and the prompt", async ({ page }) => {
  const frame = await open(page, {
    content: [{ type: "text", text: "{}" }],
    structuredContent: {
      ...SYMPTOM_PAYLOAD.structuredContent,
      source: "예산은 3분기까지 동결하기로 했다.",
    },
  });

  await expect(frame.locator(".uu-textarea")).toHaveValue("예산은 3분기까지 동결하기로 했다.");
  await expect(prompt(frame)).toContainText("자료: 예산은 3분기까지 동결하기로 했다.");
});

// ── preview gating ─────────────────────────────────────────────────────────

test("no preview button on a host that cannot write one", async ({ page }) => {
  const frame = await open(page, {
    ...SAMPLE_PAYLOAD,
    structuredContent: { ...SAMPLE_PAYLOAD.structuredContent, canPreview: false },
  });

  // The cards are still there and still choosable — only the button that would
  // never respond is gone.
  await expect(frame.locator(".uu-card")).toHaveCount(3);
  await expect(frame.locator(".uu-refresh")).toHaveCount(0);
});

// ── supersession ───────────────────────────────────────────────────────────

test("a superseded widget stops speaking for the user", async ({ page }) => {
  const frame = await open(page);
  await expect(frame.locator(".uu-tab", { hasText: "결과" })).toBeVisible();
  await frame.locator(".uu-tab", { hasText: "결과" }).click();
  await expect(frame.locator(".uu-btn", { hasText: "대화로 보내기" })).toBeVisible();

  // Stand in for a newer widget mounting in a later turn.
  await page.evaluate(() => {
    const bc = new BroadcastChannel("unknown-unknowns");
    bc.postMessage({ seq: Number.MAX_SAFE_INTEGER });
    bc.close();
  });

  await expect(frame.locator(".uu-btn", { hasText: "대화로 보내기" })).toHaveCount(0);
  // Copying an older widget is harmless and stays.
  await expect(frame.locator(".uu-btn", { hasText: "복사" })).toBeVisible();
});

test("an earlier announcement does not silence a newer widget", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-tab", { hasText: "결과" }).click();

  await page.evaluate(() => {
    const bc = new BroadcastChannel("unknown-unknowns");
    bc.postMessage({ seq: 1 });
    bc.close();
  });

  await expect(frame.locator(".uu-btn", { hasText: "대화로 보내기" })).toBeVisible();
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
