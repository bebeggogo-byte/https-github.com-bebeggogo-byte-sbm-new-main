"""
테마(고객사 디자인) 엔진
==========================
어떤 고객사가 와도 자동으로 분류해 그 고객사 아이덴티티(색·폰트·출처라벨)로
산출물이 나오도록 하는 디자인 토큰 시스템. (Claude 식: 흰 배경 + 절제된 1 액센트)

- themes/<name>.json  : 고객사별 브랜드 토큰
- themes/default.json : 미분류 시 기본(Claude-style)
- 자동 분류: 일정/메시지 텍스트와 각 테마의 match 키워드 점수로 결정

CLI:
    python theme.py list                       # 등록된 고객사 테마 목록
    python theme.py classify output/events.json  # 각 일정이 어느 고객사로 분류되는지
    python theme.py new acme "에이크미,acme,ACME"  # 새 고객사 테마 스캐폴딩
"""
from __future__ import annotations

import json
import os
import re
import sys

THEME_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "themes")


def _path(name: str) -> str:
    return os.path.join(THEME_DIR, f"{name}.json")


def list_themes() -> list[dict]:
    out = []
    for fn in sorted(os.listdir(THEME_DIR)):
        if fn.endswith(".json") and not fn.startswith("_") and fn != "contacts.json":
            out.append(json.load(open(os.path.join(THEME_DIR, fn), encoding="utf-8")))
    return out


def load_theme(name: str) -> dict:
    p = _path(name)
    if not os.path.exists(p):
        print(f"⚠️  테마 '{name}' 없음 → default 사용")
        p = _path("default")
    return json.load(open(p, encoding="utf-8"))


def event_text(event: dict) -> str:
    """분류에 쓸 텍스트(원문 + 주요 필드)를 합친다."""
    keys = ["raw", "title", "subject", "location", "address", "audience", "source", "client"]
    return " ".join(str(event.get(k, "")) for k in keys).lower()


def load_contacts() -> dict:
    """발신자 → 고객 테마 매핑표 (themes/contacts.json)."""
    p = os.path.join(THEME_DIR, "contacts.json")
    if not os.path.exists(p):
        return {}
    raw = json.load(open(p, encoding="utf-8"))
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def classify(event: dict) -> tuple[str, int]:
    """일정 → (테마이름, 점수). 우선순위: ①event['client'] ②발신자 연락처 ③내용 키워드."""
    forced = (event.get("client") or "").strip().lower()
    text = event_text(event)
    # ② 발신자 연락처 매핑(강한 신호) — 내용 키워드보다 우선
    for theme_name, idents in load_contacts().items():
        for ident in idents:
            if ident and ident.lower() in text:
                return theme_name, 100
    best, best_score = "default", 0
    for th in list_themes():
        if th["name"] == "default":
            continue
        if forced and forced == th["name"].lower():
            return th["name"], 999
        score = 0
        for kw in th.get("match", []):
            if kw and kw.lower() in text:
                score += 1
        if score > best_score:
            best, best_score = th["name"], score
    return best, best_score


def resolve(event: dict, forced: str | None = None) -> dict:
    """일정에 적용할 테마를 결정해 반환(자동분류 결과 메모 포함)."""
    if forced:
        th = load_theme(forced)
        th["_resolved_by"] = f"강제 지정: {forced}"
        return th
    name, score = classify(event)
    th = load_theme(name)
    th["_resolved_by"] = (f"자동분류: {name} (점수 {score})"
                          if score > 0 else "미분류 → default")
    return th


def scaffold(name: str, keywords: str) -> None:
    name = re.sub(r"[^a-z0-9_]", "", name.lower())
    if not name:
        print("❌ 영문/숫자 이름이 필요합니다.")
        return
    p = _path(name)
    if os.path.exists(p):
        print(f"❌ 이미 존재: {p}")
        return
    tmpl = json.load(open(_path("default"), encoding="utf-8"))
    tmpl["name"] = name
    tmpl["display_name"] = name
    tmpl["source_label"] = name
    tmpl["match"] = [k.strip() for k in keywords.split(",") if k.strip()]
    json.dump(tmpl, open(p, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"✅ 새 고객사 테마 생성 → {p}")
    print("   palette/fonts/source_label 을 고객사 브랜드에 맞게 수정하세요.")


def _cli() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        return
    cmd = sys.argv[1]
    if cmd == "list":
        for th in list_themes():
            print(f"  • {th['name']:14} {th['display_name']}  "
                  f"(키워드 {len(th.get('match', []))}개)")
    elif cmd == "classify":
        events = json.load(open(sys.argv[2], encoding="utf-8"))
        for e in events:
            name, score = classify(e)
            print(f"  {e.get('date','?')} {e.get('title','?')[:30]:30} → "
                  f"{name} (점수 {score})")
    elif cmd == "new":
        scaffold(sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "")
    else:
        print(__doc__)


if __name__ == "__main__":
    _cli()
