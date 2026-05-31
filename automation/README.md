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

## ⚡ 빠른 시작 (원클릭)

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

## 🎨 슬라이드 레이아웃 (요청 사양 그대로)

- 배경: **흰색**
- **제목 / 소제목 / 학습목표: 왼쪽 상단** 배치
- 본문(핵심내용): 그 아래
- **출처 "네다바웨이": 오른쪽 하단, 폰트 6pt** (작게)

NotebookLM 에서 정리한 슬라이드 개요를 아래 JSON 으로 저장하면 같은 스타일로 굳힙니다:

```json
[{"title":"제목","subtitle":"소제목","objective":"학습목표","bullets":["핵심1","핵심2"]}]
```
```bash
python make_slides.py --slides output/slides.json -o output/slides.pptx
```

## ✅ 자동 사실확인(needs_review)

파서는 불확실한 부분을 자동으로 표시합니다. 예:
- 연도 미기재 → 기본 연도(2026) 가정 후 **확인 요청**
- **요일 불일치**: 메시지 "목요일"인데 날짜 계산상 "금요일" → 날짜/연도 재확인 경고
- 장소/주소/날짜/시간 추출 실패

`events.json` 의 `needs_review` 와 파이프라인 종료 요약에 모두 출력됩니다.

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
