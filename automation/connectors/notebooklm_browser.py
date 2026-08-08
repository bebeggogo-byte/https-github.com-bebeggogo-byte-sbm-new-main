"""
NotebookLM 브라우저 자동화 (Playwright)  ⚠️ best-effort
========================================================
NotebookLM 은 공개 API가 없어 브라우저를 직접 조작합니다. 한계를 분명히 알려드립니다:
  • 본인 계정/본인 자료에 대한 개인 자동화 용도입니다.
  • 로그인·2FA는 최초 1회 '사람'이 직접 합니다(세션은 user-data 폴더에 저장·재사용).
  • Google UI가 바뀌면 셀렉터가 깨질 수 있습니다 → SELECTORS 를 수정하세요.
  • 과도한 자동화는 서비스 약관에 저촉될 수 있으니 본인 책임 하에 사용하세요.

설치:
  pip install playwright
  playwright install chromium      # 브라우저 바이너리(로컬에서 1회)

사용법:
  # 1) 최초: 로그인만 (브라우저가 뜨면 직접 로그인 후 터미널에서 Enter)
  python connectors/notebooklm_browser.py login

  # 2) PDF 소스 업로드 (열려있는 노트북에)
  python connectors/notebooklm_browser.py upload output/curriculum_00.pdf

  # 3) 프롬프트 보내기(자료 서치/요약 지시)
  python connectors/notebooklm_browser.py ask "이 강의에 핵심적인 내용만 골라 슬라이드 개요로 정리해줘"
"""
from __future__ import annotations

import argparse
import os
import sys

URL = "https://notebooklm.google.com/"
USER_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".nblm_profile")

# ⚠️ UI 변경 시 여기만 고치면 됩니다. (현재값은 예시 — 실제 화면에서 확인 권장)
SELECTORS = {
    "add_source_btn": 'button:has-text("소스 추가"), button:has-text("Add source")',
    "file_input": 'input[type="file"]',
    "upload_tab": 'text=업로드, text=Upload',
    "chat_input": 'textarea, [contenteditable="true"]',
    "send_btn": 'button[aria-label*="보내기"], button[aria-label*="Send"]',
}


def _context():
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        raise SystemExit("❌ pip install playwright && playwright install chromium 먼저 실행하세요.")
    p = sync_playwright().start()
    ctx = p.chromium.launch_persistent_context(
        USER_DATA, headless=False, viewport={"width": 1280, "height": 900})
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    return p, ctx, page


def cmd_login() -> None:
    p, ctx, page = _context()
    page.goto(URL)
    print("🔐 브라우저에서 Google 로그인 후, NotebookLM 메인이 보이면 여기서 Enter…")
    try:
        input()
    finally:
        ctx.close(); p.stop()
    print(f"✅ 세션 저장됨 → {USER_DATA} (다음부터 로그인 생략)")


def cmd_upload(path: str) -> None:
    if not os.path.exists(path):
        raise SystemExit(f"❌ 파일 없음: {path}")
    p, ctx, page = _context()
    page.goto(URL)
    page.wait_for_timeout(4000)
    print("📎 '소스 추가' 시도… (안 보이면 화면에서 노트북을 먼저 여세요)")
    try:
        try:
            page.click(SELECTORS["add_source_btn"], timeout=8000)
            page.wait_for_timeout(1500)
        except Exception:
            print("   ⚠️ '소스 추가' 버튼 자동 클릭 실패 — 화면에서 직접 열어주세요. 10초 대기.")
            page.wait_for_timeout(10000)
        page.set_input_files(SELECTORS["file_input"], os.path.abspath(path), timeout=15000)
        print(f"✅ 업로드 전송: {path}  (처리 완료까지 화면에서 확인)")
        page.wait_for_timeout(8000)
    finally:
        input("완료되면 Enter… ")
        ctx.close(); p.stop()


def cmd_ask(prompt: str) -> None:
    p, ctx, page = _context()
    page.goto(URL)
    page.wait_for_timeout(4000)
    try:
        page.fill(SELECTORS["chat_input"], prompt, timeout=10000)
        try:
            page.click(SELECTORS["send_btn"], timeout=4000)
        except Exception:
            page.keyboard.press("Enter")
        print("✅ 프롬프트 전송. 답변은 화면에서 확인/복사하세요.")
        page.wait_for_timeout(8000)
    finally:
        input("완료되면 Enter… ")
        ctx.close(); p.stop()


def main() -> None:
    ap = argparse.ArgumentParser(description="NotebookLM 브라우저 자동화 (best-effort)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("login")
    up = sub.add_parser("upload"); up.add_argument("path")
    ak = sub.add_parser("ask"); ak.add_argument("prompt")
    args = ap.parse_args()

    if args.cmd == "login":
        cmd_login()
    elif args.cmd == "upload":
        cmd_upload(args.path)
    elif args.cmd == "ask":
        cmd_ask(args.prompt)


if __name__ == "__main__":
    main()
