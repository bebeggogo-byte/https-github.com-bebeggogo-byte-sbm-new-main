"""
결과 발송 — 강의보고서/자료 이메일 전송 (SMTP)
================================================
워크플로우 마지막 단계. 강의보고서(HTML)와 첨부(슬라이드/워크지/PDF)를 메일로 보냅니다.

환경변수:
  SMTP_HOST   예: smtp.gmail.com
  SMTP_PORT   예: 587 (기본)
  EMAIL_USER  보내는 계정
  EMAIL_PASS  앱 비밀번호

사용법:
  python connectors/deliver.py --to [email protected] \
      --report workspace/<id>/report.html \
      --attach workspace/<id>/slides.pptx workspace/<id>/worksheet.pdf
"""
from __future__ import annotations

import argparse
import os
import smtplib
from email.message import EmailMessage
from email.utils import make_msgid


def main() -> None:
    ap = argparse.ArgumentParser(description="강의 결과 이메일 발송(SMTP)")
    ap.add_argument("--to", required=True, help="받는 사람(쉼표로 여러 명)")
    ap.add_argument("--subject", default="강의 결과 보고")
    ap.add_argument("--report", help="본문에 넣을 보고서 HTML")
    ap.add_argument("--attach", nargs="*", default=[], help="첨부 파일들")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    host = os.getenv("SMTP_HOST"); port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("EMAIL_USER"); pw = os.getenv("EMAIL_PASS")

    html = "<p>강의 결과 보고를 첨부합니다.</p>"
    if args.report and os.path.exists(args.report):
        html = open(args.report, encoding="utf-8").read()

    msg = EmailMessage()
    msg["Subject"] = args.subject
    msg["From"] = user or "[email protected]"
    msg["To"] = args.to
    msg["Message-ID"] = make_msgid()
    msg.set_content("HTML 보고서를 지원하는 메일 클라이언트로 확인하세요.")
    msg.add_alternative(html, subtype="html")

    for path in args.attach:
        if not os.path.exists(path):
            print(f"   ⚠️ 첨부 없음: {path}"); continue
        with open(path, "rb") as f:
            data = f.read()
        msg.add_attachment(data, maintype="application", subtype="octet-stream",
                           filename=os.path.basename(path))

    if args.dry_run:
        print(f"🔎 (dry-run) 받는이={args.to} 첨부={len(args.attach)}개 "
              f"본문={'보고서HTML' if args.report else '기본'}")
        return
    if not (host and user and pw):
        raise SystemExit("❌ SMTP_HOST / EMAIL_USER / EMAIL_PASS 환경변수를 설정하세요. "
                         "(테스트는 --dry-run)")
    with smtplib.SMTP(host, port) as s:
        s.starttls(); s.login(user, pw); s.send_message(msg)
    print(f"✅ 발송 완료 → {args.to}")


if __name__ == "__main__":
    main()
