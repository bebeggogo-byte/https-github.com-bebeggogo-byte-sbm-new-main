# 강의 루프: 캘린더 → 자동녹음 → 보고서 → 슬라이드 깊이 보강 → 녹음삭제

회원님 워크플로우 그대로 자동화한 한 사이클입니다.

```
구글캘린더 일정  ──①읽기──▶ events.json
       │
       ②녹음 예약 (강의 시작시각, PC에서)
       ▼
  강의 당일: 자동 녹음 시작 → 끝나면 자동 정지
       │
       ③전사(faster-whisper)
       ▼
       ④강의보고서(HTML)  +  ⑤슬라이드 vs 발화 '깊이 차이' 분석(HTML)
       │
       ⑥녹음파일 자동 삭제 (전사·보고서 생성 확인 후, 용량 절약)
```

## 한 번 세팅 (회원님 PC)

```bash
cd automation
pip install -r requirements.txt              # + 로컬: ffmpeg, faster-whisper, (선택)tesseract
# 캘린더 OAuth 1회 (credentials.json 준비 — connectors/gcal_push.py 안내 참고)

# ① 캘린더에서 강의 일정 읽기
python connectors/gcal_pull.py --days 14 -o output/events.json

# ② 강의 시작시각에 자동 녹음 예약 (강의별로, 슬라이드 깊이분석까지 자동)
python connectors/schedule_recording.py output/events.json --apply
```

## 강의 당일 — 아무것도 안 누름
예약된 시각에 자동으로:
녹음 시작 → (강의시간) → 정지 → 전사 → 보고서 → **슬라이드 vs 발화 깊이 차이** → 녹음 삭제.

깊이 분석에 슬라이드를 물리려면 예약 명령에 `--slides` 를 더하거나, 사후 수동 실행:
```bash
python gap_analysis.py --slides 내강의슬라이드.pptx --transcript recordings/xxx.txt \
    --event output/events.json --index 0 -o output/gap_00.html
```

## 깊이 차이 보고서가 보여주는 것
- 🗣️ **말로는 깊었는데 슬라이드엔 빈약** → 슬라이드에 채울 구체 문구(다음 버전 보강)
- 📄 **슬라이드엔 있는데 거의 말 안 함** → 설명 보강 또는 슬라이드 간소화
- ✨ **즉흥적으로 나온 좋은 말** → 다음 슬라이드에 반영
- ✅ 다음 버전 개선 액션

→ 이걸로 '보여지는 슬라이드'와 '강사의 실제 깊이'를 점점 일치시켜 갑니다.

## 녹음 삭제 정책
- 기본: 전사본(.txt)과 보고서(HTML)가 **둘 다 생성 확인되면** 녹음(.m4a) 자동 삭제.
- 내용은 전사본에 남고 용량만 비웁니다. 보존하려면 `--keep-audio`.

## 정직한 경계
- 녹음·전사·tesseract OCR 은 **로컬(회원님 PC)** 에서. 클라우드 세션엔 마이크·GPU 없음.
- 캘린더 OAuth, 노트북LM 로그인은 본인 1회.
- 깊이 분석 품질은 `ANTHROPIC_API_KEY` 설정 시(Claude) 가장 좋음. 없으면 휴리스틱.
