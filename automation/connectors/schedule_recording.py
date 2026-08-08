"""
녹음 예약 자동 등록 — OS 스케줄러 명령 생성
=============================================
강의 일정마다 'OS 예약 작업'을 만들어, 강의 시작 시각에 자동으로 녹음이
시작되도록 합니다(PC만 켜져 있으면 무인 녹음 → 전사 → 보고서까지).

OS별 예약 방식(자동 감지, --os 로 지정 가능):
  • Linux/macOS : at  (one-shot)         예) echo "..." | at 14:00 2026-06-12
  • Windows     : schtasks (1회 작업)

입력은 events.json 또는 workflow_state.json 둘 다 인식합니다.
실제 등록까지 하려면 --apply (미지정 시 명령만 출력/스크립트로 저장).

사용법:
  python connectors/schedule_recording.py output/events.json            # 명령 미리보기
  python connectors/schedule_recording.py workflow_state.json -o register.sh
  python connectors/schedule_recording.py output/events.json --apply    # 바로 등록
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def load_events(path: str) -> list[dict]:
    data = json.load(open(path, encoding="utf-8"))
    if isinstance(data, dict) and "lectures" in data:      # workflow_state.json
        return [l["event"] for l in data["lectures"]]
    return data                                            # events.json


def safe(name: str) -> str:
    return re.sub(r"[^\w]+", "_", name).strip("_")[:40] or "lecture"


def rec_cmd(idx: int, events_file: str) -> str:
    """강의 1건을 녹음→전사→보고서까지 도는 명령(인덱스는 events_file 기준)."""
    py = sys.executable
    return (f'cd "{ROOT}" && "{py}" connectors/record_scheduler.py '
            f'"{events_file}" --index {idx} --then-report')


def gen(idx: int, e: dict, osname: str, events_file: str) -> str | None:
    if not (e.get("date") and e.get("start_time")):
        return None
    date, hhmm = e["date"], e["start_time"]
    cmd = rec_cmd(idx, events_file)
    if osname == "Windows":
        tn = f"Lecture_{safe(e.get('title','lec'))}_{date}"
        d = date.replace("-", "/")
        return (f'schtasks /create /tn "{tn}" /sc once '
                f'/sd {d} /st {hhmm} /tr "{cmd}" /f')
    # Linux/macOS : at
    return f'echo \'{cmd}\' | at {hhmm} {date}'


def main() -> None:
    ap = argparse.ArgumentParser(description="녹음 예약 OS 스케줄러 명령 생성")
    ap.add_argument("input", help="events.json 또는 workflow_state.json")
    ap.add_argument("--os", dest="osname", default=platform.system(),
                    help="Linux/Darwin/Windows (기본: 현재 OS)")
    ap.add_argument("-o", "--output", help="등록 스크립트로 저장")
    ap.add_argument("--apply", action="store_true", help="즉시 등록 실행")
    args = ap.parse_args()

    events = load_events(args.input)
    # 인덱스가 정확히 일치하도록 정규화된 events 리스트를 사이드카로 고정.
    events_file = os.path.join(ROOT, "output", "_scheduled_events.json")
    os.makedirs(os.path.dirname(events_file), exist_ok=True)
    json.dump(events, open(events_file, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    lines, skipped = [], 0
    for i, e in enumerate(events):
        c = gen(i, e, args.osname, events_file)
        if c:
            lines.append(c)
            print(f"  ⏰ {e.get('date')} {e.get('start_time')} | {e.get('title','강의')}")
        else:
            skipped += 1
    if not lines:
        print("등록할 (날짜·시간 확정) 강의가 없습니다.")
        return
    print(f"\n생성된 예약 명령 {len(lines)}개" + (f" (날짜미정 {skipped}건 제외)" if skipped else ""))

    if args.output:
        header = "#!/bin/sh\n" if args.osname != "Windows" else "@echo off\r\n"
        open(args.output, "w", encoding="utf-8").write(header + "\n".join(lines) + "\n")
        print(f"💾 저장 → {args.output}  (실행하면 일괄 등록)")
    elif not args.apply:
        print("\n--- 아래 명령으로 등록(또는 -o 로 스크립트 저장, --apply 로 즉시 등록) ---")
        for c in lines:
            print(c)

    if args.apply:
        if args.osname != platform.system():
            print("⚠️ --apply 는 현재 OS에서만 동작합니다."); return
        for c in lines:
            subprocess.run(c, shell=True)
        print(f"✅ {len(lines)}건 예약 등록 완료.")


if __name__ == "__main__":
    main()
