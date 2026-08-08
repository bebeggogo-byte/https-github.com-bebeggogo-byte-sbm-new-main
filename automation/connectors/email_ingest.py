"""
이메일 인입 → 파이프라인 입력 정규화 (IMAP)
==============================================
받은편지함에서 강의 관련 메일을 읽어 inputs/messages.txt 형식으로 떨굽니다.
(Gmail은 IMAP 사용 설정 + '앱 비밀번호' 필요)

환경변수:
  IMAP_HOST   예: imap.gmail.com
  EMAIL_USER  예: [email protected]
  EMAIL_PASS  앱 비밀번호

사용법:
  python connectors/email_ingest.py -o inputs/messages.txt           # 최근 안읽은 메일
  python connectors/email_ingest.py --since-days 7 --all -o inputs/messages.txt
"""
from __future__ import annotations

import argparse
import email
import imaplib
import os
import re
from datetime import datetime, timedelta
from email.header import decode_header

LECTURE_KW = ["강의", "특강", "세미나", "워크숍", "워크샵", "강연", "수업", "교육",
              "부탁", "진행", "주제", "대상", "커리큘럼", "강좌", "일정", "장소", "주소"]


def _decode(s) -> str:
    if not s:
        return ""
    parts = decode_header(s)
    out = ""
    for txt, enc in parts:
        out += txt.decode(enc or "utf-8", "ignore") if isinstance(txt, bytes) else txt
    return out


def body_text(msg) -> str:
    if msg.is_multipart():
        for part in msg.walk():
            if part.get_content_type() == "text/plain":
                try:
                    return part.get_payload(decode=True).decode(
                        part.get_content_charset() or "utf-8", "ignore")
                except Exception:
                    continue
        return ""
    try:
        return msg.get_payload(decode=True).decode(
            msg.get_content_charset() or "utf-8", "ignore")
    except Exception:
        return ""


def main() -> None:
    ap = argparse.ArgumentParser(description="이메일 인입(IMAP) → 입력 정규화")
    ap.add_argument("-o", "--output", default="inputs/messages.txt")
    ap.add_argument("--since-days", type=int, default=14)
    ap.add_argument("--all", dest="keep_all", action="store_true", help="키워드 필터 없이")
    ap.add_argument("--mark-read", action="store_true", help="처리한 메일 읽음 처리")
    args = ap.parse_args()

    host = os.getenv("IMAP_HOST"); user = os.getenv("EMAIL_USER"); pw = os.getenv("EMAIL_PASS")
    if not (host and user and pw):
        raise SystemExit("❌ 환경변수 IMAP_HOST / EMAIL_USER / EMAIL_PASS 를 설정하세요.")

    M = imaplib.IMAP4_SSL(host)
    M.login(user, pw)
    M.select("INBOX")
    since = (datetime.now() - timedelta(days=args.since_days)).strftime("%d-%b-%Y")
    typ, data = M.search(None, f'(SINCE {since})')
    ids = data[0].split()
    blocks = []
    for num in ids:
        typ, d = M.fetch(num, "(RFC822)")
        msg = email.message_from_bytes(d[0][1])
        subj = _decode(msg.get("Subject"))
        frm = _decode(msg.get("From"))
        body = body_text(msg).strip()
        combined = f"{subj}\n{body}"
        if not args.keep_all and not any(k in combined for k in LECTURE_KW):
            continue
        blocks.append(f"[이메일] {frm}\n제목: {subj}\n{body}")
        if args.mark_read:
            M.store(num, "+FLAGS", "\\Seen")
    M.logout()

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    open(args.output, "w", encoding="utf-8").write("\n\n".join(blocks) + "\n")
    print(f"✅ {len(blocks)}개 강의 관련 메일 → {args.output}")
    print(f"   다음: python workflow.py init {args.output}")


if __name__ == "__main__":
    main()
