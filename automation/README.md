# 네다바웨이 강의 자동화 파이프라인

카톡·문자·에이닷(A.dot) 메시지에서 **강의 일정**을 뽑아
👉 **구글 캘린더 일정(.ics)** + **커리큘럼 PDF** + **강의 슬라이드(PPTX)** + **워크지(PPTX/PDF)** 를
한 번에 생성하는 도구 모음입니다.

```
메시지(카톡/문자/에이닷)  ──①파싱──▶  events.json
                                          ├─②──▶ lectures.ics      (구글 캘린더 가져오기)
                                          ├─③──▶ curriculum_*.pdf  (NotebookLM 소스)
                                          ├─④──▶ slides_*.pptx     (흰배경/좌상단/출처 6pt)
                                          └─⑤──▶ worksheet_*.pptx/.pdf (워크지)
```

## 🧭 전체 워크플로우 (인입 → 결과보고, 검수 게이트 포함)

문자·이메일·전화·카톡 인입부터 결과 발송까지 14단계를 하나로 연결하고,
단계 사이 4곳에 **검수 게이트**를 둡니다. 전체 설계·운영법은 **[PLAN.md](PLAN.md)** 참고.

```bash
python connectors/kakao_ingest.py chat.txt -o inputs/messages.txt  # 인입
python workflow.py auto inputs/messages.txt   # ⭐ 오토파일럿(인입→파싱→자료까지 한 방)
#   확정 일정은 끝까지 자동, 불확실한 건(상대날짜·추출실패 등)만 검수에서 멈춤
python workflow.py init inputs/messages.txt   # (수동) 등록만
python workflow.py status                     # 진행판 (●완료 ◍대기 ○예정)
python workflow.py run                         # 검수 게이트 직전까지 자동 진행
python workflow.py approve <강의id>            # 검수 통과 → 다시 run
python workflow.py pending                     # 📌 나를 기다리는 일만 모아보기(검수·녹음)
python workflow.py attach-transcript <id> transcript.txt   # 녹음 후 전사본 연결
python connectors/schedule_recording.py workflow_state.json -o register.sh  # 녹음 예약 등록
```
- **무인 운영**: `.github/workflows/daily-autopilot.yml` 가 매일 인입→자료 생성까지 자동 실행(검수 필요 건은 대기).
- **녹음 예약**: `schedule_recording.py` 가 강의 시작 시각에 자동 녹음되도록 OS 예약(at/schtasks)을 등록.
각 강의는 `workspace/<id>/` 에 calendar.ics·curriculum.pdf·slides.pptx·worksheet·report.html 로 쌓입니다.

## ⚡ 빠른 시작 (원클릭, 단일 강의 일괄)

```bash
cd automation
pip install -r requirements.txt

# 1) inputs/messages.txt 에 카톡/문자/에이닷 내용을 붙여넣기
#    (없으면 아래는 동봉된 sample 로 동작)

# 2) 전체 자동 실행
python pipeline.py inputs/sample_messages.txt
#   → output/ 에 모든 산출물 생성

# (선택) Claude 정밀 모드: 사실확인·맞춤 커리큘럼
export ANTHROPIC_API_KEY=sk-...
python pipeline.py inputs/messages.txt --ai
```

## 🧩 단계별 실행

| 단계 | 스크립트 | 입력 → 출력 |
|---|---|---|
| ① 일정 파싱 | `parse_schedule.py` | 메시지.txt → `events.json` (제목/날짜/시간/장소/주소/대상) |
| ② 캘린더 | `make_ics.py` | events.json → `lectures.ics` |
| ③ 커리큘럼 | `make_curriculum_pdf.py` | events.json → `curriculum.pdf` (기획·전략·자료·통찰·통합) |
| ④ 슬라이드 | `make_slides.py` | → `slides.pptx` |
| ⑤ 워크지 | `make_worksheet.py` | → `worksheet.pptx` + `.pdf` |

```bash
python parse_schedule.py inputs/messages.txt -o output/events.json
python make_ics.py output/events.json -o output/lectures.ics
python make_curriculum_pdf.py output/events.json --index 0 -o output/curriculum_00.pdf
python make_slides.py --from-events output/events.json --index 0 -o output/slides_00.pptx
python make_worksheet.py --from-events output/events.json --index 0 \
       -o output/worksheet_00.pptx --pdf output/worksheet_00.pdf
```

## 🎨 슬라이드 레이아웃 (고정 사양)

- 배경: **흰색**
- **제목 / 소제목 / 학습목표: 왼쪽 상단** 배치
- 본문(핵심내용): 그 아래
- **출처: 오른쪽 하단, 폰트 6pt** (텍스트는 고객사 테마의 `source_label`)

레이아웃 구조는 고정이고, **색·폰트·출처 문구는 고객사 테마**에서 옵니다(아래).

NotebookLM 에서 정리한 슬라이드 개요를 아래 JSON 으로 저장하면 같은 스타일로 굳힙니다:

```json
[{"title":"제목","subtitle":"소제목","objective":"학습목표","bullets":["핵심1","핵심2"]}]
```
```bash
python make_slides.py --slides output/slides.json -o output/slides.pptx
```

## 🏷️ 고객사 테마 시스템 (어떤 고객사가 와도 자동 분류)

레이아웃은 고정하되 **브랜드 아이덴티티(색·폰트·출처 문구)는 고객사별 토큰**으로 분리했습니다.
Claude 디자인 철학처럼 — 흰 배경 + 절제된 1 액센트 + 넉넉한 여백이 기본값입니다.

```
themes/
├── default.json        # 미분류 시 기본 (Claude-style, 코랄 액센트)
├── nedabah.json        # 네다바웨이
└── _example_client.json # 새 고객사 추가 템플릿
```

각 테마(JSON) 구조:
```json
{
  "name": "acme",
  "display_name": "ACME 그룹",
  "source_label": "ACME Inc.",        // 슬라이드 우하단 6pt 문구
  "match": ["acme", "에이크미", "담당자명"],  // 자동 분류용 키워드
  "palette": { "bg":"FFFFFF","ink":"1A1A1A","heading":"...","accent":"...","muted":"...","line":"..." },
  "fonts":   { "heading":"Pretendard", "body":"Pretendard" },
  "layout":  { "title_pt":30,"subtitle_pt":16,"objective_pt":12,"body_pt":16,"source_pt":6 }
}
```

**자동 분류**: 일정/메시지 텍스트와 각 테마의 `match` 키워드 점수로 고객사를 판정합니다.
명시적으로 지정하려면 `--theme <name>`, 일정 JSON에 `"client":"acme"` 를 넣어도 됩니다.

```bash
python theme.py list                          # 등록된 고객사 목록
python theme.py classify output/events.json   # 각 일정이 어느 고객사로 분류되는지
python theme.py new acme "에이크미,acme,ACME"  # 새 고객사 테마 생성(이후 색/폰트만 수정)

# 산출물 생성 시 테마 적용(미지정=자동분류)
python pipeline.py inputs/messages.txt --theme acme
python make_slides.py --from-events output/events.json --index 0 --theme acme -o out.pptx
```

> 새 고객사가 오면: `theme.py new` 로 토큰 생성 → 브랜드 색/폰트/로고문구만 채우면
> 슬라이드·워크지·커리큘럼이 모두 그 고객사 룩으로 자동 출력됩니다.

**발신자 자동 매핑** (`themes/contacts.json`): 내용에 고객 키워드가 없어도
'누가 보냈는지'(이름·전화·이메일·기관명)로 고객 테마를 자동 결정합니다.
예: `"nedabah": ["한빛교회","이집사","박간사", ...]` → 그 발신자의 메시지는 자동으로 nedabah 룩.

## ✅ 자동 사실확인(needs_review)

파서는 불확실한 부분을 자동으로 표시합니다. 예:
- 연도 미기재 → 기본 연도(2026) 가정 후 **확인 요청**
- **요일 불일치**: 메시지 "목요일"인데 날짜 계산상 "금요일" → 날짜/연도 재확인 경고
- 장소/주소/날짜/시간 추출 실패

`events.json` 의 `needs_review` 와 파이프라인 종료 요약에 모두 출력됩니다.

## 🔗 커넥터 — 막히던 3곳 자동화 (`connectors/`)

원래 막히던 3곳을 각각 가장 안정적·합법적인 방식으로 자동화했습니다.

### ① 구글 캘린더 무클릭 등록 — `gcal_push.py` (공식 API, 권장)
```bash
# 최초 1회: Google Cloud Console 에서 Calendar API 사용 설정 + OAuth 데스크톱
#           클라이언트 credentials.json 다운로드 → automation/ 에 두기
pip install google-api-python-client google-auth-oauthlib google-auth-httplib2
python connectors/gcal_push.py output/events.json --dry-run   # 미리보기
python connectors/gcal_push.py output/events.json             # 실제 등록(.ics 불필요)
```

### ② 카톡/문자/에이닷 수집 — `kakao_ingest.py` (공식 export, 권장)
브라우저 스크래핑 대신 **카톡 '대화 내용 내보내기(.txt)'** 를 정규화합니다(안정·합법).
```bash
python connectors/kakao_ingest.py KakaoTalkChats.txt -o inputs/messages.txt
python connectors/kakao_ingest.py screenshot.png --ocr -o inputs/messages.txt  # 스크린샷 OCR
python pipeline.py inputs/messages.txt
```
> 자동으로 강의 관련 메시지만 골라내고, 발신자/형식(PC·모바일)을 파싱합니다.
> 메시지 '전송일'은 강의일로 쓰지 않습니다(본문의 'N월 N일'에서 추출).

### ③ NotebookLM 브라우저 자동화 — `notebooklm_browser.py` (⚠️ best-effort)
공개 API가 없어 Playwright로 화면을 조작합니다. **로그인은 1회 사람이**, UI 변경 시 셀렉터가 깨질 수 있습니다.
```bash
pip install playwright && playwright install chromium
python connectors/notebooklm_browser.py login                       # 1회 로그인(세션 저장)
python connectors/notebooklm_browser.py upload output/curriculum_00.pdf
python connectors/notebooklm_browser.py ask "핵심만 골라 슬라이드 개요로 정리해줘"
```
> 본인 계정·본인 자료 대상의 개인 자동화 용도입니다. 약관 저촉 소지가 있으니 본인 책임 하에 사용하세요.

## 🎙️ 강의 자동 녹음 → 전사 → 강의보고서(HTML)

강의 시작 시각에 자동 녹음 → 강의 시간만큼 녹음 → 종료 시 자동 정지·저장 →
전사 → **강의보고서 HTML**(핵심요약·주요내용·통찰·이슈·Q&A·액션)까지 한 번에.

```bash
# 0) 시스템에 ffmpeg 설치 (brew/apt/choco install ffmpeg), pip install faster-whisper

# 1) 예정 강의 확인
python connectors/record_scheduler.py output/events.json --list

# 2) 다음 강의 시작까지 대기 → 자동 녹음 → 전사 → 보고서까지
python connectors/record_scheduler.py output/events.json --next --then-report

# (개별 단계)
python transcribe.py recordings/2026-06-12_강의.m4a -o recordings/2026-06-12_강의.txt
python lecture_report.py recordings/2026-06-12_강의.txt \
       --event output/events.json --index 0 -o output/report_00.html
```

- 보고서는 **고객사 테마**(색·폰트·출처)를 그대로 입어 슬라이드/워크지와 통일된 룩입니다.
- `ANTHROPIC_API_KEY` 설정 시 Claude 가 전사본을 읽어 요약·통찰·이슈를 도출하고,
  없으면 휴리스틱으로 사용 가능한 보고서 골격을 만듭니다.
- 마이크 입력은 OS별로 자동 추정(`--input` 으로 덮어쓰기). 첫 실행 시 OS 마이크 권한 허용 필요.

## 🔌 MCP 자동화 / 수동 단계 (정직한 안내)

`.mcp.json.example` 을 `.mcp.json` 으로 복사하고 자격증명을 채우면 Claude Code 가 MCP 서버를 띄웁니다.

| 단계 | 자동화 가능? | 방법 |
|---|---|---|
| 카톡/문자/에이닷 읽기 | ❌ 공개 API 없음 | 내용을 `inputs/` 텍스트로 붙여넣기 |
| 일정 파싱·사실확인 | ✅ | 본 도구(규칙기반 / `--ai`) |
| 구글 캘린더 등록 | ⚠️ 반자동 | `.ics` 가져오기(즉시) **또는** Google Calendar MCP(OAuth)로 자동 등록 |
| 커리큘럼/슬라이드/워크지 생성 | ✅ | 본 도구 |
| NotebookLM 자료서치·슬라이드화 | ❌ 공개 API 없음 | `curriculum_*.pdf` 수동 업로드 → 개요 작성 → `make_slides.py` 로 PPT화 |

> 카카오톡·에이닷·NotebookLM 은 외부 자동화용 공개 API를 제공하지 않습니다.
> 그래서 이 파이프라인은 **사람이 내용을 넣고 / 결과를 받는 접점만 남기고**,
> 그 사이의 모든 가공(파싱→일정→PDF→PPT→워크지)을 자동화합니다.

## 🤖 GitHub Actions 로 무인 실행

`.github/workflows/lecture-pipeline.yml` — `automation/inputs/messages.txt` 를 푸시하거나
Actions 탭에서 수동 실행하면 모든 산출물을 만들어 **아티팩트로 업로드**합니다.

## 🔒 개인정보

`inputs/`(샘플 제외)와 `output/`, `.mcp.json`, `credentials.json` 은 `.gitignore` 로
저장소에 커밋되지 않습니다. 실제 강의 내용·연락처는 로컬에만 남습니다.
