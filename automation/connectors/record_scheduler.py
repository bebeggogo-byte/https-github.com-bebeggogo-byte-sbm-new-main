"""
강의 자동 녹음 스케줄러  (ffmpeg)
==================================
events.json 의 강의 일정에 맞춰: 시작 시각이 되면 자동 녹음 시작 →
강의 시간(duration_min) 동안 녹음 → 끝나면 자동 정지·저장.
원하면 저장 직후 전사 + 강의보고서(HTML)까지 자동 실행합니다.

마이크 입력은 OS마다 다릅니다(자동 추정, --input 으로 덮어쓰기 가능):
  • Linux  : -f pulse  -i default
  • macOS  : -f avfoundation -i ":0"   (최초 1회 마이크 권한 허용)
  • Windows: -f dshow -i audio="마이크 장치명"   (장치명은 아래로 확인)
      ffmpeg -list_devices true -f dshow -i dummy

설치: 시스템에 ffmpeg 필요 (brew/apt/choco install ffmpeg)

사용법:
  python connectors/record_scheduler.py output/events.json --next            # 다음 강의 시작까지 대기→녹음
  python connectors/record_scheduler.py output/events.json --index 0 --then-report
  python connectors/record_scheduler.py output/events.json --list            # 예정 강의 목록
  python connectors/record_scheduler.py --now 10 -o recordings/test.m4a      # 즉시 10초 테스트
"""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
REC_DIR = os.path.join(ROOT, "recordings")


def default_input() -> list[str]:
    sysname = platform.system()
    if sysname == "Darwin":
        return ["-f", "avfoundation", "-i", ":0"]
    if sysname == "Windows":
        return ["-f", "dshow", "-i", "audio=default"]
    return ["-f", "pulse", "-i", "default"]  # Linux


def safe(name: str) -> str:
    return re.sub(r"[^\w가-힣]+", "_", name).strip("_")[:60] or "lecture"


def record(out_path: str, seconds: int, input_args: list[str]) -> bool:
    if not shutil.which("ffmpeg"):
        print("❌ ffmpeg 미설치. (brew/apt/choco install ffmpeg)")
        return False
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    cmd = ["ffmpeg", "-y", *input_args, "-t", str(seconds),
           "-ac", "1", "-ar", "16000", out_path]   # 모노 16k = 전사에 최적
    print(f"🔴 녹음 시작 ({seconds}s) → {out_path}")
    try:
        subprocess.run(cmd, check=True)
    except subprocess.CalledProcessError as e:
        print(f"❌ 녹음 실패: {e}  (입력장치 확인: --input)")
        return False
    print(f"⏹  녹음 정지·저장 완료 → {out_path}")
    return True


def wait_until(target: datetime) -> None:
    while True:
        delta = (target - datetime.now()).total_seconds()
        if delta <= 0:
            return
        print(f"⏳ {target:%Y-%m-%d %H:%M} 시작까지 {int(delta)}s 대기…")
        time.sleep(min(delta, 30))


def post_process(audio: str, event: dict, events_path: str, index: int,
                 slides: str | None = None, keep_audio: bool = False) -> None:
    """녹음 후: 전사 → 보고서 → (슬라이드 있으면)깊이차이 분석 → 녹음 자동 삭제."""
    txt = os.path.splitext(audio)[0] + ".txt"
    rep = os.path.join(ROOT, "output", f"report_{index:02d}.html")
    gap = os.path.join(ROOT, "output", f"gap_{index:02d}.html")
    py = sys.executable
    print("📝 전사 시작…")
    r = subprocess.run([py, os.path.join(ROOT, "transcribe.py"), audio, "-o", txt])
    if r.returncode != 0 or not os.path.exists(txt):
        print("⚠️ 전사 실패/건너뜀 — 녹음은 보존합니다(재시도 가능).")
        return
    print("📄 강의보고서 생성…")
    subprocess.run([py, os.path.join(ROOT, "lecture_report.py"), txt,
                    "--event", events_path, "--index", str(index), "-o", rep])
    # 슬라이드가 주어지면 '슬라이드 vs 발화 깊이 차이' 분석
    if slides and os.path.exists(slides):
        print("🔬 슬라이드 vs 발화 깊이 차이 분석…")
        subprocess.run([py, os.path.join(ROOT, "gap_analysis.py"),
                        "--slides", slides, "--transcript", txt,
                        "--event", events_path, "--index", str(index), "-o", gap])
    # 전사·보고서가 모두 생성됐으면 큰 녹음파일 자동 삭제
    if not keep_audio and os.path.exists(txt) and os.path.exists(rep):
        try:
            size = os.path.getsize(audio) / 1e6
            os.remove(audio)
            print(f"🗑️  녹음 파일 삭제(용량 절약 {size:.0f}MB): {os.path.basename(audio)}")
            print("    (전사본 .txt 는 보존 — 내용은 남고 용량만 비움)")
        except OSError as e:
            print(f"⚠️ 녹음 삭제 실패: {e}")


def main() -> None:
    ap = argparse.ArgumentParser(description="강의 자동 녹음 스케줄러")
    ap.add_argument("events", nargs="?", help="events.json")
    ap.add_argument("--index", type=int, help="특정 강의")
    ap.add_argument("--next", action="store_true", help="다음 강의 1건")
    ap.add_argument("--list", action="store_true", help="예정 강의 목록")
    ap.add_argument("--now", type=int, help="즉시 N초 녹음(테스트)")
    ap.add_argument("--input", help='ffmpeg 입력 인자 덮어쓰기(예: "-f pulse -i default")')
    ap.add_argument("--then-report", action="store_true", help="녹음 후 전사+보고서 자동")
    ap.add_argument("--slides", help="강의 슬라이드 PPTX (깊이 차이 분석용)")
    ap.add_argument("--keep-audio", action="store_true", help="작업 후 녹음 파일 보존(기본: 자동 삭제)")
    ap.add_argument("-o", "--output", help="출력 경로(--now 용)")
    args = ap.parse_args()

    input_args = args.input.split() if args.input else default_input()

    if args.now:
        record(args.output or os.path.join(REC_DIR, "test.m4a"), args.now, input_args)
        return

    if not args.events:
        ap.error("events.json 경로가 필요합니다 (또는 --now).")
    events = json.load(open(args.events, encoding="utf-8"))

    def start_dt(e):
        return datetime.strptime(f"{e['date']} {e['start_time']}", "%Y-%m-%d %H:%M") \
            if e.get("date") and e.get("start_time") else None

    sched = [(i, e, start_dt(e)) for i, e in enumerate(events)]
    sched = [(i, e, d) for i, e, d in sched if d]

    if args.list:
        now = datetime.now()
        for i, e, d in sorted(sched, key=lambda x: x[2]):
            tag = "예정" if d > now else "지남"
            print(f"  [{i}] {d:%Y-%m-%d %H:%M} ({tag}) {e.get('duration_min',90)}분 | {e.get('title')}")
        return

    # 대상 선택
    if args.index is not None:
        targets = [(i, e, d) for i, e, d in sched if i == args.index]
    elif args.next:
        upcoming = sorted([t for t in sched if t[2] > datetime.now()], key=lambda x: x[2])
        targets = upcoming[:1]
    else:
        ap.error("--index N / --next / --list / --now 중 하나가 필요합니다.")

    if not targets:
        print("대상 강의가 없습니다.")
        return

    for i, e, d in targets:
        secs = int(e.get("duration_min") or 90) * 60
        out = os.path.join(REC_DIR, f"{e.get('date','')}_{safe(e.get('title','lecture'))}.m4a")
        if d > datetime.now():
            wait_until(d)
        if record(out, secs, input_args) and args.then_report:
            post_process(out, e, args.events, i,
                         slides=args.slides, keep_audio=args.keep_audio)


if __name__ == "__main__":
    main()
