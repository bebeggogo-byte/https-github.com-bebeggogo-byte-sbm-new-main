"""
강의 1건 → 커리큘럼/강의기획 PDF 생성
=======================================
일정(제목/대상/주제)을 바탕으로 강의 기획·전략·자료조사·통찰·통합내용을 담은
커리큘럼 PDF 를 만듭니다. 이 PDF 를 Google NotebookLM 에 소스로 업로드하면
관련자료 서치 → 슬라이드 제작 단계로 이어집니다.

내용은 두 가지 방식으로 생성됩니다:
  1) 기본: 구조화된 템플릿(개요/학습목표/모듈/전략/자료/통찰/평가)으로 채움
  2) --ai: ANTHROPIC_API_KEY 가 있으면 Claude 가 주제 맞춤형 본문을 작성

한글은 reportlab 내장 CID 폰트(HYSMyeongJo-Medium)로 폰트 파일 없이 출력됩니다.

사용법:
    python make_curriculum_pdf.py output/events.json --index 0 -o output/curriculum.pdf
    python make_curriculum_pdf.py output/events.json --index 0 -o output/curriculum.pdf --ai
"""
from __future__ import annotations

import argparse
import json
import os

from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from reportlab.platypus import (Paragraph, SimpleDocTemplate, Spacer, HRFlowable)

import theme as theme_mod

FONT = "HYSMyeongJo-Medium"
pdfmetrics.registerFont(UnicodeCIDFont(FONT))


def styles(pal: dict) -> dict:
    base = getSampleStyleSheet()
    ink = "#" + pal["ink"]
    return {
        "h1": ParagraphStyle("h1", parent=base["Title"], fontName=FONT, fontSize=22,
                             leading=28, textColor="#" + pal["heading"], spaceAfter=4),
        "meta": ParagraphStyle("meta", fontName=FONT, fontSize=10, leading=15,
                               textColor="#" + pal["muted"]),
        "h2": ParagraphStyle("h2", fontName=FONT, fontSize=14, leading=20,
                             textColor="#" + pal["heading"], spaceBefore=14, spaceAfter=6),
        "body": ParagraphStyle("body", fontName=FONT, fontSize=10.5, leading=17,
                               alignment=TA_LEFT, textColor=ink),
        "bullet": ParagraphStyle("bullet", fontName=FONT, fontSize=10.5, leading=17,
                                 leftIndent=12, bulletIndent=2, textColor=ink),
    }


def default_sections(e: dict) -> list[tuple[str, list[str]]]:
    title = e.get("title", "강의")
    subject = e.get("subject") or title
    audience = e.get("audience") or "참석 대상"
    dur = e.get("duration_min", 90)
    return [
        ("강의 개요", [
            f"본 강의 「{subject}」는 {audience}을(를) 대상으로 {dur}분간 진행한다.",
            "네다바웨이의 핵심 가치인 '자발성으로 시작되는 거룩을 향한 공동체의 길'을 "
            "강의 주제와 연결하여, 지식 전달을 넘어 삶의 변화와 공동체적 실천으로 이어지도록 설계한다.",
        ]),
        ("학습 목표", [
            f"{subject}의 핵심 개념과 성경적·신학적 근거를 설명할 수 있다.",
            "주제를 자신의 삶과 공동체 상황에 적용하는 구체적 실천안을 도출할 수 있다.",
            "동료 학습자와의 나눔을 통해 통합적 관점을 형성할 수 있다.",
        ]),
        ("강의 전략", [
            "도입(공감) → 전개(개념·근거) → 적용(실천) → 정리(결단) 4단계 흐름.",
            "강의 30% · 토의/질문 40% · 실습/나눔 30% 비율로 참여형 구성.",
            f"{audience}의 눈높이에 맞춘 사례와 질문을 활용해 능동적 사고를 유도.",
        ]),
        ("모듈 구성", [
            f"모듈 1 — 여는 이야기와 문제의식 ({int(dur*0.2)}분)",
            f"모듈 2 — 핵심 개념과 근거 ({int(dur*0.35)}분)",
            f"모듈 3 — 적용과 사례, 조별 나눔 ({int(dur*0.3)}분)",
            f"모듈 4 — 통합 정리와 실천 결단 ({int(dur*0.15)}분)",
        ]),
        ("자료조사·분석", [
            "성경 본문 및 1차 신학 자료 → 핵심 개념 정의의 근거로 사용.",
            "관련 통계·현장 사례 → 문제의식 환기 및 적용 단계 설득력 강화.",
            "NotebookLM 에 본 PDF 와 추가 소스를 업로드해 사실확인·요약·인용 정리.",
        ]),
        ("통찰·통합 메시지", [
            "주제를 '개인의 결단'에서 '공동체의 동행'으로 확장해 통합적 의미를 부여한다.",
            "자발성(네다바)은 강요가 아닌 사랑의 응답임을 강의 전체의 관통 메시지로 삼는다.",
        ]),
        ("평가·후속", [
            "강의 후 1줄 결단문 작성 및 공유.",
            "2주 후 실천 점검 메시지 발송, 후속 모임 또는 자료 제공으로 연결.",
        ]),
    ]


def ai_sections(e: dict) -> list[tuple[str, list[str]]]:
    import anthropic
    client = anthropic.Anthropic()
    prompt = (
        f"강의 제목: {e.get('title')}\n주제: {e.get('subject')}\n"
        f"대상: {e.get('audience')}\n시간(분): {e.get('duration_min')}\n"
        "위 강의의 커리큘럼을 JSON 으로 작성하라. "
        "형식: [[\"섹션제목\", [\"불릿1\",\"불릿2\"]], ...]. "
        "섹션: 강의 개요/학습 목표/강의 전략/모듈 구성/자료조사·분석/통찰·통합 메시지/평가·후속. "
        "네다바웨이(자발성으로 시작되는 거룩한 공동체) 가치를 반영. JSON 만 출력."
    )
    msg = client.messages.create(model="claude-opus-4-8", max_tokens=2500,
                                 messages=[{"role": "user", "content": prompt}])
    import re
    txt = re.sub(r"```json|```", "", msg.content[0].text).strip()
    return [(s[0], s[1]) for s in json.loads(txt)]


def build_pdf(e: dict, out: str, use_ai: bool, th: dict) -> None:
    pal = th["palette"]
    line_color = "#" + pal["line"]
    st = styles(pal)
    sections = ai_sections(e) if use_ai else default_sections(e)

    doc = SimpleDocTemplate(out, pagesize=A4,
                            leftMargin=22*mm, rightMargin=22*mm,
                            topMargin=20*mm, bottomMargin=18*mm,
                            title=e.get("title", "강의 커리큘럼"))
    flow = [Paragraph(e.get("title", "강의 커리큘럼"), st["h1"])]
    meta = " · ".join(x for x in [
        e.get("date", ""), e.get("start_time", ""),
        e.get("location", "") or e.get("address", ""),
        f"대상 {e.get('audience')}" if e.get("audience") else "",
    ] if x)
    if meta:
        flow.append(Paragraph(meta, st["meta"]))
    flow.append(Spacer(1, 6))
    flow.append(HRFlowable(width="100%", thickness=1, color=line_color))

    for head, bullets in sections:
        flow.append(Paragraph(head, st["h2"]))
        for b in bullets:
            flow.append(Paragraph(f"• {b}", st["bullet"]))

    label = th.get("source_label") or "강의 커리큘럼"
    flow.append(Spacer(1, 16))
    flow.append(HRFlowable(width="100%", thickness=0.5, color=line_color))
    flow.append(Paragraph(label, st["meta"]))

    doc.build(flow)


def main() -> None:
    ap = argparse.ArgumentParser(description="강의 → 커리큘럼 PDF")
    ap.add_argument("input", help="events.json")
    ap.add_argument("--index", type=int, default=0, help="대상 강의 인덱스")
    ap.add_argument("-o", "--output", default="output/curriculum.pdf")
    ap.add_argument("--theme", help="고객사 테마 강제 지정(미지정 시 자동 분류)")
    ap.add_argument("--ai", action="store_true", help="Claude 로 본문 생성")
    args = ap.parse_args()

    events = json.load(open(args.input, encoding="utf-8"))
    e = events[args.index]
    th = theme_mod.resolve(e, forced=args.theme)
    print(f"🎨 테마: {th['display_name']} — {th.get('_resolved_by','')}")
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    use_ai = args.ai and os.getenv("ANTHROPIC_API_KEY")
    if args.ai and not use_ai:
        print("⚠️  ANTHROPIC_API_KEY 미설정 — 템플릿 본문으로 대체.")
    build_pdf(e, args.output, use_ai, th)
    print(f"✅ 커리큘럼 PDF 생성 → {args.output}  (NotebookLM 소스로 업로드)")


if __name__ == "__main__":
    main()
