"""
카카오톡 / 문자 / 에이닷 수집 → 파이프라인 입력 텍스트로 정규화
================================================================
브라우저 스크래핑은 카톡에 안정적인 웹 DOM이 없고 약관 위반 소지가 있어 권하지 않습니다.
대신 '공식 내보내기'를 정규화합니다 (안정적·합법적):

  ▸ 카카오톡:  채팅방 → 메뉴 → '대화 내용 내보내기' → .txt  (PC/모바일 모두 지원)
  ▸ 문자(SMS): 휴대폰 백업 앱으로 .txt/CSV 내보내기, 또는 복사 붙여넣기
  ▸ 에이닷:    통화요약 텍스트 복사 붙여넣기
  ▸ 스크린샷:  --ocr 로 이미지에서 텍스트 추출(pytesseract 설치 시)

동작: 발신자/시간 줄을 파싱해 메시지 블록으로 묶고, 강의 관련 메시지만 골라
'[카카오톡] 발신자' 헤더가 붙은 텍스트로 저장합니다 → parse_schedule.py 가 바로 읽습니다.

사용법:
  python connectors/kakao_ingest.py KakaoTalkChats.txt -o inputs/messages.txt
  python connectors/kakao_ingest.py screenshot.png --ocr -o inputs/messages.txt
  python connectors/kakao_ingest.py chat.txt --all -o inputs/messages.txt   # 필터 없이 전체
"""
from __future__ import annotations

import argparse
import os
import re

LECTURE_KW = ["강의", "특강", "세미나", "워크숍", "워크샵", "강연", "수업", "교육",
              "부탁", "진행", "주제", "대상", "커리큘럼", "강좌", "일정", "장소", "주소"]

# 카카오톡 PC/모바일 내보내기 두 형식
RE_PC = re.compile(r"^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*"
                   r"(오전|오후)?\s*\d{1,2}:\d{2},\s*(.+?)\s*:\s*(.*)$")
RE_MOBILE = re.compile(r"^\[(.+?)\]\s*\[(오전|오후)?\s*\d{1,2}:\d{2}\]\s*(.*)$")
RE_DATELINE = re.compile(r"^-+\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일.*-+$")


def parse_export(text: str) -> list[dict]:
    """카톡 export → [{sender, msg, date}]. 멀티라인 메시지는 이어붙임."""
    msgs: list[dict] = []
    cur_date = ""
    for line in text.splitlines():
        line = line.rstrip()
        if not line:
            continue
        m = RE_DATELINE.match(line)
        if m:
            cur_date = f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
            continue
        m = RE_PC.match(line)
        if m:
            cur_date = f"{int(m.group(1)):04d}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
            msgs.append({"sender": m.group(5), "msg": m.group(6), "date": cur_date})
            continue
        m = RE_MOBILE.match(line)
        if m:
            msgs.append({"sender": m.group(1), "msg": m.group(3), "date": cur_date})
            continue
        # 형식에 안 맞는 줄 = 직전 메시지의 연속(멀티라인)
        if msgs:
            msgs[-1]["msg"] += "\n" + line
    return msgs


def to_blocks(msgs: list[dict], keep_all: bool) -> list[str]:
    blocks = []
    for m in msgs:
        body = m["msg"].strip()
        if not body:
            continue
        if not keep_all and not any(k in body for k in LECTURE_KW):
            continue
        # 주의: 메시지 '전송일'은 강의 날짜가 아니므로 본문에 넣지 않는다.
        #       (강의일은 본문의 'N월 N일' 등에서 추출) — 날짜 오인식 방지.
        blocks.append(f"[카카오톡] {m['sender']}\n{body}")
    return blocks


def ocr_image(path: str) -> str:
    try:
        import pytesseract
        from PIL import Image
    except ImportError:
        raise SystemExit("❌ OCR 사용하려면: pip install pytesseract pillow + 시스템에 "
                         "tesseract 설치(한국어: tesseract-ocr-kor)")
    return pytesseract.image_to_string(Image.open(path), lang="kor+eng")


def main() -> None:
    ap = argparse.ArgumentParser(description="카톡/문자/에이닷 → 파이프라인 입력 정규화")
    ap.add_argument("input", help="카톡 export .txt 또는 (--ocr 시) 이미지")
    ap.add_argument("-o", "--output", default="inputs/messages.txt")
    ap.add_argument("--ocr", action="store_true", help="이미지에서 OCR 로 텍스트 추출")
    ap.add_argument("--all", dest="keep_all", action="store_true",
                    help="강의 키워드 필터 없이 전체 보존")
    args = ap.parse_args()

    if args.ocr:
        text = ocr_image(args.input)
    else:
        text = open(args.input, encoding="utf-8", errors="ignore").read()

    msgs = parse_export(text)
    if msgs:
        blocks = to_blocks(msgs, args.keep_all)
    else:
        # export 형식이 아니면(에이닷/SMS 붙여넣기 등) 빈 줄 기준 블록으로 통과
        raw = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
        blocks = raw if args.keep_all else [
            b for b in raw if any(k in b for k in LECTURE_KW)]

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write("\n\n".join(blocks) + "\n")
    print(f"✅ {len(blocks)}개 강의 관련 메시지 → {args.output}")
    print(f"   이제: python pipeline.py {args.output}")


if __name__ == "__main__":
    main()
