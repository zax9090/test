# 0단계 — 스펙 확인 및 충돌 목록

확인 일자: 2026-07-28

## 확인한 것

| 항목 | 결과 |
|---|---|
| `build-mcp-app` 스킬 | **설치 완료** → `.claude/skills/build-mcp-app` (출처 `anthropics/claude-plugins-official`, 경로 `plugins/mcp-server-dev/skills/build-mcp-app`) |
| MCP Apps 스펙 | 실재. `specification/2026-01-26/apps.mdx` (SEP-1865). 문서의 "2026년 1월 26일 표준화" 서술은 정확함 |
| `@modelcontextprotocol/ext-apps` | 실재. **v1.7.5** |
| `@modelcontextprotocol/sdk` | **v1.30.0** (ext-apps peer: `^1.29.0`) |
| 확장 식별자 | `io.modelcontextprotocol/ui` |
| 리소스 MIME | `text/html;profile=mcp-app`, URI 스킴 `ui://` |
| Claude의 MCP Apps 지원 | **지원함** (ChatGPT · VS Code · Goose · Postman 도 지원) |

근거는 설치된 스킬, npm에 게시된 `.d.ts` 타입, `modelcontextprotocol/ext-apps` 저장소 원본.

---

## 충돌 목록

### C1 — sampling: 대상 호스트가 지원하지 않는다 **(치명적 · 구조에 영향)**

문서의 전제:

> **MCP sampling** — 축 뽑기. 호스트 모델을 쓴다. **API 키 없음, 추론 비용 없음**
> (하지 말 것) 서버에서 자체 AI 모델 호출 (sampling만 사용)

확인된 사실:

- 프로토콜 차원에서 sampling은 존재한다. `McpUiHostCapabilities.sampling`이 타입에 있고,
  위젯에서 직접 부르는 `App.createSamplingMessage()`도 있다.
- 그러나 **Claude(claude.ai · Claude Desktop · Claude Code)는 MCP sampling을 구현하지 않았다.**
  2025-06 이래 열려 있는 기능 요청 상태다.
- 방증 두 가지:
  - 공식 `build-mcp-app` 스킬에 **sampling 언급이 0회**다.
  - `ext-apps` 저장소의 **예제 서버 27개 중 sampling을 쓰는 것이 하나도 없다.**
    (`grep -rn "createSamplingMessage" examples/` → 무결과)

결론 — **문서 130행의 "sampling 미지원 클라이언트 대비" 경로는 폴백이 아니라 사실상 유일한 동작 경로다.**

```
문서가 가정한 경로              실제 Claude에서 동작하는 경로
unfold → sampling → 축 → 위젯   unfold → 지시문 텍스트 반환
                                → 호스트 모델이 축 생성
                                → unfold 재호출(축 전달) → 위젯
```

**설계 자체는 무너지지 않는다.** 축을 뽑는 주체가 여전히 호스트 모델이고,
API 키도 없고 별도 추론 청구도 없다. 바뀌는 것은 *어느 경로가 기본인가* 뿐이다.
다만 `unfold`가 왕복 2회 호출된다는 점, 그리고 승인 창(검증 가설 5번)이
Claude에서는 애초에 뜨지 않는다는 점이 달라진다.

조치: 두 경로를 모두 구현하되 **폴백을 1급 경로로** 만든다.
sampling 경로는 capability가 있을 때만 타도록 남긴다 (VS Code · Goose 등 대비).

---

### C2 — `[대화에 넣기]`의 "자동 실행 금지"는 구현 불가 **(원칙 충돌)**

문서:

> `[대화에 넣기]` — 프롬프트를 대화에 삽입만 한다. **Claude가 자동 실행하지 않는다.**
> 사용자가 확인 후 직접 보낸다

스펙상 위젯이 대화에 텍스트를 넣는 수단은 `ui/message` 하나뿐이고, 그 정의는:

```ts
interface McpUiMessageRequest {
  method: "ui/message";
  params: {
    role: "user";          // "currently only user is supported"
    content: ContentBlock[];
  };
}
```

SDK 주석이 명시한다 — `sendMessage`는 대화 턴으로 전달되어 **모델이 즉시 응답한다.**
`updateModelContext` 쪽 설명이 이를 대조로 못박는다:

> "…without triggering an immediate model response (**unlike `sendMessage`**)"

즉 **입력창에 채워만 두는 primitive가 스펙에 없다.** 선택지는 셋뿐이다.

| 안 | 동작 | 대가 |
|---|---|---|
| (a) 버튼 제거 | `[복사]`만 남긴다 | 문서의 "자동 실행 금지"를 지킴. 기능 하나 상실 |
| (b) 이름을 정직하게 | `[대화로 보내기]` — 보내면 Claude가 답한다 | 기능 유지. 문서 243행 위반 |
| (c) `updateModelContext` | 조용히 컨텍스트에만 넣음 | 실행 안 됨. 그러나 화면에도 안 보여서 사용자가 인지 못 함 |

**결정 필요.**

---

### C3 — 아이콘 원본이 비어 있다 **(자료 누락)**

문서:

> 자체 SVG 스프라이트를 인라인으로 포함한다 (**별도 `icons.svg` 제공됨**)

받은 파일은 `icons.pdf`이고, 내용 스트림 전체가 이렇다:

```
q Q q 36 36 540 720 re W n /Cs1 cs 1 1 1 sc 36 692 540 64 re f Q
```

클리핑 사각형 하나와 **흰색으로 칠한 사각형 하나**가 전부다.
패스도 글리프도 폰트도 없다. `i-set` `i-unset` `i-partial` `i-copy`
`i-link` `i-more` `i-less` `i-clear` 8개 심볼 중 **어느 것도 파일에 없다.**

명시된 문법(실선=정함 / 점선=안 정함, 사각=값·항목 / 원=사람의 확인,
24 그리드 · 스트로크 2 · `currentColor` · 14px·20px)은 그 자체로 충분히 구체적이라
직접 그릴 수 있다. **원본 재전달 또는 직접 제작 승인 필요.**

---

### C4 — `requestId` 메모리 캐시가 Workers에서 신뢰할 수 없다 **(런타임 충돌)**

문서:

> `requestId`는 `preview` 호출을 위한 임시 키이며 **TTL 30분, 메모리 캐시.** DB 없음.

Cloudflare Workers의 전역 변수는 같은 isolate에 재요청이 닿을 때만 남는다.
isolate는 리소스 압박 시 임의로 축출되고, 요청이 같은 isolate·같은 colo로
간다는 보장도 없다. 즉 **30분 TTL은 지켜지지 않는다** — 몇 초 만에 사라질 수도,
남아 있을 수도 있다. Cloudflare 공식 문서가 "persistence를 보장으로 의존하지 말라"고 명시한다.

제안 — **서버 캐시를 아예 두지 않는다.** 위젯이 이미 요청문과 자료를 들고 있으므로,
`preview`가 그것을 인자로 직접 받으면 된다:

```ts
preview(axisId, request, source?, axisContext?)   // requestId 불필요
```

이쪽이 **P1("보내되 보관하지 않는다")을 더 엄격하게 지킨다.** 서버에 30분간
사용자 자료가 상주하지 않기 때문이다. 문서에 적힌 도구 시그니처가 바뀌므로 확인 필요.

---

### C5 — `[복사]`와 샌드박스 클립보드 **(경미 · 조치 있음)**

`navigator.clipboard.writeText`는 Permission Policy `clipboard-write`가 있어야 한다.
스펙에 `_meta.ui.permissions.clipboardWrite`가 있지만, **`build-mcp-app` 스킬은
클립보드를 한 번도 다루지 않아** Claude가 실제로 허용하는지 확인되지 않았다.

조치: `permissions.clipboardWrite` 선언 → 기능 감지 →
실패 시 숨은 textarea + `execCommand('copy')` → 그것도 실패하면 텍스트 전체 선택.
**에러 배너는 띄우지 않는다**(P5·"하지 말 것" 준수). 결정 불필요.

---

### C6 — SDK 버전 갈래 **(주의)**

npm에 `@modelcontextprotocol/core` · `client` · `server` · `node`가 **2.0.0**으로 올라와 있다.
그러나 `ext-apps@1.7.5`의 peerDependency는 여전히 `@modelcontextprotocol/sdk@^1.29.0`이다.
→ **`@modelcontextprotocol/sdk@1.30.x`를 쓴다.** 2.0 갈래로 가면 ext-apps와 물리지 않는다.

참고: 2026-07-28자 MCP 스펙 릴리스 후보가 오늘 공개됐다. apps 확장은 `2026-01-26`에 고정.

---

### C11 — 목표: 대안이 없으면 프롬프트에 보이지 않는 문장이 남는다

스펙의 두 문장이 충돌한다.

> `alternatives: string[];  // 2~3개. 없으면 목표 칸을 숨긴다`

> 목표는 **프롬프트에 포함된다.** 축과 달리 이건 지시의 일부다.

그리고 §7:

> 사용자에게 알리지 않는 문장을 프롬프트에 덧붙이기 (백그라운드 래핑 금지)

`alternatives`가 비면 목표 칸이 숨는다. 그런데 `selected`는 여전히 프롬프트에
들어간다. 결과는 **사용자가 화면에서 본 적도 없고 바꿀 수도 없는 문장이 지시에
섞이는 것** — §7이 금지한 바로 그 상태다. 칸을 숨기라는 지시와 프롬프트에 넣으라는
지시를 동시에 지킬 수 없다.

**조치**: `alternatives`가 비면 `goal`을 통째로 버린다. 칸도 없고 프롬프트 줄도 없다.

근거는 스펙 자신의 논리다. 칸을 숨기는 조건으로 스펙이 든 것은
"요청이 이미 구체적이면"인데, 그 경우엔 프롬프트에 덧붙일 것도 없다 — 요청이 이미
그 말을 하고 있다. 그래서 모델이 `goal`을 생략한 경우와 대안 없이 보낸 경우가 같은
결과로 수렴한다. 바꿔 말하면 **바꿀 수 없는 목표는 목표가 아니라 숨은 지시다.**

`parseGoal`에서 처리하고 테스트로 고정했다
(`drops a goal with no alternatives rather than showing a line nobody can change`).

### C12 — 프리셋: `intent`를 저장하지 않으면 프리셋만으로 프롬프트가 서지 않는다

스펙은 저장 대상을 이렇게 못박는다.

> `payload TEXT NOT NULL,  -- goal + sections + values JSON. 자료 미포함`
> **자료 본문을 담는 컬럼은 만들지 않는다.** 만들면 언젠가 채워진다.

그런데 `assemble`의 첫 블록은 `unfolded.intent`다. 프리셋 payload에 `intent`가
없으면 불러온 프리셋은 **첫 줄이 빈 프롬프트**가 된다. 반대로 `intent`를 넣으면
그것은 **사용자 요청 본문**이고, P1("보내되 보관하지 않는다")을 정면으로 깬다.
자료만 빼면 되는 문제가 아니다 — 요청 자체가 저장 대상이 되어버린다.

스펙의 화면 예시도 이 지점을 비워 두었다. `자료` 칸만 비어 있다고 했는데, 그러면
`intent`는 어디서 오는가가 정해지지 않았다.

**결정 필요** (구현 전 사용자 확인 대상):

| 안 | 방식 | 대가 |
|---|---|---|
| A | `load_preset(id, request)` — 이번 요청을 인자로 받는다 | 시그니처가 스펙과 다르다. P1 유지 |
| B | `intent`를 payload에 저장 | 스펙 그대로. **P1 위반을 명시적으로 감수** |

A를 권한다. 반복 작업에서 바뀌는 것이 자료뿐이라는 스펙의 전제가 맞다면,
요청 문장도 매번 사용자가 들고 오는 쪽이 자연스럽다. 저장할 이유가 없다.

**미결 상태로 남긴다.** §2~§6(프리셋·D1·OAuth)은 이 결정 없이 착수하지 않았다.


## 충돌 아닌 것 (확인 결과 문서가 맞거나, 스펙이 더 잘 지원함)

- **`preview` 자동 호출 금지** → `_meta.ui.visibility: ["app"]`가 정확히 이것이다.
  모델의 도구 목록에서 숨기고 위젯만 부를 수 있게 한다. 스펙이 문서 의도를 그대로 지원한다.
- **호스트 스타일 상속** → `hostContext.theme` + 호스트 CSS 변수 + `onhostcontextchanged`.
  자체 색·폰트 없이 다크/라이트 대응 가능. 문서 의도대로 됨.
- **좁은 폭에서 지도 미렌더링** → `hostContext.containerDimensions.width`로 판정 가능.
- **P3(뜬 순간 이미 프롬프트가 있다)** → 두 경로 모두 축이 확정된 뒤에 위젯이 뜨므로 성립.
  로딩 스피너 금지와도 모순 없다.

## 구현상 제약 (충돌은 아니나 설계에 반영해야 함)

- 위젯 HTML은 **단일 파일로 인라인 번들**되어야 한다. iframe CSP가 esm.sh 등
  외부 스크립트를 막아서, `ext-apps/app-with-deps`(~300KB)를 빌드 시점에
  `/*__EXT_APPS_BUNDLE__*/` 자리에 치환해 넣어야 한다. 안 하면 **빈 사각형이 뜨고
  에러는 iframe 자체 devtools에만 찍힌다.**
- 외부 이미지·폰트 로드 불가. `window.open`·`<a target="_blank">` 불가 → `app.openLink`.
- 치환은 `String.replace`의 문자열 형태가 아니라 `() => bundle` 함수 형태로 해야 한다
  (압축 번들에 `$` 시퀀스가 많아 문자열 치환이 깨진다).

---

### C7 — 두 번 호출하는 폴백은 빈 위젯을 남긴다 **(3단계에서 발견)**

문서 130행은 sampling이 없을 때 이렇게 하라고 한다.

> 위 지시문을 **도구 결과 텍스트로 반환해** 호스트 모델이 직접 축을 만들고
> **`unfold`를 다시 부르게 한다.** 이 경로에서도 위젯은 떠야 한다.

그런데 스펙은 이렇게 정한다.

> If `ui.resourceUri` is present and host supports MCP Apps,
> **host renders tool results using the specified UI resource**

즉 `_meta.ui.resourceUri`를 단 도구는 **호출될 때마다 예외 없이 위젯을 띄운다.**
게다가 공식 스킬이 못박는다 — "the next call to the same tool **mounts another
iframe alongside it**". 인스턴스는 재사용되지 않는다.

따라서 두 번 호출 설계의 실제 결과는:

```
1번째 호출 (지시문 반환)  → 내용 없는 빈 위젯이 뜬다
2번째 호출 (축 전달)      → 진짜 위젯이 그 아래 또 뜬다
```

**해결 — 호출을 한 번으로 만든다.** 클라이언트 capability에 따라 도구 모양을 바꾼다.

| 클라이언트 | `unfold` 모양 | 축을 뽑는 주체 |
|---|---|---|
| sampling 있음 | `unfold(request, source?)` | 서버가 sampling으로 |
| sampling 없음 | `unfold(request, source?, unfolded)` | 호스트 모델이 도구 인자로 |

축 뽑기 지시문은 후자의 **도구 설명(description)에** 실린다. 어느 쪽이든 호출은
정확히 한 번이고, 빈 위젯은 생기지 않는다.

구현상 한 가지 제약이 더 있었다. capability는 `initialize` 이후에만 알 수 있는데,
**도구를 그때 처음 등록하면 실패한다** — 첫 `registerTool`이 `registerCapabilities`를
호출하고, 이건 transport 연결 후에 부르면 throw한다. 그래서 넓은 쪽 모양으로 먼저
등록해두고 `oninitialized`에서 `tool.update()`로 좁힌다. 부수 효과로, 좁히기가 실행되지
않아도 기본값이 Claude에 맞는 모양이라 안전하다.

### C8 — `preview`도 모델이 필요하다 **(5단계에서 발견 · C1의 파생)**

`preview`는 자료를 근거로 문장을 새로 써야 하므로 모델이 필요하다. 그런데:

- sampling은 Claude에 없다 (C1)
- 서버가 자체 모델을 부르는 것은 **문서가 금지**한다 ("하지 말 것: 서버에서 자체 AI 모델 호출")
- `callServerTool`은 위젯 → 서버 직통이라 **호스트 모델을 거치지 않는다**

즉 Claude에서 **버튼 누를 때 새로 생성하는 것은 제약 안에서 불가능하다.**

**해결 — 두 층으로 나눈다.**

| 호스트 | 카드에 들어가는 문장 |
|---|---|
| sampling 있음 | 버튼을 누르면 **그 자리에서 새로 생성**. 현재 자료 칸 내용을 기준으로 |
| sampling 없음 (Claude) | 축을 뽑을 때 모델이 **함께 써준 것**. 버튼은 뜨지만 갱신은 조용히 실패 |

이를 위해 `Option`에 `preview?: string`를 추가하고, 축 뽑기 지시문에
"`sample` 축의 각 방향에는 자료 기반 2~3줄을 함께 써라"를 넣었다.
Claude에서도 **카드는 처음부터 채워져 있다** — 다만 다시 쓰지 못할 뿐이다.
sampling 호스트에서는 자료를 나중에 붙여넣어도 그걸 반영해 다시 쓴다.

부수 효과로 P3("위젯이 뜬 순간 이미 복사 가능한 프롬프트가 있다")가 sample 축에도
적용된다 — 버튼을 누르기 전에도 읽을 것이 있다.

### C9 — `callServerTool`은 위젯을 새로 띄우지 않는다 **(C7의 예외 · 활용점)**

C7에서 "`_meta.ui.resourceUri`를 단 도구는 호출될 때마다 위젯을 띄운다"를 확인했다.
그런데 스펙을 다시 보면 **`resourceUri`는 선택 필드**이고, `callServerTool`로 부른
도구의 결과는 **대화가 아니라 부른 위젯에게** 돌아간다.

따라서 `visibility: ["app"]` + `resourceUri` 없음 조합이면:

- 모델의 도구 목록에 안 뜨고
- 대화에 턴을 만들지 않고
- **새 iframe도 안 뜬다**

즉 **위젯이 자기 내용을 제자리에서 갱신**할 수 있다. `preview`와 `refold`가 이 위에 선다.
(`preview`에 걸어뒀던 불필요한 `resourceUri`도 제거했다.)

이 덕분에 "자료 칸을 나중에 채우면 축이 다시 안 뽑힌다" 문제가 **C7과 충돌하지 않고**
풀린다 — `unfold`를 다시 부르면 위젯이 하나 더 생기지만, `refold`는 안 그런다.

다만 축을 다시 뽑으려면 모델이 필요하므로 **C8의 벽은 그대로다.**
sampling 없는 호스트에서는 `refold`가 아무것도 하지 않고, 위젯은 버튼을 감춘다.

| 호스트 | 자료 칸의 역할 |
|---|---|
| sampling 있음 | 프롬프트 + 미리보기 + **축 재추출** |
| sampling 없음 (Claude) | 프롬프트 + (축 뽑을 때 함께 받은) 미리보기 |

### C10 — sampling을 포기하고 구조를 뒤집다

C1·C8이 계속 파생 문제를 낳아서, sampling을 **설계의 중심에서 뺐다.**
빼고 나면 한 문장으로 정리된다.

> **모델은 호출자로만 닿는다. 피호출자로는 닿지 않는다.**

서버는 모델에게 아무것도 물어볼 수 없다. 모델의 출력이 오는 유일한 경로는
**모델이 우리 도구를 부를 때**다. 그 출력이 *위젯*에 닿는 경로는 둘뿐이다 —
그 위젯을 만든 호출의 결과이거나, 위젯이 나중에 폴링해서 집어오거나.
(`tools/list_changed` 류 알림이 위젯까지 가긴 하지만 **payload가 없다.**)

그래서 이렇게 바꿨다.

| | 전 | 후 |
|---|---|---|
| 축 뽑기 | sampling 또는 도구 인자 | 그대로 (양쪽 다 유지) |
| 미리보기 | `preview` 도구가 다시 씀 | **축과 함께 옴. 다시 쓰지 않음** |
| 축 재추출 | `refold` 도구가 제자리에서 | **대화에 다시 물어봄 → 새 위젯** |

`preview.ts`, `refold.ts`, `store.ts`가 사라졌다. `RequestStore` DO와 그 바인딩,
`requestId`, `canSample`도 함께 사라졌다.

**미리보기 갱신이 재추출에 흡수된다**는 게 열쇠였다. 샘플을 다시 써야 할 때는
자료가 바뀐 때뿐이고, 자료가 바뀌면 어차피 재추출이며, 재추출이 미리보기를
함께 만든다. 독립된 갱신 경로가 애초에 필요 없었다.

**부수 효과 — C4가 사라졌다.** `preview`가 없으니 `requestId`를 붙들 이유가 없고,
Durable Object 저장소도 통째로 필요 없다. 사용자 자료가 30분간 서버에 상주하던
것이 없어져서 **P1("보내되 보관하지 않는다")이 문자 그대로 참이 되었다.**
서버는 이제 아무것도 적어두지 않는다.

재추출은 `updateModelContext`(자료를 조용히 넘김) + `ui/message`(한 문장으로 요청)
조합을 쓴다. 스킬이 문서화한 "긴 자료는 컨텍스트로, 트리거는 짧게" 패턴 그대로다.
돌아오는 것은 자료에 맞춘 새 위젯이고, 이전 위젯은 supersession으로 물러난다.

**대가**: 재추출하면 고른 값이 사라진다. 새 위젯은 빈 상태로 시작한다.
제자리 갱신이었다면 살아남았을 선택까지 잃는다 — 이건 안 A(`deliver` + 폴링)를
택했다면 지킬 수 있었지만, 그 경로는 모델이 처음 보는 도구를 규약대로 불러주기를
기대해야 하고 실패가 조용하다. **신뢰도를 택했다.**

---

## 결정 (완료)

| # | 결정 | 상태 |
|---|---|---|
| C2 | `[복사]` + `[대화로 보내기]` 둘 다. 후자는 자동 실행을 수용하고 이름으로 밝힘 | 3단계 반영 |
| C3 | 명시된 문법대로 아이콘 8개 직접 제작 | 3단계 반영 |
| C4 | `requestId` 유지 + Durable Object | 1단계 반영, 5단계에서 사용 |
| C1·C5·C6·C7 | 조치 확정, 결정 불필요 | 반영 완료 |
