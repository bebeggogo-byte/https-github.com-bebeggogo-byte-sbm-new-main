"""
커리큘럼 → 강의 워크지(워크시트) 생성
=======================================
참석자가 강의 중/후에 작성하는 워크지를 PPTX(편집용) 와 PDF(인쇄용) 로 만듭니다.
NotebookLM 에서 다듬은 워크지 개요를 같은 형식 JSON 으로 저장하면 반복 제작이 됩니다.

슬라이드와 동일한 흰 배경 + 출처(오른쪽 하단 6pt) 스타일을 따릅니다.

사용법:
    python make_worksheet.py --from-events output/events.json --index 0 \
        -o output/worksheet.pptx --pdf output/worksheet.pdf
"""
from __future__ import annotations

import argparse
import json
import os

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Inches, Pt

WHITE = RGBColor(0xFF, 0xFF, 0xFF)
INK = RGBColor(0x2B, 0x2B, 0x2B)
BROWN = RGBColor(0x5B, 0x4A, 0x36)
GRAY = RGBColor(0x9A, 0x9A, 0x9A)
LINE = RGBColor(0xCC, 0xBE, 0xA8)
FONT = "Noto Sans KR"


def worksheet_items(e: dict) -> dict:
    subject = e.get("subject") or e.get("title", "강의")
    audience = e.get("audience") or "참석자"
    return {
        "title": f"{e.get('title','강의')} 워크지",
        "meta": " · ".join(x for x in [e.get("date",""), e.get("start_time",""),
                                       f"대상 {audience}"] if x),
        "sections": [
            ("들어가며", "오늘 이 주제에 대해 내가 가진 질문이나 기대를 적어보세요."),
            ("핵심 개념 정리", f"'{subject}'의 핵심 개념을 내 언어로 한 문장으로 요약하면?"),
            ("성경적 근거", "오늘 들은 말씀/근거 중 가장 마음에 남는 구절과 이유는?"),
            ("나의 적용", "내 삶의 어느 영역에 어떻게 적용할 수 있을까요? (구체적으로)"),
            ("공동체 적용", "우리 공동체가 함께 실천할 수 있는 한 가지는?"),
            ("한 줄 결단", "오늘 강의 후 나의 결단을 한 문장으로 적어보세요."),
        ],
    }


def _src(slide):
    box = slide.shapes.add_textbox(Inches(6.3), Inches(7.05), Inches(3.3), Inches(0.35))
    tf = box.text_frame
    tf.vertical_anchor = MSO_ANCHOR.BOTTOM
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.RIGHT
    r = p.add_run(); r.text = "네다바웨이 · Nedabah Way"
    r.font.size = Pt(6); r.font.color.rgb = GRAY; r.font.name = FONT


def build_pptx(data: dict, out: str) -> None:
    prs = Presentation()
    prs.slide_width = Inches(10); prs.slide_height = Inches(7.5)
    slide = prs.slides.add_slide(prs.slide_layouts[6])
    slide.background.fill.solid()
    slide.background.fill.fore_color.rgb = WHITE

    # 제목/메타 — 왼쪽 상단
    head = slide.shapes.add_textbox(Inches(0.55), Inches(0.4), Inches(8.9), Inches(1.0))
    tf = head.text_frame; tf.word_wrap = True
    p = tf.paragraphs[0]; r = p.add_run(); r.text = data["title"]
    r.font.size = Pt(26); r.font.bold = True; r.font.color.rgb = BROWN; r.font.name = FONT
    if data["meta"]:
        p2 = tf.add_paragraph(); r2 = p2.add_run(); r2.text = data["meta"]
        r2.font.size = Pt(11); r2.font.color.rgb = GRAY; r2.font.name = FONT

    # 섹션 — 질문 + 작성 라인
    top = 1.55
    for i, (head_t, q) in enumerate(data["sections"]):
        box = slide.shapes.add_textbox(Inches(0.6), Inches(top), Inches(8.8), Inches(0.85))
        tf = box.text_frame; tf.word_wrap = True
        p = tf.paragraphs[0]
        r = p.add_run(); r.text = f"{i+1}. {head_t}"
        r.font.size = Pt(13); r.font.bold = True; r.font.color.rgb = INK; r.font.name = FONT
        p2 = tf.add_paragraph(); r2 = p2.add_run(); r2.text = q
        r2.font.size = Pt(11); r2.font.color.rgb = GRAY; r2.font.name = FONT
        # 작성 밑줄
        from pptx.enum.shapes import MSO_SHAPE
        ln = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(0.6),
                                    Inches(top + 0.78), Inches(8.8), Pt(0.75))
        ln.fill.solid(); ln.fill.fore_color.rgb = LINE; ln.line.fill.background()
        top += 0.92

    _src(slide)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    prs.save(out)
    print(f"✅ 워크지(PPTX) → {out}")


def build_pdf(data: dict, out: str) -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfgen import canvas

    f = "HYSMyeongJo-Medium"
    pdfmetrics.registerFont(UnicodeCIDFont(f))
    c = canvas.Canvas(out, pagesize=A4)
    w, h = A4
    y = h - 25 * mm
    c.setFont(f, 18); c.setFillColorRGB(0.36, 0.29, 0.21)
    c.drawString(22 * mm, y, data["title"])
    y -= 8 * mm
    c.setFont(f, 9); c.setFillColorRGB(0.6, 0.6, 0.6)
    c.drawString(22 * mm, y, data["meta"])
    y -= 12 * mm
    for i, (head_t, q) in enumerate(data["sections"]):
        c.setFont(f, 12); c.setFillColorRGB(0.17, 0.17, 0.17)
        c.drawString(22 * mm, y, f"{i+1}. {head_t}")
        y -= 6 * mm
        c.setFont(f, 9.5); c.setFillColorRGB(0.55, 0.55, 0.55)
        c.drawString(24 * mm, y, q)
        y -= 9 * mm
        c.setStrokeColorRGB(0.8, 0.74, 0.66)
        for _ in range(2):
            c.line(24 * mm, y, w - 22 * mm, y)
            y -= 8 * mm
        y -= 4 * mm
    c.setFont(f, 6); c.setFillColorRGB(0.6, 0.6, 0.6)
    c.drawRightString(w - 22 * mm, 14 * mm, "네다바웨이 · Nedabah Way")
    c.save()
    print(f"✅ 워크지(PDF) → {out}")


def main() -> None:
    ap = argparse.ArgumentParser(description="커리큘럼 → 워크지")
    ap.add_argument("--from-events", required=True)
    ap.add_argument("--index", type=int, default=0)
    ap.add_argument("-o", "--output", default="output/worksheet.pptx")
    ap.add_argument("--pdf", help="PDF 도 함께 생성")
    args = ap.parse_args()

    events = json.load(open(args.from_events, encoding="utf-8"))
    data = worksheet_items(events[args.index])
    build_pptx(data, args.output)
    if args.pdf:
        build_pdf(data, args.pdf)


if __name__ == "__main__":
    main()
