"""
구글 캘린더 무클릭 자동 등록  (공식 Google Calendar API)
=========================================================
events.json 의 강의 일정을 구글 캘린더에 '직접' 등록합니다(.ics 가져오기 불필요).
공식 API를 쓰므로 약관에 안전합니다. 최초 1회 OAuth 동의만 사람이 합니다.

준비(최초 1회):
  1) Google Cloud Console → 새 프로젝트 → 'Google Calendar API' 사용 설정
  2) OAuth 동의 화면 구성(테스트 사용자에 본인 계정 추가)
  3) 사용자 인증 정보 → OAuth 클라이언트 ID → '데스크톱 앱' → credentials.json 다운로드
  4) credentials.json 을 automation/ 에 두기 (이미 .gitignore 처리됨)

설치:
  pip install google-api-python-client google-auth-oauthlib google-auth-httplib2

사용법:
  python connectors/gcal_push.py output/events.json                  # primary 캘린더에 등록
  python connectors/gcal_push.py output/events.json --calendar-id <id>
  python connectors/gcal_push.py output/events.json --dry-run        # 등록 없이 미리보기
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timedelta

SCOPES = ["https://www.googleapis.com/auth/calendar.events"]
TZ = "Asia/Seoul"


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
                raise SystemExit(
                    f"❌ {creds_path} 없음. Google Cloud Console 에서 OAuth 데스크톱 "
                    "클라이언트 credentials.json 을 받아 두세요. (상단 주석 참고)")
            flow = InstalledAppFlow.from_client_secrets_file(creds_path, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(token_path, "w") as f:
            f.write(creds.to_json())
    return build("calendar", "v3", credentials=creds)


def build_description(e: dict) -> str:
    lines = []
    for k, lab in [("subject", "주제"), ("audience", "대상"),
                   ("duration_min", "진행시간(분)"), ("source", "출처")]:
        if e.get(k):
            lines.append(f"{lab}: {e[k]}")
    if e.get("needs_review"):
        lines.append("\n⚠️ 사실확인 필요:")
        lines += [f"  - {r}" for r in e["needs_review"]]
    if e.get("raw"):
        lines.append("\n── 원문 ──\n" + e["raw"])
    return "\n".join(lines)


def to_gcal_event(e: dict) -> dict | None:
    if not e.get("date") or not e.get("start_time"):
        return None
    start = datetime.strptime(f"{e['date']} {e['start_time']}", "%Y-%m-%d %H:%M")
    end = start + timedelta(minutes=int(e.get("duration_min") or 90))
    loc = " ".join(x for x in [e.get("location", ""), e.get("address", "")] if x).strip()
    return {
        "summary": e.get("title") or "강의 일정",
        "location": loc or None,
        "description": build_description(e),
        "start": {"dateTime": start.isoformat(), "timeZone": TZ},
        "end": {"dateTime": end.isoformat(), "timeZone": TZ},
        "reminders": {"useDefault": False, "overrides": [
            {"method": "popup", "minutes": 24 * 60},
            {"method": "popup", "minutes": 60},
        ]},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="구글 캘린더 무클릭 등록")
    ap.add_argument("events", help="events.json")
    ap.add_argument("--calendar-id", default="primary")
    ap.add_argument("--credentials", default="credentials.json")
    ap.add_argument("--token", default="token.json")
    ap.add_argument("--dry-run", action="store_true", help="등록 없이 미리보기")
    args = ap.parse_args()

    events = json.load(open(args.events, encoding="utf-8"))
    payloads = [(e, to_gcal_event(e)) for e in events]

    if args.dry_run:
        print("🔎 (dry-run) 등록 예정:")
        for e, p in payloads:
            if p:
                print(f"  • {p['start']['dateTime']} | {p['summary']} @ {p.get('location','-')}")
            else:
                print(f"  ⚠️ 건너뜀(날짜/시간 없음): {e.get('title','?')}")
        return

    service = get_service(args.credentials, args.token)
    ok = 0
    for e, p in payloads:
        if not p:
            print(f"  ⚠️ 건너뜀: {e.get('title','?')}")
            continue
        created = service.events().insert(calendarId=args.calendar_id, body=p).execute()
        ok += 1
        print(f"  ✅ 등록: {p['summary']} → {created.get('htmlLink')}")
    print(f"\n총 {ok}건 구글 캘린더 등록 완료.")


if __name__ == "__main__":
    main()
