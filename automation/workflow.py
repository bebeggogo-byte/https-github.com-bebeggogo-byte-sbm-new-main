"""
강의업무 워크플로우 오케스트레이터
====================================
문자·이메일·전화·카톡 '인입'부터 '결과보고 발송'까지 전 과정을 잘게 쪼개
하나로 연결합니다. 각 단계 사이에 '검수 게이트'를 두어, 사람이 확인하고
승인해야 다음으로 넘어갑니다. 진행 상태는 workflow_state.json 에 저장되어
중단/재개가 자유롭습니다.

단계(stage):
  INTAKE → PARSE → ⛳REVIEW_SCHEDULE → CALENDAR → CURRICULUM →
  ⛳REVIEW_CURRICULUM → MATERIALS → ⛳REVIEW_MATERIALS →
  RECORD → TRANSCRIBE → REPORT → ⛳REVIEW_REPORT → DELIVER
( ⛳ = 사람 검수 필요 )

사용법:
  python workflow.py init inputs/messages.txt   # 인입+파싱 → 강의 등록
  python workflow.py status                      # 전체 진행판
  python workflow.py run                          # 검수 게이트 전까지 자동 진행
  python workflow.py approve <id> [stage]         # 검수 통과(다음 단계 개방)
  python workflow.py attach-transcript <id> <txt> # 전사본 연결(녹음 후)
  python workflow.py show <id>                    # 강의 1건 상세
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from datetime import datetime

ROOT = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(ROOT, "workflow_state.json")
WS = os.path.join(ROOT, "workspace")
PY = sys.executable

# (stage, 한글명, 종류)  종류: auto / checkpoint / manual / post_record
STAGES = [
    ("INTAKE",            "인입(문자·이메일·전화·카톡)", "auto"),
    ("PARSE",             "일정 파싱 + 사실확인",        "auto"),
    ("REVIEW_SCHEDULE",   "일정 검수",                   "checkpoint"),
    ("CALENDAR",          "구글캘린더 등록(.ics)",       "auto"),
    ("CURRICULUM",        "커리큘럼 PDF",                "auto"),
    ("REVIEW_CURRICULUM", "커리큘럼 검수",               "checkpoint"),
    ("MATERIALS",         "슬라이드 + 워크지",           "auto"),
    ("REVIEW_MATERIALS",  "강의자료 검수(+노트북LM)",    "checkpoint"),
    ("RECORD",            "강의 녹음(예약)",             "manual"),
    ("TRANSCRIBE",        "전사",                        "post_record"),
    ("REPORT",            "강의보고서(HTML)",            "post_record"),
    ("REVIEW_REPORT",     "보고서 검수",                 "checkpoint"),
    ("DELIVER",           "결과 발송",                   "auto"),
]
STAGE_KIND = {s: k for s, _, k in STAGES}
STAGE_NAME = {s: n for s, n, _ in STAGES}
ORDER = [s for s, _, _ in STAGES]


# ----------------------------------------------------------------- state
def load_state() -> dict:
    if os.path.exists(STATE):
        return json.load(open(STATE, encoding="utf-8"))
    return {"lectures": []}


def save_state(st: dict) -> None:
    json.dump(st, open(STATE, "w", encoding="utf-8"), ensure_ascii=False, indent=2)


def make_id(e: dict) -> str:
    base = f"{e.get('date','nodate')}_{e.get('subject') or e.get('title','강의')}"
    return re.sub(r"[^\w가-힣]+", "_", base).strip("_")[:50]


def new_lecture(e: dict, theme: str | None) -> dict:
    lid = make_id(e)
    ws = os.path.join(WS, lid)
    os.makedirs(ws, exist_ok=True)
    json.dump([e], open(os.path.join(ws, "event.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    stages = {s: {"status": "pending"} for s, _, _ in STAGES}
    stages["INTAKE"] = {"status": "done", "at": now()}
    stages["PARSE"] = {"status": "done", "at": now()}
    return {"id": lid, "event": e, "theme": theme, "workspace": ws, "stages": stages}


def now() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M")


# ----------------------------------------------------------------- run helpers
def sh(args: list[str]) -> bool:
    print(f"   $ {' '.join(os.path.basename(a) for a in args[1:3])} …")
    r = subprocess.run(args, cwd=ROOT)
    return r.returncode == 0


def theme_args(lec: dict) -> list[str]:
    return ["--theme", lec["theme"]] if lec.get("theme") else []


def run_stage(lec: dict, stage: str) -> bool:
    ws = lec["workspace"]
    ev = os.path.join(ws, "event.json")
    ta = theme_args(lec)
    if stage == "CALENDAR":
        return sh([PY, "make_ics.py", ev, "-o", os.path.join(ws, "calendar.ics")])
    if stage == "CURRICULUM":
        return sh([PY, "make_curriculum_pdf.py", ev, "--index", "0",
                   "-o", os.path.join(ws, "curriculum.pdf")] + ta)
    if stage == "MATERIALS":
        ok1 = sh([PY, "make_slides.py", "--from-events", ev, "--index", "0",
                  "-o", os.path.join(ws, "slides.pptx")] + ta)
        ok2 = sh([PY, "make_worksheet.py", "--from-events", ev, "--index", "0",
                  "-o", os.path.join(ws, "worksheet.pptx"),
                  "--pdf", os.path.join(ws, "worksheet.pdf")] + ta)
        return ok1 and ok2
    if stage == "TRANSCRIBE":
        audio = lec["stages"].get("RECORD", {}).get("artifact")
        if not audio or not os.path.exists(audio):
            print("   ⏸ 녹음 파일 없음 → 전사 보류 (attach-transcript 로 연결 가능)")
            return False
        return sh([PY, "transcribe.py", audio, "-o", os.path.join(ws, "transcript.txt")])
    if stage == "REPORT":
        tx = os.path.join(ws, "transcript.txt")
        if not os.path.exists(tx):
            print("   ⏸ 전사본 없음 → 보고서 보류")
            return False
        return sh([PY, "lecture_report.py", tx, "--event", ev, "--index", "0",
                   "-o", os.path.join(ws, "report.html")] + ta)
    if stage == "DELIVER":
        # 발송은 설정(SMTP)이 있어야 하므로 기본은 안내만
        print("   ✉️  결과 발송: connectors/deliver.py 로 이메일 전송(설정 필요).")
        print(f"       보고서: {os.path.join(ws, 'report.html')}")
        return True
    return True


# ----------------------------------------------------------------- commands
def cmd_init(input_file: str, theme: str | None) -> None:
    os.makedirs(WS, exist_ok=True)
    events_json = os.path.join(WS, "_events.json")
    print("① 인입 → ② 파싱 …")
    if not sh([PY, "parse_schedule.py", input_file, "-o", events_json]):
        raise SystemExit("파싱 실패")
    events = json.load(open(events_json, encoding="utf-8"))
    st = load_state()
    existing = {l["id"] for l in st["lectures"]}
    added = 0
    for e in events:
        lec = new_lecture(e, theme)
        if lec["id"] in existing:
            print(f"   • 이미 등록됨: {lec['id']}")
            continue
        st["lectures"].append(lec)
        existing.add(lec["id"])
        added += 1
        print(f"   ＋ 등록: {lec['id']}  ⛳ 다음: 일정 검수")
    save_state(st)
    print(f"\n✅ {added}건 등록. 다음: `python workflow.py status` 로 확인 → "
          "검수 후 `approve`, 그다음 `run`.")


# 무인 모드에서 '일정 검수'를 멈춰 세우는 위험 신호(약한 경고는 자동 통과)
HARD_WARN = ("추출 실패", "불일치", "미정", "상대 날짜")


def is_risky(event: dict) -> bool:
    return any(any(h in r for h in HARD_WARN) for r in event.get("needs_review", []))


def first_incomplete(lec: dict) -> str | None:
    for s in ORDER:
        if lec["stages"].get(s, {}).get("status") not in ("done", "skipped"):
            return s
    return None


def cmd_run(auto: bool = False, send: bool = False) -> None:
    st = load_state()
    for lec in st["lectures"]:
        print(f"\n▶ {lec['id']}")
        while True:
            s = first_incomplete(lec)
            if s is None:
                print("   ✅ 모든 단계 완료")
                break
            kind = STAGE_KIND[s]
            cur = lec["stages"][s]
            if kind == "checkpoint":
                if cur.get("status") == "approved":
                    cur["status"] = "done"; cur["at"] = now()
                    continue
                # 무인 모드: 신뢰 구간은 자동 통과. 단, 일정 검수는 '위험한' 경고가
                # 있을 때만 멈춘다(약한 경고: 연도 미기재 등은 자동 통과).
                if auto:
                    risky = s == "REVIEW_SCHEDULE" and is_risky(lec["event"])
                    if not risky:
                        cur["status"] = "done"; cur["at"] = now()
                        print(f"   ✅(auto) 검수 통과: {STAGE_NAME[s]}")
                        continue
                cur["status"] = "pending_review"
                tag = " ⚠️경고있음" if lec["event"].get("needs_review") else ""
                print(f"   ⛳ 검수 대기: {STAGE_NAME[s]}{tag}  → "
                      f"`python workflow.py approve {lec['id']} {s}`")
                break
            if kind == "manual":
                cur["status"] = "waiting"
                print(f"   ⏸ 수동/예약 단계: {STAGE_NAME[s]} "
                      f"(connectors/record_scheduler.py 로 녹음 → attach-transcript)")
                break
            # 날짜/시간이 없으면 캘린더는 등록 불가 → '건너뜀'으로 명시하고 다음 단계 계속
            if s == "CALENDAR" and not (lec["event"].get("date") and lec["event"].get("start_time")):
                cur["status"] = "skipped"; cur["at"] = now()
                print("   ⤼ 캘린더 건너뜀: 날짜/시간 미확정 (일정 확정 후 .ics 재생성)")
                continue
            # 발송은 무인 모드라도 --send 없이는 멈춤(오발송 방지)
            if s == "DELIVER" and auto and not send:
                cur["status"] = "waiting"
                print("   ⏸ 발송 대기: 안전을 위해 자동 발송 안 함. "
                      "`python workflow.py run --auto --send` 또는 connectors/deliver.py 로 발송.")
                break
            # auto / post_record
            print(f"   ⚙️ {STAGE_NAME[s]}")
            if run_stage(lec, s):
                cur["status"] = "done"; cur["at"] = now()
            else:
                cur["status"] = "blocked"
                print(f"   ⏸ 보류: {STAGE_NAME[s]} (선행 조건 충족 후 재실행)")
                break
        save_state(st)
    print("\n진행판: `python workflow.py status`")


def cmd_approve(lid: str, stage: str | None) -> None:
    st = load_state()
    lec = next((l for l in st["lectures"] if l["id"] == lid), None)
    if not lec:
        raise SystemExit(f"없는 강의: {lid}")
    if not stage:
        # 현재 검수 대기 중인 단계를 자동 선택
        stage = next((s for s in ORDER if STAGE_KIND[s] == "checkpoint"
                      and lec["stages"][s]["status"] in ("pending_review", "pending")), None)
    if not stage:
        raise SystemExit("검수 대기 단계가 없습니다.")
    lec["stages"][stage] = {"status": "approved", "at": now()}
    save_state(st)
    print(f"✅ 검수 통과: {lid} / {STAGE_NAME.get(stage, stage)} → `run` 으로 계속 진행")


def cmd_attach_transcript(lid: str, txt: str) -> None:
    st = load_state()
    lec = next((l for l in st["lectures"] if l["id"] == lid), None)
    if not lec:
        raise SystemExit(f"없는 강의: {lid}")
    dst = os.path.join(lec["workspace"], "transcript.txt")
    dst_audio = lec["stages"]["RECORD"]
    import shutil
    shutil.copy(txt, dst)
    lec["stages"]["RECORD"] = {"status": "done", "at": now(), "artifact": dst}
    lec["stages"]["TRANSCRIBE"] = {"status": "done", "at": now()}
    save_state(st)
    print(f"✅ 전사본 연결: {dst}  → `run` 으로 보고서 생성까지 진행")


def bar(lec: dict) -> str:
    icons = []
    for s in ORDER:
        stt = lec["stages"].get(s, {}).get("status")
        if stt == "done":
            icons.append("●")
        elif stt == "skipped":
            icons.append("⊘")
        elif stt in ("pending_review", "waiting", "blocked"):
            icons.append("◍")
        else:
            icons.append("○")
    return "".join(icons)


def cmd_status() -> None:
    st = load_state()
    if not st["lectures"]:
        print("등록된 강의가 없습니다. `python workflow.py init <messages.txt>`")
        return
    print("진행판  (●완료 ◍대기 ⊘건너뜀 ○예정)\n" + "=" * 60)
    for lec in st["lectures"]:
        s = first_incomplete(lec)
        nxt = "🎉 완료" if s is None else f"다음: {STAGE_NAME[s]}"
        if s and STAGE_KIND[s] == "checkpoint" and \
           lec["stages"][s]["status"] == "pending_review":
            nxt = f"⛳ 검수대기: {STAGE_NAME[s]}"
        print(f"{bar(lec)}  {lec['id']}")
        print(f"{' '*len(ORDER)}  {nxt}")
    print("=" * 60)
    print("단계: " + " ".join(f"{i+1}.{STAGE_NAME[s]}" for i, s in enumerate(ORDER[:6])) + " …")


def cmd_show(lid: str) -> None:
    st = load_state()
    lec = next((l for l in st["lectures"] if l["id"] == lid), None)
    if not lec:
        raise SystemExit(f"없는 강의: {lid}")
    print(f"■ {lec['id']}   테마={lec.get('theme') or '자동'}")
    print(f"  작업폴더: {lec['workspace']}")
    for i, s in enumerate(ORDER):
        stt = lec["stages"].get(s, {})
        mark = {"done": "✅", "pending_review": "⛳", "waiting": "⏸",
                "blocked": "⏸", "approved": "✅", "skipped": "⤼",
                "pending": "·"}.get(stt.get("status"), "·")
        at = f"  ({stt['at']})" if stt.get("at") else ""
        print(f"  {mark} {i+1:2}. {STAGE_NAME[s]}{at}")


def main() -> None:
    ap = argparse.ArgumentParser(description="강의업무 워크플로우 오케스트레이터")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("init"); p.add_argument("input"); p.add_argument("--theme")
    p = sub.add_parser("auto"); p.add_argument("input"); p.add_argument("--theme")
    sub.add_parser("status")
    p = sub.add_parser("run")
    p.add_argument("--auto", action="store_true", help="검수 자동통과(경고 일정은 제외)")
    p.add_argument("--send", action="store_true", help="무인 모드에서 결과 발송까지 허용")
    p = sub.add_parser("approve"); p.add_argument("id"); p.add_argument("stage", nargs="?")
    p = sub.add_parser("attach-transcript"); p.add_argument("id"); p.add_argument("txt")
    p = sub.add_parser("show"); p.add_argument("id")
    args = ap.parse_args()

    if args.cmd == "auto":
        cmd_init(args.input, args.theme)
        print("\n— 오토파일럿: 자동 진행 —")
        cmd_run(auto=True, send=False)
        cmd_status()
    elif args.cmd == "init":
        cmd_init(args.input, args.theme)
    elif args.cmd == "status":
        cmd_status()
    elif args.cmd == "run":
        cmd_run(auto=args.auto, send=args.send)
    elif args.cmd == "approve":
        cmd_approve(args.id, args.stage)
    elif args.cmd == "attach-transcript":
        cmd_attach_transcript(args.id, args.txt)
    elif args.cmd == "show":
        cmd_show(args.id)


if __name__ == "__main__":
    main()
