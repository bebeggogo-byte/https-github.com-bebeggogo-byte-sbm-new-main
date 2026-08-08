# 강의 자동화 작업 가이드 (새 세션용)

이 저장소는 **강의업무 자동화 툴킷**입니다. 새 채팅에서도 아래대로 바로 쓰세요.
모든 도구는 `automation/` 안에 있습니다.

## ⚡ 가장 많이 쓰는 작업: 노트북LM 로고 지우기

사용자가 노트북LM에서 만든 PPTX/PDF를 올리고 "로고 지워줘"라고 하면:

```bash
cd automation
pip install -r requirements.txt          # (최초 1회) opencv·pymupdf 등
python tools/erase_watermark.py <올린파일> --corner br --h 0.07 --w 0.15 -o output/clean/<이름>_clean.pptx
```
- '덮는' 게 아니라 **인페인팅으로 픽셀을 삭제·배경 복원**합니다.
- 처리 후 **반드시 전수검사**: 원본 vs 결과 픽셀 비교로 "코너 밖 변경 0장" 확인.
- 결과 파일을 사용자에게 **전달(SendUserFile)** 하고, BEFORE/AFTER 코너 비교 이미지를 함께 보여주면 좋음.
- PPTX·PDF·PNG/JPG 모두 지원. 다른 코너는 `--corner bl/tr/tl`.

## 🎬 노트북LM 슬라이드 제작 (사용자 PC에서)

노트북LM은 구글 로그인이 필요해 **클라우드 세션의 IP에서는 403 차단**됨 → 사용자 PC에서 실행:
```bash
nlm login                                  # (최초 1회) 브라우저 로그인
sh connectors/nlm_make.sh <집필.pdf> "포커스 주제"   # 생성→다운로드→로고삭제 원샷
```
클라우드 세션에서는 노트북LM을 직접 못 돌림. 대신 **소스 문서 집필**(아래)을 해줄 것.

## 📋 전체 파이프라인 (인입 → 결과보고)

```bash
cd automation
python connectors/kakao_ingest.py chat.txt -o inputs/messages.txt   # 카톡 export 인입
python workflow.py auto inputs/messages.txt   # 인입→파싱→캘린더·커리큘럼·슬라이드·워크지 (검수 게이트)
python workflow.py status      # 진행판     python workflow.py pending   # 검수 대기 목록
python workflow.py approve <id>               # 검수 통과
```

## 🧰 도구 지도

| 하고 싶은 것 | 명령 |
|---|---|
| 카톡/문자/에이닷 → 일정 추출 | `parse_schedule.py` (또는 `connectors/kakao_ingest.py`) |
| 구글캘린더 등록 | `make_ics.py`(.ics) / `connectors/gcal_push.py`(API) |
| 커리큘럼 PDF | `make_curriculum_pdf.py --content <집필.json>` |
| 슬라이드 PPTX(흰배경·좌상단·출처6pt) | `make_slides.py` |
| 워크지 | `make_worksheet.py` |
| 구글캘린더 일정 읽기 | `connectors/gcal_pull.py` → events.json |
| 강의 녹음(예약)→전사→보고서 | `connectors/record_scheduler.py`, `transcribe.py`, `lecture_report.py` |
| 슬라이드 vs 강사 발화 깊이차이 | `gap_analysis.py --slides deck.pptx --transcript t.txt` |
| 로고/워터마크 삭제 | `tools/erase_watermark.py` |
| 대상별 접근(공공기관/학생) | `audience.py` — 자동 분류, 톤·구성 차등 |
| 고객사 브랜드 테마 | `theme.py`, `themes/`, `themes/contacts.json` |

## 🎨 핵심 규칙
- **고객사 테마**: `themes/<name>.json` 색·폰트·출처라벨. 발신자 매핑은 `themes/contacts.json`.
- **대상별**: 공공기관=격식·데이터·체크리스트 / 학생=친근·활동·다짐 (`audiences.json`).
- **콘텐츠 집필**: 사용자가 강의 주제를 주면, 웹 사실확인(WebSearch) 후 `content/<주제>.json`
  으로 커리큘럼/슬라이드 본문을 직접 집필 → `--content` 로 PDF/PPT 생성.
- **출처 표기**: 슬라이드 우하단, 고객사 `source_label`, 6pt.

## 🔒 보안/주의
- `cookies.txt`·`credentials.json`·`token.json`·`nlm_in/`·`workspace/`·`output/` 는 gitignore.
- 노트북LM 쿠키는 비밀번호급 — 클라우드 세션에 두지 말고, 받으면 작업 후 삭제.
- 자세한 설계: `automation/README.md`, `automation/PLAN.md`.
