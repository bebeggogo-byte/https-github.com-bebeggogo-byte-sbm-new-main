"""
events.json → Google 캘린더 import 용 .ics 파일 생성
=====================================================
구글 캘린더 OAuth 없이도 동작합니다.
생성된 .ics 파일을 Google 캘린더 > 설정 > 가져오기/내보내기 에서 업로드하면
제목 / 일시 / 장소(주소) / 상세설명이 모두 채워진 일정이 등록됩니다.

OAuth 로 '자동 등록'까지 원하면 README 의 'Google Calendar MCP' 절을 따르세요.

사용법:
    python make_ics.py output/events.json -o output/lectures.ics
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta

from icalendar import Calendar, Event as IcsEvent

TZID = "Asia/Seoul"


def build_description(e: dict) -> str:
    lines = []
    if e.get("subject"):
        lines.append(f"주제: {e['subject']}")
    if e.get("audience"):
        lines.append(f"대상: {e['audience']}")
    if e.get("duration_min"):
        lines.append(f"진행시간: {e['duration_min']}분")
    if e.get("source"):
        lines.append(f"출처: {e['source']}")
    if e.get("needs_review"):
        lines.append("")
        lines.append("⚠️ 사실확인 필요:")
        lines.extend(f"  - {r}" for r in e["needs_review"])
    if e.get("raw"):
        lines.append("")
        lines.append("── 원문 ──")
        lines.append(e["raw"])
    lines.append("")
    lines.append("주최: 네다바웨이 (Nedabah Way) · nedabah.org")
    return "\n".join(lines)


def to_ics(events: list[dict]) -> Calendar:
    cal = Calendar()
    cal.add("prodid", "-//Nedabah Way//Lecture Scheduler//KO")
    cal.add("version", "2.0")
    cal.add("X-WR-CALNAME", "네다바웨이 강의일정")
    cal.add("X-WR-TIMEZONE", TZID)

    for i, e in enumerate(events):
        if not e.get("date") or not e.get("start_time"):
            print(f"   ⚠️  건너뜀(날짜/시간 없음): {e.get('title','?')}")
            continue
        start = datetime.strptime(f"{e['date']} {e['start_time']}", "%Y-%m-%d %H:%M")
        end = start + timedelta(minutes=int(e.get("duration_min") or 90))

        ie = IcsEvent()
        ie.add("uid", f"nedabah-{e['date']}-{i}@nedabah.org")
        ie.add("summary", e.get("title") or "강의 일정")
        ie.add("dtstart", start)
        ie.add("dtend", end)
        ie.add("dtstamp", datetime.now())
        loc = " ".join(x for x in [e.get("location", ""), e.get("address", "")] if x).strip()
        if loc:
            ie.add("location", loc)
        ie.add("description", build_description(e))
        # 하루 전 + 1시간 전 알림
        for trig in (timedelta(days=-1), timedelta(hours=-1)):
            from icalendar import Alarm
            al = Alarm()
            al.add("action", "DISPLAY")
            al.add("description", "강의 알림")
            al.add("trigger", trig)
            ie.add_component(al)
        cal.add_component(ie)
    return cal


def main() -> None:
    ap = argparse.ArgumentParser(description="events.json → .ics (Google 캘린더)")
    ap.add_argument("input", help="events.json 경로")
    ap.add_argument("-o", "--output", default="output/lectures.ics")
    args = ap.parse_args()

    events = json.load(open(args.input, encoding="utf-8"))
    cal = to_ics(events)
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "wb") as f:
        f.write(cal.to_ical())
    print(f"✅ {args.output} 생성 — Google 캘린더 '가져오기'로 업로드하세요.")


if __name__ == "__main__":
    main()
