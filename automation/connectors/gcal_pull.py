"""
구글 캘린더에서 강의 일정 읽어오기 (events.json 생성)
======================================================
캘린더에 등록된 일정 중 '강의'를 찾아 파이프라인용 events.json 으로 변환합니다.
→ 이 events.json 으로 녹음 예약(schedule_recording.py)·자료 생성이 이어집니다.

준비(최초 1회): connectors/gcal_push.py 와 동일한 credentials.json / token.json 사용
  (읽기 권한 포함: calendar.events 스코프면 읽기·쓰기 모두 가능)

사용법:
  python connectors/gcal_pull.py --days 14 -o output/events.json
  python connectors/gcal_pull.py --days 30 --all -o output/events.json   # 강의 필터 없이
"""
from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timedelta, timezone

SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
LECTURE_KW = ["강의", "특강", "세미나", "워크숍", "워크샵", "강연", "수업", "교육", "강좌"]
KST = timezone(timedelta(hours=9))


def get_service(creds_path: str, token_path: str):
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    if os.path.exists(token_path):
        creds = Credentials.from_authorized_user_file(token_path, SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not os.path.exists(creds_path):
                raise SystemExit(f"❌ {creds_path} 없음 (gcal_push.py 안내 참고)")
            creds = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES).run_local_server(port=0)
        open(token_path, "w").write(creds.to_json())
    return build("calendar", "v3", credentials=creds)


def parse_dt(s: str) -> tuple[str, str]:
    """ISO 문자열 → (YYYY-MM-DD, HH:MM)."""
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    dt = dt.astimezone(KST)
    return dt.strftime("%Y-%m-%d"), dt.strftime("%H:%M")


def to_event(ev: dict) -> dict | None:
    start = ev.get("start", {}).get("dateTime")
    end = ev.get("end", {}).get("dateTime")
    if not start:
        return None  # 종일 일정은 제외
    date, hhmm = parse_dt(start)
    dur = 90
    if end:
        d2 = datetime.fromisoformat(end.replace("Z", "+00:00"))
        d1 = datetime.fromisoformat(start.replace("Z", "+00:00"))
        dur = max(30, int((d2 - d1).total_seconds() // 60))
    title = ev.get("summary", "강의")
    desc = ev.get("description", "")
    loc = ev.get("location", "")
    m = re.search(r"대상[은는:]?\s*([^\n,]+)", desc)
    audience = m.group(1).strip() if m else ""
    return {
        "title": title, "subject": title, "date": date, "start_time": hhmm,
        "duration_min": dur, "location": loc, "address": loc, "audience": audience,
        "source": "구글캘린더", "gcal_id": ev.get("id", ""), "raw": desc,
        "needs_review": [],
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="구글 캘린더 → events.json")
    ap.add_argument("--days", type=int, default=14, help="앞으로 N일 이내")
    ap.add_argument("--calendar-id", default="primary")
    ap.add_argument("--credentials", default="credentials.json")
    ap.add_argument("--token", default="token.json")
    ap.add_argument("--all", dest="keep_all", action="store_true", help="강의 키워드 필터 없이")
    ap.add_argument("-o", "--output", default="output/events.json")
    args = ap.parse_args()

    svc = get_service(args.credentials, args.token)
    now = datetime.now(timezone.utc)
    tmax = now + timedelta(days=args.days)
    items = svc.events().list(
        calendarId=args.calendar_id, timeMin=now.isoformat(), timeMax=tmax.isoformat(),
        singleEvents=True, orderBy="startTime").execute().get("items", [])

    events = []
    for it in items:
        text = f"{it.get('summary','')} {it.get('description','')}"
        if not args.keep_all and not any(k in text for k in LECTURE_KW):
            continue
        e = to_event(it)
        if e:
            events.append(e)

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    json.dump(events, open(args.output, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"✅ 캘린더에서 강의 {len(events)}건 → {args.output}")
    for e in events:
        print(f"   • {e['date']} {e['start_time']} ({e['duration_min']}분) {e['title']}")
    if events:
        print("\n다음: python connectors/schedule_recording.py output/events.json --apply  (녹음 예약)")


if __name__ == "__main__":
    main()
