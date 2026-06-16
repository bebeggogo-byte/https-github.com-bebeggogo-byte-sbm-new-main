"""
구글 캘린더 연결 — 준비 점검기
===============================
캘린더 일정을 가져오기 전에, 필요한 게 다 갖춰졌는지 빨강/초록으로 점검합니다.
(회원님 PC에서 실행 — 클라우드 세션은 구글 IP 차단으로 불가)

사용법:
  python connectors/gcal_setup.py            # 점검만
  python connectors/gcal_setup.py --pull     # 점검 통과 시 바로 일정 가져오기
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)


def ok(b):  # 🟢/🔴
    return "🟢" if b else "🔴"


def main() -> None:
    ap = argparse.ArgumentParser(description="구글 캘린더 연결 준비 점검")
    ap.add_argument("--pull", action="store_true", help="점검 통과 시 일정 가져오기")
    ap.add_argument("--days", type=int, default=14)
    args = ap.parse_args()

    creds = os.path.join(ROOT, "credentials.json")
    token = os.path.join(ROOT, "token.json")
    has_creds = os.path.exists(creds)
    has_token = os.path.exists(token)
    try:
        import googleapiclient, google_auth_oauthlib  # noqa
        has_libs = True
    except Exception:
        has_libs = False

    print("구글 캘린더 연결 — 준비 점검\n" + "=" * 50)
    print(f"{ok(has_libs)}  구글 API 라이브러리 "
          + ("" if has_libs else "→ pip install google-api-python-client google-auth-oauthlib google-auth-httplib2"))
    print(f"{ok(has_creds)}  credentials.json "
          + ("" if has_creds else "→ 아래 '발급 방법' 참고 후 automation/ 폴더에 저장"))
    print(f"{ok(has_token)}  token.json "
          + ("(로그인 완료)" if has_token else "→ 최초 1회 브라우저 로그인 시 자동 생성됨 (아직 없어도 정상)"))
    print("=" * 50)

    if not has_creds:
        print("""
📋 credentials.json 발급 방법 (최초 1회, 약 5분):
  1) https://console.cloud.google.com 접속 → 새 프로젝트 생성
  2) 'API 및 서비스' → 라이브러리 → 'Google Calendar API' 검색 → 사용 설정
  3) 'API 및 서비스' → OAuth 동의 화면 → 외부 → 본인 이메일을 '테스트 사용자'에 추가
  4) '사용자 인증 정보' → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID
     → 애플리케이션 유형 '데스크톱 앱' → 만들기 → JSON 다운로드
  5) 그 파일을 automation/credentials.json 으로 저장
  6) 다시 실행: python connectors/gcal_setup.py --pull
""")
        return

    if not has_libs:
        print("\n⚠️ 라이브러리부터 설치하세요(위 빨강 항목).")
        return

    print("\n✅ 준비 완료!", "바로 가져옵니다…" if args.pull else
          "이제: python connectors/gcal_setup.py --pull")
    if args.pull:
        out = os.path.join(ROOT, "output", "events.json")
        print("\n(최초 1회는 브라우저가 열립니다 — 본인 구글 계정으로 '허용' 누르세요)\n")
        subprocess.run([sys.executable, os.path.join(HERE, "gcal_pull.py"),
                        "--days", str(args.days), "-o", out])


if __name__ == "__main__":
    main()
