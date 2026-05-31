"""
강의 자동화 파이프라인 (원클릭 오케스트레이터)
================================================
메시지 텍스트 한 개로 아래를 한 번에 생성합니다:

  inputs/messages.txt
        │  ① parse_schedule  → output/events.json
        ▼
  각 강의마다:
        ② make_ics            → output/lectures.ics   (구글 캘린더 가져오기)
        ③ make_curriculum_pdf → output/curriculum_N.pdf (NotebookLM 소스)
        ④ make_slides         → output/slides_N.pptx  (흰배경/좌상단/출처6pt)
        ⑤ make_worksheet      → output/worksheet_N.pptx + .pdf

사용법:
    python pipeline.py inputs/sample_messages.txt
    python pipeline.py inputs/sample_messages.txt --ai   # Claude 정밀모드
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "output")


def run(mod_args: list[str]) -> None:
    cmd = [sys.executable, os.path.join(HERE, mod_args[0])] + mod_args[1:]
    print(f"\n$ {' '.join(os.path.basename(c) for c in cmd[1:])}")
    subprocess.run(cmd, check=True)


def main() -> None:
    ap = argparse.ArgumentParser(description="강의 자동화 전체 파이프라인")
    ap.add_argument("input", help="카톡/문자/에이닷 메시지 텍스트 파일")
    ap.add_argument("--ai", action="store_true", help="Claude 정밀 모드 (ANTHROPIC_API_KEY)")
    args = ap.parse_args()

    os.makedirs(OUT, exist_ok=True)
    events_json = os.path.join(OUT, "events.json")
    ai = ["--ai"] if args.ai else []

    # ① 파싱
    run(["parse_schedule.py", args.input, "-o", events_json] + ai)
    events = json.load(open(events_json, encoding="utf-8"))
    if not events:
        print("\n⚠️  추출된 강의 일정이 없습니다. inputs 텍스트를 확인하세요.")
        return

    # ② 캘린더(.ics) — 전체 일정 한 파일
    run(["make_ics.py", events_json, "-o", os.path.join(OUT, "lectures.ics")])

    # ③④⑤ 강의별 산출물
    for i, e in enumerate(events):
        tag = f"{i:02d}"
        run(["make_curriculum_pdf.py", events_json, "--index", str(i),
             "-o", os.path.join(OUT, f"curriculum_{tag}.pdf")] + ai)
        run(["make_slides.py", "--from-events", events_json, "--index", str(i),
             "-o", os.path.join(OUT, f"slides_{tag}.pptx")])
        run(["make_worksheet.py", "--from-events", events_json, "--index", str(i),
             "-o", os.path.join(OUT, f"worksheet_{tag}.pptx"),
             "--pdf", os.path.join(OUT, f"worksheet_{tag}.pdf")])

    review = [e for e in events if e.get("needs_review")]
    print("\n" + "=" * 56)
    print(f"✅ 완료: 강의 {len(events)}건 처리, 산출물 → {OUT}/")
    print("   - lectures.ics            → 구글 캘린더 '가져오기'")
    print("   - curriculum_*.pdf        → NotebookLM 소스 업로드")
    print("   - slides_*.pptx           → 강의 슬라이드")
    print("   - worksheet_*.pptx/.pdf   → 워크지")
    if review:
        print(f"\n⚠️  사실확인 필요 {len(review)}건 — events.json 의 needs_review 참고:")
        for e in review:
            print(f"     • {e.get('title')}: {', '.join(e['needs_review'])}")
    print("=" * 56)


if __name__ == "__main__":
    main()
