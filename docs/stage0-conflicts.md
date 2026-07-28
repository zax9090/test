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

---

## 결정 (완료)

| # | 결정 | 상태 |
|---|---|---|
| C2 | `[복사]` + `[대화로 보내기]` 둘 다. 후자는 자동 실행을 수용하고 이름으로 밝힘 | 3단계 반영 |
| C3 | 명시된 문법대로 아이콘 8개 직접 제작 | 3단계 반영 |
| C4 | `requestId` 유지 + Durable Object | 1단계 반영, 5단계에서 사용 |
| C1·C5·C6·C7 | 조치 확정, 결정 불필요 | 반영 완료 |
