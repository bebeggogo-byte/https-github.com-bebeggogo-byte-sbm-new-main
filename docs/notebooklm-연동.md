# NotebookLM 연동 가이드 — 강의 스튜디오와 함께 쓰기

강의 스튜디오(`/studio/`)와 구글 NotebookLM을 잇는 방법. NotebookLM은 공식 공개 API가 없지만,
활발히 유지되는 오픈소스 도구 **[notebooklm-py](https://github.com/teng-lin/notebooklm-py)** (⭐18k+, MIT)로
**소스 업로드 → 슬라이드 생성 → PPTX 다운로드**를 자동화할 수 있고, 클로드에 MCP/스킬로 붙일 수 있습니다.

> ⚠️ 비공식 도구입니다(구글 미제휴). 개인 구글 계정으로 로그인하며, 구글 정책 변경 시 동작이 바뀔 수 있습니다.
> 원본 자료는 항상 강의 스튜디오(및 JSON 백업)에 보관하세요 — NotebookLM은 가공 도구로만 씁니다.

## 1. 설치 (노트북에서 1회)

```bash
# 파이썬이 있다면
pip install "notebooklm-py[browser]"
# 또는 uv 사용 시
uv tool install "notebooklm-py[browser]"

# 구글 로그인 (브라우저 창이 열림 — 로그인하면 자동 저장)
notebooklm login --browser chrome

# (선택) 출력 언어 한국어
notebooklm language set ko
```

## 2. 클로드에 연결 — 두 가지 중 하나

```bash
# A. MCP 서버로 등록 (클로드 데스크톱 / 클로드 코드)
notebooklm mcp install claude-desktop
notebooklm mcp install claude-code

# B. 클로드 코드 스킬로 설치
notebooklm skill install
```

이후 클로드에게 자연어로 시키면 됩니다:
> "바탕화면의 `로마서8장-설계.md`를 NotebookLM 새 노트북에 올리고, 발표자 노트 포함 한국어 슬라이드덱을 만들어 pptx로 받아줘."

## 3. 강의 스튜디오와의 순환 루프

```
[스튜디오] 설계/강의원본 → 📄 .md 내보내기
    ↓
[NotebookLM] 소스 업로드 → 슬라이드 생성 → .pptx 다운로드
    ↓
[스튜디오] 설계 탭 → 📂 .pptx 가져오기 → 클로드 심화 설계(통찰·활동·인용구)
    ↓
강의 → 녹음 → 교정 → 원자화(오디오 자동정리) → 아톰 축적 → 조립
```

CLI로 직접 할 때:

```bash
notebooklm create "로마서 8장 강의"
notebooklm source add ./로마서8장-설계.md
notebooklm generate slide-deck "발표자 노트 포함, 한국어, 강의용" --format presenter
notebooklm download slide-deck ./로마서8장.pptx
```

`generate` 는 슬라이드 외에도 `audio`(팟캐스트) `video` `mind-map` `quiz` `flashcards`
`infographic` `report` 를 지원합니다 — 강의 복습 자료 제작에 유용합니다.

## 4. 어떤 걸 NotebookLM에, 어떤 걸 스튜디오에?

| 작업 | 도구 |
|---|---|
| 자료 여러 개를 읽고 요약·브리핑 | NotebookLM (여러 소스 종합에 강함) |
| 슬라이드 시안 자동 생성 | NotebookLM `generate slide-deck` 또는 스튜디오 🖼 .pptx |
| 유도 방향 읽기·심화 통찰·활동·책 인용 설계 | 스튜디오 설계 탭 (클로드) |
| 녹음·교정·원자화·아톰 축적·주제 조합 | 스튜디오 (원본 소유권이 내게 있음) |

## 참고한 대안들

- [m4yk3ldev/notebooklm-mcp](https://github.com/m4yk3ldev/notebooklm-mcp) — npx 한 줄 설치형 MCP(32개 도구), Node 선호 시
- [alfredang/notebooklm-mcp](https://github.com/alfredang/notebooklm-mcp) — 파이썬 uv 기반 MCP
- notebooklm-py를 권장하는 이유: 커뮤니티 규모(⭐18k)·커밋 활동량이 압도적이고, CLI·MCP·클로드 스킬을 모두 내장하며, 슬라이드 PPTX 다운로드까지 명령 한 줄로 됩니다.
