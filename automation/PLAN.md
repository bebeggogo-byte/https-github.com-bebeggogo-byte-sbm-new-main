# 강의업무 자동화 — 전체 계획 (인입 → 결과보고)

문자·이메일·전화·카톡이 들어온 순간부터 강의 결과보고 발송까지, 전 과정을
잘게 쪼개 하나로 연결합니다. 단계 사이에 **검수 게이트(⛳)**를 두어, 사람이
확인·승인해야 다음으로 넘어갑니다. 진행 상태는 `workflow_state.json` 에 저장되어
언제든 중단·재개할 수 있습니다.

## 14단계 파이프라인

| # | 단계 | 종류 | 도구 | 산출물 |
|---|------|------|------|--------|
| 1 | 인입(문자·이메일·전화·카톡) | auto | `connectors/{kakao_ingest,email_ingest}.py` | messages.txt |
| 2 | 일정 파싱 + 사실확인 | auto | `parse_schedule.py` | event.json (+needs_review) |
| 3 | **일정 검수** | ⛳검수 | 사람 | 날짜·시간·장소·대상 확인 |
| 4 | 구글캘린더 등록 | auto | `make_ics.py` / `connectors/gcal_push.py` | calendar.ics |
| 5 | 커리큘럼 PDF | auto | `make_curriculum_pdf.py` | curriculum.pdf |
| 6 | **커리큘럼 검수** | ⛳검수 | 사람 | 기획·전략·방향 확인 |
| 7 | 슬라이드 + 워크지 | auto | `make_slides.py`, `make_worksheet.py` | slides.pptx, worksheet.* |
| 8 | **강의자료 검수(+노트북LM)** | ⛳검수 | 사람 | `connectors/notebooklm_browser.py` |
| 9 | 강의 녹음(예약) | 수동/예약 | `connectors/record_scheduler.py` | 녹음파일 |
| 10 | 전사 | auto | `transcribe.py` | transcript.txt |
| 11 | 강의보고서(HTML) | auto | `lecture_report.py` | report.html |
| 12 | **보고서 검수** | ⛳검수 | 사람 | 핵심·이슈 확인 |
| 13 | 결과 발송 | auto | `connectors/deliver.py` | 이메일 전송 |

> 모든 산출물은 **고객사 테마**(색·폰트·출처)를 입어 통일된 브랜드 룩으로 나옵니다.

## 운영 흐름 (명령어)

```bash
# 0) 인입: 카톡 export 또는 이메일에서 강의 메시지 수집
python connectors/kakao_ingest.py KakaoTalkChats.txt -o inputs/messages.txt
#   또는  python connectors/email_ingest.py -o inputs/messages.txt

# 1) 등록(인입+파싱) → 각 강의가 '일정 검수' 대기 상태로 생성
python workflow.py init inputs/messages.txt

# 2) 진행판 확인 (●완료 ◍대기 ○예정)
python workflow.py status

# 3) 자동 진행 (검수 게이트 직전까지)
python workflow.py run

# 4) 검수 후 승인 → 다시 run  (검수 게이트마다 반복)
python workflow.py approve <강의id>      # 현재 대기 게이트 통과
python workflow.py run

# 5) 강의 당일: 자동 녹음(시작~종료) → 전사 → 보고서까지
python connectors/record_scheduler.py output/events.json --next --then-report
#   (이미 전사본이 있으면)  python workflow.py attach-transcript <id> transcript.txt
python workflow.py run

# 6) 보고서 검수 후 결과 발송
python workflow.py approve <id>
python connectors/deliver.py --to [email protected] \
    --report workspace/<id>/report.html \
    --attach workspace/<id>/slides.pptx workspace/<id>/worksheet.pdf
```

## 검수 게이트(⛳) 4곳 — 왜 사람이 보는가
1. **일정 검수**: 연도·요일 불일치, 장소/주소 누락 등 자동 경고를 사람이 최종 확정.
2. **커리큘럼 검수**: 강의 기획·전략 방향이 고객사 의도에 맞는지 확인.
3. **강의자료 검수**: 슬라이드/워크지 품질 + 노트북LM 자료서치 반영.
4. **보고서 검수**: 핵심 파악·이슈 정리가 정확한지 확인 후 발송.

## 자동 vs 사람 (정직한 경계)
- **완전 자동**: 파싱·사실확인·캘린더(.ics)·커리큘럼·슬라이드·워크지·전사·보고서.
- **사람 1회**: 검수 승인 4회, 카톡 export/이메일 앱비밀번호, 캘린더 OAuth(무클릭 원할 때), 노트북LM 로그인.
- **로컬 전용**: 녹음(마이크)·전사(faster-whisper)는 회원님 PC에서 실행.
