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
      sections: [
        {
          id: "subject",
          label: "대상",
          axes: [
            {
              id: "coat",
              label: "털색",
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
              type: "select",
              options: [
                { value: "lying", label: "누움", emit: "누워 있는 자세로 그린다." },
                { value: "sitting", label: "앉음", emit: "앉아 있는 자세로 그린다." },
              ],
            },
          ],
        },
        {
          id: "setting",
          label: "환경",
          axes: [
            {
              id: "light",
              label: "조명",
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
              type: "select",
              options: [{ value: "plain", label: "단색", emit: "배경은 단색으로 한다." }],
            },
          ],
        },
        {
          id: "frame",
          label: "화면",
          axes: [
            {
              id: "width",
              label: "가로",
              type: "range",
              range: { unit: "px", min: 256, max: 2048, emitTemplate: "가로 {value}px로 만든다." },
            },
          ],
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

test("groups axes into named sections, all of them open", async ({ page }) => {
  const frame = await open(page);

  await expect(frame.locator(".uu-section-label")).toHaveText(["대상", "환경", "화면"]);

  // Nothing is folded away — every axis is reachable without opening anything.
  for (const label of ["털색", "자세", "조명", "배경", "가로"]) {
    await expect(frame.locator(".uu-label").filter({ hasText: label })).toBeVisible();
  }
  // The list has no folds left. (The result tab keeps one, for the
  // decided-for-you group — that is a different thing in a different place.)
  await expect(frame.locator(".uu-list .uu-fold")).toHaveCount(0);
});

test("says nothing beside a section heading — no count, no progress", async ({ page }) => {
  const frame = await open(page);

  // A counter next to a heading would read as a target (P6, "do not").
  for (const heading of await frame.locator(".uu-section-label").all()) {
    expect(await heading.innerText()).not.toMatch(/\d/);
  }
  const text = await frame.locator(".uu-list").innerText();
  expect(text).not.toMatch(/충분|완성도|최적화|%|\d+\s*\/\s*\d+/);
});

test("separates sections with space, not a rule", async ({ page }) => {
  const frame = await open(page);
  const sections = frame.locator(".uu-section");

  const borders = await sections.evaluateAll((els) =>
    els.map((el) => {
      const s = getComputedStyle(el);
      return [s.borderTopWidth, s.borderBottomWidth, s.borderTopStyle];
    }),
  );
  for (const [top, bottom] of borders) {
    expect(top).toBe("0px");
    expect(bottom).toBe("0px");
  }

  // And the gap between sections is real.
  const gap = await sections.nth(1).evaluate((el) => getComputedStyle(el).marginTop);
  expect(parseFloat(gap)).toBeGreaterThan(14);
});

test("nothing is preselected, including the common value", async ({ page }) => {
  const frame = await open(page);

  await expect(frame.locator(".uu-chip.is-on")).toHaveCount(0);
  // `common` shows a dot and nothing more.
  await expect(frame.locator(".uu-chip", { hasText: "검정" }).locator(".uu-dot")).toHaveCount(1);
});

test("a defaulted value does not look like a chosen one", async ({ page }) => {
  const frame = await open(page);

  // `light` carries a default, so its chip is on — but as a stand-in, not as a
  // user choice. With no fold left this row is visible from the start, and a
  // filled chip nobody clicked would read as a preselection.
  const standIn = frame.locator(".uu-chip", { hasText: "부드럽게" });
  await expect(standIn).toHaveClass(/is-default/);
  await expect(standIn).not.toHaveClass(/is-on/);

  // Choosing it yourself is a different state.
  await standIn.click();
  await expect(standIn).toHaveClass(/is-on/);
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

  await frame.locator(".uu-chip", { hasText: "검정" }).click();
  await resultTab(frame).click();
  await frame.locator(".uu-tab", { hasText: "목록" }).click();

  await expect(frame.locator(".uu-chip", { hasText: "검정" })).toHaveClass(/is-on/);
});

test("send hands the assembled prompt to the host", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-chip", { hasText: "검정" }).click();
  await resultTab(frame).click();
  await frame.locator(".uu-btn", { hasText: "대화로 보내기" }).click();

  await expect.poll(() => page.evaluate(() => window.__harness.sent.length)).toBeGreaterThan(0);

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
        sections: [
          {
            id: "s",
            label: "Form",
            axes: [
              {
                id: "tone",
                label: "Tone",
                type: "select",
                options: [{ value: "plain", label: "Plain", emit: "Keep the tone plain." }],
              },
            ],
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

test("draws sections and their axes as two levels", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-header-btn").click();

  await expect(frame.locator(".uu-node.is-section")).toHaveCount(3);
  await expect(frame.locator(".uu-node.is-axis")).toHaveCount(5);
  await expect(frame.locator(".uu-map-intent")).toContainText("고양이");
  await expect(frame.locator(".uu-section-node").first()).toBeVisible();
});

test("a section reads as touched once anything under it is decided", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-chip", { hasText: "검정" }).click();
  await frame.locator(".uu-header-btn").click();

  // `coat` lives in the first section, so that branch goes solid.
  await expect(frame.locator(".uu-branch").first()).not.toHaveAttribute("stroke-dasharray", /.+/);
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

test("a node in any section scrolls to its row", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-header-btn").click();

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
    unfolded: {
      title: "요약",
      intent: "회의록을 요약해줘",
      sections: [
        {
          id: "voice-section",
          label: "문체",
          axes: [
            {
              id: "voice",
              label: "문체",
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
                  preview:
                    "예산은 당분간 그대로 가기로 했습니다.\n채용은 두 자리만 열어두려 합니다.",
                },
                { value: "terse", label: "아주 짧게", emit: "아주 짧게 쓴다." },
              ],
            },
          ],
        },
      ],
    },
  },
};

test("a sample axis shows each direction as readable text, not a label", async ({ page }) => {
  const frame = await open(page, SAMPLE_PAYLOAD);

  await expect(frame.locator(".uu-card")).toHaveCount(3);
  await expect(frame.locator(".uu-card").first()).toContainText("예산은 3분기까지 동결된다.");
  // A direction with no sample yet is still offered — the card is just lighter.
  await expect(frame.locator(".uu-card").nth(2)).toContainText("아주 짧게");
});

test("picking a card decides the axis", async ({ page }) => {
  const frame = await open(page, SAMPLE_PAYLOAD);

  await frame.locator(".uu-card", { hasText: "담백하게" }).click();
  await expect(prompt(frame)).toContainText("담백한 문체로 쓴다.");
  await expect(frame.locator(".uu-card.is-on")).toHaveCount(1);
});

// ── symptoms ───────────────────────────────────────────────────────────────

const SYMPTOM_PAYLOAD = {
  content: [{ type: "text", text: "{}" }],
  structuredContent: {
    locale: "ko",
    requestId: "req-s",
    unfolded: {
      title: "고양이",
      intent: "고양이 이미지 만들어줘",
      sections: [
        {
          id: "subject",
          label: "대상",
          axes: [
            {
              id: "coat",
              label: "털색",
              type: "select",
              options: [{ value: "black", label: "검정", emit: "털색은 검은색." }],
            },
          ],
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

// ── refold ─────────────────────────────────────────────────────────────────

test("refold is offered only once the box holds something new", async ({ page }) => {
  const frame = await open(page);

  // Nothing pasted yet, so there is nothing to refold around.
  await expect(frame.locator(".uu-refold")).toHaveCount(0);

  await frame.locator(".uu-textarea").fill("예산 동결 논의 회의록");
  await expect(frame.locator(".uu-refold")).toBeVisible();
});

test("refold asks the conversation rather than calling a tool", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-textarea").fill("예산 동결 논의 회의록");
  await frame.locator(".uu-refold").click();

  await expect.poll(() => page.evaluate(() => window.__harness.sent.length)).toBe(1);

  // Nothing is asked of the server to re-extract: the model is only ever reached
  // as a caller. (`list_presets` may have run on mount; that is not extraction.)
  const named = await page.evaluate(() => window.__harness.toolCalls.map((c) => c.name));
  expect(named).not.toContain("unfold");

  const sent = await page.evaluate(() => window.__harness.sent[0]);
  expect(sent.role).toBe("user");
  expect(sent.text).toContain("고양이 이미지 만들어줘");
  expect(sent.text).toContain("다시 펼쳐줘");
});

test("the material rides in the model context, not the chat bubble", async ({ page }) => {
  const frame = await open(page);
  const material = "회의록 본문 ".repeat(40);

  await frame.locator(".uu-textarea").fill(material);
  await frame.locator(".uu-refold").click();
  await expect.poll(() => page.evaluate(() => window.__harness.context.length)).toBe(1);

  const context = await page.evaluate(() => window.__harness.context[0]);
  expect(context).toContain("회의록 본문");

  // The visible message stays one readable sentence.
  const sent = await page.evaluate(() => window.__harness.sent[0]);
  expect(sent.text).not.toContain("회의록 본문 회의록 본문");
});

test("a superseded widget cannot refold either", async ({ page }) => {
  const frame = await open(page);
  await frame.locator(".uu-textarea").fill("회의록 본문");
  await expect(frame.locator(".uu-refold")).toBeVisible();

  await page.evaluate(() => {
    const bc = new BroadcastChannel("unknown-unknowns");
    bc.postMessage({ seq: Number.MAX_SAFE_INTEGER });
    bc.close();
  });

  await expect(frame.locator(".uu-refold")).toHaveCount(0);
});

test("uses no emoji anywhere in its own chrome", async ({ page }) => {
  const frame = await open(page);
  const list = await frame.locator(".uu-root").innerText();
  await resultTab(frame).click();
  const result = await frame.locator(".uu-root").innerText();

  const emoji = /\p{Extended_Pictographic}/u;
  expect(emoji.test(list)).toBe(false);
  expect(emoji.test(result)).toBe(false);
});

// ── the goal ───────────────────────────────────────────────────────────────

/** The same payload, plus a reading the axes were built for. */
const WITH_GOAL = structuredClone(PAYLOAD);
WITH_GOAL.structuredContent.unfolded.goal = {
  selected: "사진처럼 사실적인 그림",
  alternatives: ["만화풍 그림", "수채화 느낌의 그림"],
};

test("no goal field when the request had only one reading", async ({ page }) => {
  const frame = await open(page);
  await expect(frame.locator(".uu-goal")).toHaveCount(0);
});

test("shows the reading the axes were built for, above the axes", async ({ page }) => {
  const frame = await open(page, WITH_GOAL);

  await expect(frame.locator(".uu-goal-text")).toHaveText("사진처럼 사실적인 그림");

  // It governs the axes, so it sits above them rather than among them.
  const goalY = (await frame.locator(".uu-goal").boundingBox()).y;
  const firstAxisY = (await frame.locator(".uu-row").first().boundingBox()).y;
  expect(goalY).toBeLessThan(firstAxisY);
});

test("the goal is in the prompt from the start, on the line below the request", async ({
  page,
}) => {
  const frame = await open(page, WITH_GOAL);
  const text = await prompt(frame).innerText();
  const lines = text.split("\n");

  expect(lines[0]).toBe("고양이 이미지 만들어줘");
  expect(lines[1]).toBe("사진처럼 사실적인 그림");
});

test("alternatives stay closed until asked for, and never reach the prompt", async ({ page }) => {
  const frame = await open(page, WITH_GOAL);

  await expect(frame.locator(".uu-goal-alt")).toHaveCount(0);
  expect(await prompt(frame).innerText()).not.toContain("만화풍");

  await frame.locator(".uu-goal-current").click();
  await expect(frame.locator(".uu-goal-alt")).toHaveText(["만화풍 그림", "수채화 느낌의 그림"]);

  // Still not in the prompt — only the taken reading is instruction.
  expect(await prompt(frame).innerText()).not.toContain("만화풍");
});

test("switching the goal asks the conversation, and says what it costs first", async ({ page }) => {
  const frame = await open(page, WITH_GOAL);
  await frame.locator(".uu-goal-current").click();

  // The cost is stated before the click, not after.
  await expect(frame.locator(".uu-goal-open .uu-note")).toContainText("사라집니다");

  await frame.locator(".uu-goal-alt", { hasText: "만화풍 그림" }).click();
  await expect.poll(() => page.evaluate(() => window.__harness.sent.length)).toBe(1);

  // Same route as refold: no server tool is asked to build the new axes.
  const named = await page.evaluate(() => window.__harness.toolCalls.map((c) => c.name));
  expect(named).not.toContain("unfold");

  const sent = await page.evaluate(() => window.__harness.sent[0]);
  expect(sent.role).toBe("user");
  expect(sent.text).toContain("고양이 이미지 만들어줘");
  expect(sent.text).toContain("만화풍 그림");
});

test("a reading nobody offered can be typed", async ({ page }) => {
  const frame = await open(page, WITH_GOAL);
  await frame.locator(".uu-goal-current").click();

  // Nothing typed yet, so there is nothing to switch to.
  await expect(frame.locator(".uu-goal-go")).toBeDisabled();

  await frame.locator(".uu-goal-own .uu-input").fill("점묘화 느낌의 그림");
  await expect(frame.locator(".uu-goal-go")).toBeEnabled();
  await frame.locator(".uu-goal-go").click();

  await expect.poll(() => page.evaluate(() => window.__harness.sent.length)).toBe(1);
  const sent = await page.evaluate(() => window.__harness.sent[0]);
  expect(sent.text).toContain("점묘화 느낌의 그림");
});

test("the current reading is not offered as something to switch to", async ({ page }) => {
  const frame = await open(page, WITH_GOAL);
  await frame.locator(".uu-goal-current").click();

  const alts = await frame.locator(".uu-goal-alt").allInnerTexts();
  expect(alts).not.toContain("사진처럼 사실적인 그림");
});

test("a superseded widget cannot switch the goal either", async ({ page }) => {
  const frame = await open(page, WITH_GOAL);

  await page.evaluate(() => {
    const bc = new BroadcastChannel("unknown-unknowns");
    bc.postMessage({ seq: Number.MAX_SAFE_INTEGER });
    bc.close();
  });

  await expect(frame.locator(".uu-goal-current")).toBeDisabled();
});

// ── presets ────────────────────────────────────────────────────────────────

/** Open with canned answers for the app-only preset tools. */
async function openWithPresets(page, responses, payload = PAYLOAD) {
  await page.addInitScript((r) => {
    window.__toolResponses = r;
  }, responses);
  return open(page, payload);
}

const TWO_PRESETS = {
  list_presets: {
    presets: [
      { id: "p1", name: "주간보고 정리", uses: 4, lastUsedAt: 200 },
      { id: "p2", name: "회의록 요약", uses: 1, lastUsedAt: 100 },
    ],
  },
};

/** What `load_preset` hands back: axes already written, values as stand-ins. */
const LOADED = {
  ...TWO_PRESETS,
  load_preset: {
    found: true,
    preset: { id: "p1", name: "주간보고 정리" },
    locale: "ko",
    unfolded: {
      title: "주간보고 정리",
      intent: "주간보고 정리해줘",
      sections: [
        {
          id: "form",
          label: "형식",
          axes: [
            {
              id: "structure",
              label: "구조",
              type: "select",
              options: [
                { value: "first", label: "결론 먼저", emit: "결론을 먼저 쓴다." },
                { value: "last", label: "결론 나중", emit: "결론을 마지막에 쓴다." },
              ],
            },
          ],
        },
      ],
    },
    selections: { structure: "first" },
  },
};

test("no preset row where there is nowhere to save", async ({ page }) => {
  // No `__toolResponses`, so `list_presets` throws — the remote Worker's case.
  const frame = await open(page);
  await expect(frame.locator(".uu-presets")).toHaveCount(0);
});

test("lists saved presets, most recently used first", async ({ page }) => {
  const frame = await openWithPresets(page, TWO_PRESETS);

  await frame.locator(".uu-preset-current").click();
  await expect(frame.locator(".uu-preset-name")).toHaveText(["주간보고 정리", "회의록 요약"]);
});

test("loading a preset replaces the axes without asking the conversation", async ({ page }) => {
  const frame = await openWithPresets(page, LOADED);

  await frame.locator(".uu-preset-current").click();
  await frame.locator(".uu-preset-name", { hasText: "주간보고 정리" }).click();

  // The new axes are on screen and the old ones are gone.
  await expect(frame.locator(".uu-label").filter({ hasText: "구조" })).toBeVisible();
  await expect(frame.locator(".uu-label").filter({ hasText: "털색" })).toHaveCount(0);

  // No model in the loop: the widget called the tool directly.
  expect(await page.evaluate(() => window.__harness.sent.length)).toBe(0);
  const calls = await page.evaluate(() => window.__harness.toolCalls.map((c) => c.name));
  expect(calls).toContain("load_preset");
});

test("a loaded value reads as decided-for-you, not as this-time choice", async ({ page }) => {
  const frame = await openWithPresets(page, LOADED);
  await frame.locator(".uu-preset-current").click();
  await frame.locator(".uu-preset-name", { hasText: "주간보고 정리" }).click();

  const chip = frame.locator(".uu-chip", { hasText: "결론 먼저" });
  await expect(chip).toHaveClass(/is-default/);
  await expect(chip).not.toHaveClass(/is-on/);

  // Touching it makes it theirs.
  await chip.click();
  await expect(chip).toHaveClass(/is-on/);
});

test("a loaded preset still reaches the prompt", async ({ page }) => {
  const frame = await openWithPresets(page, LOADED);
  await frame.locator(".uu-preset-current").click();
  await frame.locator(".uu-preset-name", { hasText: "주간보고 정리" }).click();

  await expect(prompt(frame)).toContainText("주간보고 정리해줘");
  await expect(prompt(frame)).toContainText("결론을 먼저 쓴다.");
});

test("loading leaves the source box empty — that is the only thing left to do", async ({
  page,
}) => {
  const frame = await openWithPresets(page, LOADED);
  await frame.locator(".uu-preset-current").click();
  await frame.locator(".uu-preset-name", { hasText: "주간보고 정리" }).click();

  await expect(frame.locator(".uu-textarea").last()).toHaveValue("");
});

test("saving asks for a name and nothing else, and never sends the material", async ({ page }) => {
  const frame = await openWithPresets(page, {
    ...TWO_PRESETS,
    save_preset: { saved: true, id: "new", name: "내 설정" },
  });

  // Material in the box, and a choice made.
  await frame.locator(".uu-chip", { hasText: "검정" }).click();
  await frame.locator(".uu-textarea").last().fill("예산 동결 결정");

  await resultTab(frame).click();
  await frame.locator(".uu-preset-save .uu-btn").click();
  await frame.locator(".uu-preset-save .uu-input").fill("내 설정");
  await frame.locator(".uu-preset-save .uu-btn", { hasText: "저장" }).click();

  await expect
    .poll(() =>
      page.evaluate(
        () => window.__harness.toolCalls.filter((c) => c.name === "save_preset").length,
      ),
    )
    .toBe(1);

  const call = await page.evaluate(
    () => window.__harness.toolCalls.find((c) => c.name === "save_preset").arguments,
  );
  expect(call.name).toBe("내 설정");
  expect(call.selections).toContain("black");
  // The material was never an argument to begin with.
  expect(JSON.stringify(call)).not.toContain("예산 동결");
});

test("overwrite is offered only once the state came from a preset", async ({ page }) => {
  const frame = await openWithPresets(page, LOADED);

  await resultTab(frame).click();
  await frame.locator(".uu-preset-save .uu-btn").click();
  await expect(frame.locator(".uu-preset-save .uu-btn", { hasText: "덮어쓰기" })).toHaveCount(0);

  // Load one, and now there is something to overwrite.
  await frame.locator(".uu-tab", { hasText: "목록" }).click();
  await frame.locator(".uu-preset-current").click();
  await frame.locator(".uu-preset-name", { hasText: "주간보고 정리" }).click();

  await resultTab(frame).click();
  await expect(frame.locator(".uu-preset-save .uu-btn", { hasText: "덮어쓰기" })).toBeVisible();
  await expect(frame.locator(".uu-preset-save .uu-btn", { hasText: "새로 저장" })).toBeVisible();
});
