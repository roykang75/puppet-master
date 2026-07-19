# Plan 14 — LSP 후속 3종: 참조 찾기 · Rename · 시그니처 도움말

> v2 9탄. 기존 경량 LSP 클라이언트(Plan 6/13)에 3기능을 additive로 얹는다.
> 인덱서/DB 무변경. LSP 미지원 언어는 기존 경로(RelationPanel/Smart Rename) 유지.

## 배경

현재 LSP 클라이언트는 `completion/hover/definition/diagnostic`만 지원.
`request()`는 이미 제네릭(method/params/timeout) → 신규 기능은 대부분 배선.

## 결정

- **참조 찾기(Shift+F12)**: Monaco `registerReferenceProvider` + LSP `textDocument/references`
  (`includeDeclaration: true`). 결과는 `toLocations`로 재사용. 에디터 내 네이티브 피크.
  기존 RelationPanel References 탭(인덱서 이름매칭, 커서 자동)과 **별개·공존**.
  - *한계*: 표준 Monaco 피크는 열려있지 않은 파일의 본문 미리보기를 모델 부재로 못 채울 수 있음
    (위치 목록·이동은 정상). 열린 파일/동일 파일 참조는 완전 동작.
- **시그니처 도움말**: Monaco `registerSignatureHelpProvider` + LSP `textDocument/signatureHelp`,
  트리거 `(` `,`. 신규 중립 타입 `LspSignatureHelpN`.
- **Rename(F2)**: LSP 지원 언어(TS/JS/Py)는 LSP references(includeDeclaration)로 **정밀 위치**를
  뽑아 기존 `RenameTargets` 형태(groups=전부 체크, unconfirmed=[])로 주입 → 기존 RenameOverlay
  미리보기 + applyRename(위치별 oldName→newName 치환) 파이프라인 **그대로 재사용**.
  LSP 위치가 비면 기존 인덱서 `getRenameTargets`로 폴백. 그 외 언어는 항상 인덱서 Smart Rename.
  - *한계*: 식별자 단순 치환 가정(위치 앵커=식별자 시작). 비식별자 rename 엣지(shorthand 확장 등)는
    references 위치 기반이라 미포함 — 실사용상 드묾, 폴백으로 안전.

## 태스크

1. **참조 찾기** — manager `references` kind(+includeDeclaration 컨텍스트), IPC 허용목록,
   Monaco reference provider 배선. 단위: manager/convert.
2. **시그니처 도움말** — manager `signatureHelp` kind, `toSignatureHelp` 변환 + `LspSignatureHelpN`,
   IPC, Monaco signature provider. 단위: convert.
3. **LSP Rename 주입** — 렌더러 `lspRenameTargets(path,line,col)` 헬퍼(references→RenameTargets),
   RenameOverlay가 LSP 언어면 우선 사용·실패 시 getRenameTargets 폴백. 단위: 그룹핑 헬퍼.
4. **검증** — 빌드/유닛 전량 + dev 실측(참조 피크·시그니처 팝업·TS rename), node ABI 복구.

## 불변식

- 인덱서/DB/RPC 무변경. IPC는 허용목록(`LSP_CALL_ALLOWED`) 확장만.
- LSP 미지원 언어·서버 미가동 시 기존 동작 무영향(조용한 폴백).
- convert는 electron/monaco 임포트 금지(순수).
