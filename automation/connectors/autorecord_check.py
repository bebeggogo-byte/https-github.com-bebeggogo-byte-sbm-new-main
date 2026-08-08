"""
완전 자동 녹음 — 준비 점검 + 예약 등록 (한 방에)
=================================================
강의 당일 '아무것도 안 누르기'를 위해, 사전에 딱 한 번 실행합니다.
필요한 것(ffmpeg·전사기·마이크 권한·예약 등록)을 점검하고 한 번에 예약을 겁니다.

사용법:
  python connectors/autorecord_check.py workflow_state.json          # 점검만(빨강/초록)
  python connectors/autorecord_check.py workflow_state.json --apply  # 점검 후 예약 등록

준비물(없으면 빨강으로 알려줍니다):
  • ffmpeg          : 녹음 (brew/apt/choco install ffmpeg)
  • faster-whisper  : 전사 (pip install faster-whisper)
  • 마이크 권한     : 첫 실행 시 OS가 물어보면 '허용'
  • 예약 등록       : 강의 시작시각에 자동 녹음 (at/schtasks)
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def ok(b: bool) -> str:
    return "🟢" if b else "🔴"


def load_events(path: str) -> list[dict]:
    data = json.load(open(path, encoding="utf-8"))
    if isinstance(data, dict) and "lectures" in data:
        return [l["event"] for l in data["lectures"]]
    return data


def main() -> None:
    ap = argparse.ArgumentParser(description="완전 자동 녹음 준비 점검 + 예약 등록")
    ap.add_argument("input", help="workflow_state.json 또는 events.json")
    ap.add_argument("--apply", action="store_true", help="점검 후 예약까지 등록")
    args = ap.parse_args()

    sysname = platform.system()
    has_ffmpeg = bool(shutil.which("ffmpeg"))
    try:
        import faster_whisper  # noqa: F401
        has_whisper = True
    except Exception:
        has_whisper = False
    scheduler = shutil.which("at") if sysname != "Windows" else shutil.which("schtasks")
    has_sched = bool(scheduler)

    events = load_events(args.input)
    dated = [e for e in events if e.get("date") and e.get("start_time")]

    print("완전 자동 녹음 — 준비 점검\n" + "=" * 46)
    print(f"{ok(has_ffmpeg)}  ffmpeg (녹음)        "
          + ("" if has_ffmpeg else "→ 설치: brew/apt/choco install ffmpeg"))
    print(f"{ok(has_whisper)}  faster-whisper (전사) "
          + ("" if has_whisper else "→ 설치: pip install faster-whisper"))
    print(f"{ok(has_sched)}  예약 스케줄러 ({'schtasks' if sysname=='Windows' else 'at'}) "
          + ("" if has_sched else "→ Linux: apt install at && service atd start"))
    print(f"🟡  마이크 권한        → 첫 녹음 때 OS가 물으면 '허용' (노트북을 강사 근처에 열어두기)")
    print(f"🟢  예약할 강의        {len(dated)}건 (날짜·시간 확정)")
    print("=" * 46)

    ready = has_ffmpeg and has_sched and dated
    if not ready:
        print("⚠️ 빨강 항목을 먼저 해결하면 '완전 자동'이 됩니다.")
        if not has_whisper:
            print("   (faster-whisper 없으면 녹음·예약은 되지만 전사/보고서는 보류됩니다.)")

    if args.apply:
        if not (has_ffmpeg and has_sched and dated):
            print("\n❌ 준비 미완료 → 예약 등록 보류. 위 빨강 항목 해결 후 다시 --apply 하세요.")
            return
        print("\n⏰ 예약 등록 중…")
        subprocess.run([sys.executable, os.path.join(HERE, "schedule_recording.py"),
                        args.input, "--apply"])
        print("✅ 등록 완료! 강의 당일엔 아무것도 안 눌러도 됩니다. "
              "(PC 켜두기 + 노트북 열어두기만)")
    else:
        print("\n다음: 준비되면  python connectors/autorecord_check.py "
              f"{os.path.basename(args.input)} --apply")


if __name__ == "__main__":
    main()
