"""
대상별 접근 프로파일 엔진
==========================
강의 '대상(audience)'에 따라 커리큘럼·슬라이드의 톤/구성/밀도/어휘를
자동으로 다르게 잡습니다. (공공기관 ↔ 학생 ↔ 일반)

- audiences.json 의 match 키워드로 자동 분류
- AI 집필(--ai) 시 이 프로파일을 지침으로 주입 → 대상 맞춤 본문
- 규칙 기반 생성에도 구조(structure)를 반영

CLI:
  python audience.py classify "중학생 30명"     # → students
  python audience.py show public
"""
from __future__ import annotations

import json
import os
import sys

PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "audiences.json")


def load() -> dict:
    raw = json.load(open(PATH, encoding="utf-8"))
    return {k: v for k, v in raw.items() if not k.startswith("_")}


def classify(audience_text: str) -> str:
    text = (audience_text or "").lower()
    profiles = load()
    best, best_score = "general", 0
    for name, p in profiles.items():
        if name == "general":
            continue
        score = sum(1 for kw in p.get("match", []) if kw and kw.lower() in text)
        if score > best_score:
            best, best_score = name, score
    return best


def get(name: str) -> dict:
    return load().get(name, load()["general"])


def resolve(event: dict) -> tuple[str, dict]:
    name = classify(event.get("audience", ""))
    return name, get(name)


def ai_guidance(name: str) -> str:
    """AI 집필에 주입할 대상 맞춤 지침 문자열."""
    p = get(name)
    return (f"[대상: {p['display']}] 톤={p['tone']}; 어휘={p['vocab']}; "
            f"슬라이드밀도={p['slide_density']}; 상호작용={p['interaction']}; "
            f"예시={p['examples']}; 학습목표 스타일={p['objective_style']}; "
            f"권장 구성={' → '.join(p['structure'])}.")


def _cli() -> None:
    if len(sys.argv) < 2:
        print(__doc__); return
    if sys.argv[1] == "classify":
        name = classify(sys.argv[2] if len(sys.argv) > 2 else "")
        print(f"{name}  ({get(name)['display']})")
    elif sys.argv[1] == "show":
        print(json.dumps(get(sys.argv[2]), ensure_ascii=False, indent=2))
    elif sys.argv[1] == "list":
        for n, p in load().items():
            print(f"  {n:10} {p['display']}  (키워드 {len(p.get('match',[]))}개)")


if __name__ == "__main__":
    _cli()
