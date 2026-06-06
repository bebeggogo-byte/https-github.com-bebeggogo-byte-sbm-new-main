"""
강의 일정 파서
================
카카오톡 / 문자 / 에이닷(A.dot) 통화요약 텍스트를 받아
강의 일정(제목/날짜/시간/장소/주소/대상/시간(분)/주제)을 구조화된 JSON 으로 추출합니다.

기본 동작은 규칙기반(정규식) 파서로 인터넷/API 없이 동작합니다.
환경변수 ANTHROPIC_API_KEY 가 설정되어 있으면 --ai 옵션으로
Claude 를 사용해 더 정확하게(불확실한 항목은 사실확인 메모와 함께) 추출합니다.

사용법:
    python parse_schedule.py inputs/sample_messages.txt -o output/events.json
    python parse_schedule.py inputs/sample_messages.txt -o output/events.json --ai
"""
from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass, asdict, field
from datetime import datetime, timedelta

DEFAULT_YEAR = 2026  # 연도 미기재 시 기본값 (currentDate 기준)
DEFAULT_DURATION_MIN = 90

WEEKDAYS = {0: "월", 1: "화", 2: "수", 3: "목", 4: "금", 5: "토", 6: "일"}

# 강의를 암시하는 키워드 — 메시지가 강의 일정인지 판단
LECTURE_KEYWORDS = [
    "강의", "특강", "세미나", "워크숍", "워크샵", "강연", "수업", "교육",
    "부탁", "진행", "주제", "대상", "커리큘럼", "강좌",
]


@dataclass
class Event:
    title: str = ""
    subject: str = ""          # 주제(따옴표 안 내용 등)
    date: str = ""             # YYYY-MM-DD
    start_time: str = ""       # HH:MM (24h)
    duration_min: int = DEFAULT_DURATION_MIN
    location: str = ""         # 장소명
    address: str = ""          # 도로명/지번 주소
    audience: str = ""         # 대상
    source: str = ""           # 출처(카톡/문자/에이닷)
    raw: str = ""              # 원문 블록
    needs_review: list = field(default_factory=list)  # 사실확인 필요 항목

    def weekday_kor(self) -> str:
        if not self.date:
            return ""
        try:
            d = datetime.strptime(self.date, "%Y-%m-%d")
            return WEEKDAYS[d.weekday()]
        except ValueError:
            return ""


def split_blocks(text: str) -> list[str]:
    """주석(#) 제거 후, 빈 줄 또는 [출처] 헤더 기준으로 메시지 블록 분리."""
    lines = [ln for ln in text.splitlines() if not ln.lstrip().startswith("#")]
    cleaned = "\n".join(lines)
    # [..] 로 시작하는 헤더 앞에 구분자 삽입
    cleaned = re.sub(r"\n(?=\s*\[)", "\n\x00", cleaned)
    blocks = []
    for chunk in cleaned.split("\x00"):
        # 빈 줄 2개 이상으로도 분리
        for sub in re.split(r"\n\s*\n", chunk):
            sub = sub.strip()
            if sub:
                blocks.append(sub)
    return blocks


def detect_source(block: str) -> str:
    m = re.match(r"\[(.*?)\]", block)
    if not m:
        return "미상"
    tag = m.group(1)
    if "카카오" in tag or "카톡" in tag:
        return "카카오톡"
    if "문자" in tag or "SMS" in tag.upper():
        return "문자"
    if "dot" in tag.lower() or "에이닷" in tag or "A.dot" in tag:
        return "에이닷"
    return tag


WEEKDAY_IDX = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6}


def parse_relative_date(block: str, ev: Event) -> bool:
    """상대 날짜(내일/모레/이번주·다음주 요일)를 오늘 기준으로 해석."""
    today = datetime.now()
    if "모레" in block:
        ev.date = (today + timedelta(days=2)).strftime("%Y-%m-%d")
    elif "내일" in block:
        ev.date = (today + timedelta(days=1)).strftime("%Y-%m-%d")
    else:
        m = re.search(r"(이번\s*주|다음\s*주|담주|다다음\s*주)?\s*([월화수목금토일])요일", block)
        if not m:
            # '셋째 주' 등 모호한 표현은 해석 불가 → 호출측에서 실패 처리
            return False
        wk = WEEKDAY_IDX[m.group(2)]
        base = today + timedelta(days=(wk - today.weekday()) % 7)
        kind = (m.group(1) or "").replace(" ", "")
        if kind in ("다음주", "담주"):
            base += timedelta(days=7)
        elif kind == "다다음주":
            base += timedelta(days=14)
        ev.date = base.strftime("%Y-%m-%d")
    ev.needs_review.append(f"상대 날짜 해석(오늘 기준) → {ev.date} 확인 필요")
    return True


def parse_date(block: str, ev: Event) -> None:
    # 2026-06-12 / 2026.6.12 / 2026/6/12
    m = re.search(r"(20\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})", block)
    if m:
        y, mo, d = map(int, m.groups())
        ev.date = f"{y:04d}-{mo:02d}-{d:02d}"
        return
    # 2026년 6월 12일 (한글 연도 명시)
    m = re.search(r"(20\d{2})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일", block)
    if m:
        y, mo, d = map(int, m.groups())
        ev.date = f"{y:04d}-{mo:02d}-{d:02d}"
        return
    # 6월 12일
    m = re.search(r"(\d{1,2})\s*월\s*(\d{1,2})\s*일", block)
    if m:
        mo, d = int(m.group(1)), int(m.group(2))
        ev.date = f"{DEFAULT_YEAR:04d}-{mo:02d}-{d:02d}"
        ev.needs_review.append("연도 미기재 → 기본 연도 사용 (확인 필요)")
        return
    # 6/12 또는 6.12 (요일 힌트 옆)
    m = re.search(r"\b(\d{1,2})[./](\d{1,2})\b", block)
    if m:
        mo, d = int(m.group(1)), int(m.group(2))
        if 1 <= mo <= 12 and 1 <= d <= 31:
            ev.date = f"{DEFAULT_YEAR:04d}-{mo:02d}-{d:02d}"
            ev.needs_review.append("연도 미기재 → 기본 연도 사용 (확인 필요)")
            return
    # 절대 날짜가 없으면 상대 날짜(내일/다음주 화요일 등) 시도
    parse_relative_date(block, ev)


def parse_time(block: str, ev: Event) -> None:
    # 14:00 / 19:00
    m = re.search(r"\b(\d{1,2}):(\d{2})\b", block)
    if m:
        ev.start_time = f"{int(m.group(1)):02d}:{m.group(2)}"
        return
    # 오후 2시 / 오전 10시 / 오후 2시 30분
    m = re.search(r"(오전|오후)?\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분)?", block)
    if m:
        ampm, hh, mm = m.group(1), int(m.group(2)), int(m.group(3) or 0)
        if ampm == "오후" and hh < 12:
            hh += 12
        if ampm == "오전" and hh == 12:
            hh = 0
        ev.start_time = f"{hh:02d}:{mm:02d}"


def parse_duration(block: str, ev: Event) -> None:
    m = re.search(r"(\d+)\s*시간", block)
    if m:
        ev.duration_min = int(m.group(1)) * 60
        return
    m = re.search(r"(\d+)\s*분", block)
    if m and int(m.group(1)) >= 30:
        ev.duration_min = int(m.group(1))


def parse_subject_title(block: str, ev: Event) -> None:
    # 따옴표 안의 주제
    m = re.search(r"[\"“'']([^\"”'']{4,60})[\"”'']", block)
    if m:
        ev.subject = m.group(1).strip()
    # 제목: 강의/특강/세미나/워크숍 종류 + 주제
    kind = None
    for k in ["특강", "세미나", "워크숍", "워크샵", "강연", "강좌", "교육", "수업", "강의"]:
        if k in block:
            kind = k.replace("워크샵", "워크숍")
            break
    if ev.subject and kind:
        ev.title = f"{ev.subject} ({kind})"
    elif ev.subject:
        ev.title = ev.subject
    elif kind:
        ev.title = kind
    else:
        ev.title = "강의 일정"
        ev.needs_review.append("제목 추출 실패 → 수동 확인 필요")


def _clean(s: str) -> str:
    """꼬리 조사/서술어(입니다, 이에요 등)와 앞쪽 시간표현 군더더기 제거."""
    s = s.strip()
    # 앞쪽 시간 표현 제거: '오후 2시에', '오전 10시', '14:00' 등
    s = re.sub(r"^(오전|오후)?\s*\d{1,2}(:\d{2}|\s*시)(\s*\d{1,2}\s*분)?\s*(에)?\s*", "", s)
    s = re.sub(r"(입니다|이에요|예요|이고|이며|임|이다)\.?$", "", s).strip()
    return s.rstrip(" .,은는이가")


def parse_location(block: str, ev: Event) -> None:
    # 주소: ... / 주소는 ...
    m = re.search(r"주소[:는은]?\s*([^\n.,]+)", block)
    if m:
        ev.address = _clean(m.group(1))
    # 장소: ...  또는 '~에서' (공백 포함 전체 명칭 포착)
    JUNK = ("추후", "미정", "문자", "연락", "보내", "알려", "조율", "예정", "정해")
    m = re.search(r"장소[:는은]?\s*([^\n.,]+)", block)
    if m and not any(j in m.group(1) for j in JUNK):
        ev.location = _clean(m.group(1))
    elif m:
        ev.needs_review.append("장소 미정(추후 통보) → 확인 필요")
    else:
        # 시설어로 끝나는 토큰을 만나면 그 토큰까지 포함해 '에서' 앞 전체를 장소로
        m = re.search(
            r"([가-힣A-Za-z0-9]+(?:\s[가-힣A-Za-z0-9]+){0,3}"
            r"(?:교회|회관|센터|성당|강당|홀|카페|학교|대학교|교육관|기념관|관|실|층))\s*(?:에서|에)",
            block)
        if m:
            ev.location = _clean(m.group(1))
    already = any("장소" in r for r in ev.needs_review)
    if not ev.address and not ev.location and not already:
        ev.needs_review.append("장소/주소 추출 실패 → 확인 필요")


def check_weekday(block: str, ev: Event) -> None:
    """메시지에 적힌 요일과 추출된 날짜의 실제 요일이 다르면 사실확인 플래그."""
    if not ev.date:
        return
    m = re.search(r"([월화수목금토일])\s*요일|\(([월화수목금토일])\)", block)
    stated = (m.group(1) or m.group(2)) if m else None
    if stated and stated != ev.weekday_kor():
        ev.needs_review.append(
            f"요일 불일치: 메시지='{stated}요일' vs {ev.date}=실제 '{ev.weekday_kor()}요일' → 날짜/연도 확인")


def parse_audience(block: str, ev: Event) -> None:
    m = re.search(r"대상[은는:]?\s*([^\n.,]+)", block)
    if m:
        # 대상 뒤에 이어지는 다른 정보(주소/장소/연결어)에서 끊어준다.
        a = re.split(r"\s*(?:이고|이며|이구|고\s|그리고|주소|장소|에서|입니다)", m.group(1))[0]
        ev.audience = _clean(a)
        return
    # '대상' 단어가 없어도 '학부모 50명 / 교사 25명 / 한 40명' 같은 표현 포착
    m = re.search(r"([가-힣]{2,}\s*)?(?:한\s*)?(\d{1,4})\s*명", block)
    if m:
        role = re.sub(r"(인원|총|약|한|모두|대략|예상|정도)\s*", "", (m.group(1) or "")).strip()
        ev.audience = _clean(f"{role} {m.group(2)}명".strip())


def is_lecture(block: str) -> bool:
    return any(k in block for k in LECTURE_KEYWORDS)


def parse_block(block: str) -> Event | None:
    if not is_lecture(block):
        return None
    ev = Event(source=detect_source(block), raw=block)
    parse_date(block, ev)
    parse_time(block, ev)
    parse_duration(block, ev)
    parse_subject_title(block, ev)
    parse_location(block, ev)
    parse_audience(block, ev)
    check_weekday(block, ev)
    if not ev.date:
        ev.needs_review.append("날짜 추출 실패 → 확인 필요")
    if not ev.start_time:
        ev.needs_review.append("시간 추출 실패 → 확인 필요")
    return ev


def parse_with_ai(text: str) -> list[dict]:
    """ANTHROPIC_API_KEY 가 있으면 Claude 로 추출 + 사실확인."""
    import anthropic  # 지연 임포트

    client = anthropic.Anthropic()
    schema_hint = (
        "각 강의를 다음 JSON 배열로만 반환: "
        '[{"title","subject","date(YYYY-MM-DD)","start_time(HH:MM 24h)",'
        '"duration_min","location","address","audience","source",'
        '"needs_review":[불확실하거나 사실확인이 필요한 항목 설명]}]. '
        f"연도가 없으면 {DEFAULT_YEAR}년으로 가정하고 needs_review 에 기록. "
        "주소가 불완전하면 알고 있는 사실에 근거해 보완하되 추정한 부분은 needs_review 에 명시."
    )
    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=2000,
        system="너는 한국어 강의 일정 추출기다. JSON 배열만 출력한다.",
        messages=[{"role": "user", "content": f"{schema_hint}\n\n---\n{text}"}],
    )
    out = msg.content[0].text.strip()
    out = re.sub(r"^```json|^```|```$", "", out, flags=re.MULTILINE).strip()
    return json.loads(out)


def main() -> None:
    ap = argparse.ArgumentParser(description="강의 일정 파서 (카톡/문자/에이닷 → JSON)")
    ap.add_argument("input", help="메시지 텍스트 파일")
    ap.add_argument("-o", "--output", default="output/events.json")
    ap.add_argument("--ai", action="store_true", help="Claude 로 정밀 추출 (ANTHROPIC_API_KEY 필요)")
    args = ap.parse_args()

    text = open(args.input, encoding="utf-8").read()

    if args.ai and os.getenv("ANTHROPIC_API_KEY"):
        events = parse_with_ai(text)
    else:
        if args.ai:
            print("⚠️  ANTHROPIC_API_KEY 미설정 — 규칙기반 파서로 대체합니다.")
        events = []
        for block in split_blocks(text):
            ev = parse_block(block)
            if ev:
                d = asdict(ev)
                d["weekday"] = ev.weekday_kor()
                events.append(d)

    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    json.dump(events, open(args.output, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)
    print(f"✅ {len(events)}개 강의 일정 추출 → {args.output}")
    for e in events:
        flag = "  ⚠️ 확인필요" if e.get("needs_review") else ""
        print(f"   • {e.get('date','?')} {e.get('start_time','?')} | {e.get('title','?')}{flag}")


if __name__ == "__main__":
    main()
