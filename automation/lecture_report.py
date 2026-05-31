"""
강의 보고서 생성 (HTML)  [고객사 테마 적용]
=============================================
강의 녹음 전사본(transcript.txt) → 클로드 분석 → 강의보고서 HTML.

분석 항목(강의보고서 형식):
  • 핵심 요약(TL;DR)   • 주요 내용 정리(구조화)   • 핵심 파악/통찰
  • 이슈 & 논점        • Q&A                      • 액션 아이템/후속
  • 전사 원문(접기)

ANTHROPIC_API_KEY 가 있으면 Claude 가 전사본을 읽고 위 항목을 채웁니다.
없으면 휴리스틱(문장 분류)으로 사용 가능한 보고서 골격을 만듭니다.
색·폰트·출처는 고객사 테마(themes/)에서 옵니다 — 슬라이드/워크지와 동일 아이덴티티.

사용법:
  python lecture_report.py transcript.txt --event output/events.json --index 0 -o output/report_00.html
  python lecture_report.py transcript.txt --title "강의명" --date 2026-06-12 -o report.html
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
from datetime import datetime

import theme as theme_mod


# ---------------------------------------------------------------- 분석
def analyze_with_ai(transcript: str, meta: dict) -> dict:
    import anthropic
    client = anthropic.Anthropic()
    schema = (
        "전사본을 분석해 강의보고서를 JSON 으로만 반환:\n"
        '{"summary":[3~5개 핵심요약],'
        '"outline":[{"heading":소주제,"points":[정리 불릿]}],'
        '"insights":[강사의 핵심 통찰/메시지],'
        '"issues":[제기된 이슈·논점·미해결 질문],'
        '"qna":[{"q":질문,"a":답변요지}],'
        '"actions":[후속 액션 아이템]}'
    )
    msg = client.messages.create(
        model="claude-opus-4-8", max_tokens=4000,
        system="너는 강의 내용을 구조적으로 정리하는 분석가다. 한국어. JSON만 출력.",
        messages=[{"role": "user", "content":
                   f"강의: {meta.get('title','')}\n{schema}\n\n--- 전사본 ---\n{transcript[:120000]}"}],
    )
    txt = re.sub(r"```json|```", "", msg.content[0].text).strip()
    return json.loads(txt)


def analyze_heuristic(transcript: str, meta: dict) -> dict:
    """API 없이도 쓸 수 있는 골격: 문장 분류 기반."""
    sents = [s.strip() for s in re.split(r"(?<=[.!?。])\s+|\n+", transcript) if s.strip()]
    issues = [s for s in sents if re.search(r"이슈|문제|논점|질문|우려|어려움|미해결|과제", s)][:8]
    qna = [{"q": s, "a": "(전사본에서 답변 부분을 확인하세요)"}
           for s in sents if s.endswith("?") or "?" in s][:6]
    # 긴 문장 위주로 요약 후보
    summary = sorted(sents, key=len, reverse=True)[:5]
    # 단락을 소주제 블록으로
    paras = [p.strip() for p in re.split(r"\n\s*\n", transcript) if p.strip()]
    outline = [{"heading": f"내용 {i+1}",
                "points": [x.strip() for x in re.split(r"(?<=[.!?。])\s+", p) if x.strip()][:6]}
               for i, p in enumerate(paras[:8])] or \
              [{"heading": "전체 내용", "points": sents[:10]}]
    return {
        "summary": summary,
        "outline": outline,
        "insights": ["⚠️ AI 분석 비활성(ANTHROPIC_API_KEY 설정 시 자동 통찰 도출). "
                     "아래 정리를 검토해 핵심 메시지를 보완하세요."],
        "issues": issues or ["전사본에서 이슈/논점 문장을 찾지 못했습니다."],
        "qna": qna,
        "actions": ["보고서 검토 및 핵심 보완", "참석자 공유", "후속 자료/모임 안내"],
    }


# ---------------------------------------------------------------- HTML
def _li(items: list[str]) -> str:
    return "\n".join(f"<li>{html.escape(str(x))}</li>" for x in items)


def render_html(data: dict, meta: dict, transcript: str, th: dict) -> str:
    pal = th["palette"]
    fonts = th["fonts"]
    label = th.get("source_label", "")
    title = meta.get("title", "강의 보고서")
    metabits = " · ".join(x for x in [
        meta.get("date", ""), meta.get("start_time", ""),
        meta.get("location") or meta.get("address", ""),
        f"대상 {meta['audience']}" if meta.get("audience") else "",
    ] if x)

    outline_html = "\n".join(
        f'<section class="block"><h3>{html.escape(o.get("heading",""))}</h3>'
        f'<ul>{_li(o.get("points", []))}</ul></section>'
        for o in data.get("outline", []))
    qna_html = "\n".join(
        f'<div class="qna"><p class="q">Q. {html.escape(q.get("q",""))}</p>'
        f'<p class="a">A. {html.escape(q.get("a",""))}</p></div>'
        for q in data.get("qna", []))

    return f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} — 강의보고서</title>
<style>
  :root {{
    --bg:#{pal['bg']}; --ink:#{pal['ink']}; --head:#{pal['heading']};
    --accent:#{pal['accent']}; --muted:#{pal['muted']}; --line:#{pal['line']};
  }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; background:var(--bg); color:var(--ink);
    font-family:'{fonts['body']}',-apple-system,'Segoe UI','Apple SD Gothic Neo',sans-serif;
    line-height:1.7; }}
  .wrap {{ max-width:860px; margin:0 auto; padding:56px 32px 80px; }}
  header {{ border-bottom:2px solid var(--line); padding-bottom:20px; margin-bottom:8px; }}
  h1 {{ font-family:'{fonts['heading']}',serif; color:var(--head);
    font-size:30px; margin:0 0 6px; letter-spacing:-.01em; }}
  .meta {{ color:var(--muted); font-size:14px; }}
  h2 {{ font-family:'{fonts['heading']}',serif; color:var(--head);
    font-size:20px; margin:40px 0 12px; }}
  h3 {{ font-size:16px; color:var(--ink); margin:18px 0 6px; }}
  .tldr {{ background:color-mix(in srgb, var(--accent) 8%, var(--bg));
    border-left:4px solid var(--accent); border-radius:8px; padding:16px 20px; margin:18px 0; }}
  ul {{ margin:6px 0; padding-left:22px; }} li {{ margin:4px 0; }}
  .block {{ margin:10px 0 18px; }}
  .issue li {{ color:var(--ink); }}
  .qna {{ border:1px solid var(--line); border-radius:8px; padding:12px 16px; margin:10px 0; }}
  .qna .q {{ font-weight:600; margin:0 0 4px; }} .qna .a {{ margin:0; color:var(--muted); }}
  .actions li {{ margin:6px 0; }}
  details {{ margin-top:28px; }} summary {{ cursor:pointer; color:var(--muted); font-size:14px; }}
  pre.transcript {{ white-space:pre-wrap; background:color-mix(in srgb, var(--line) 30%, var(--bg));
    border-radius:8px; padding:16px; font-size:13px; color:var(--ink); }}
  footer {{ margin-top:48px; text-align:right; color:var(--muted); font-size:11px;
    border-top:1px solid var(--line); padding-top:10px; }}
  @media print {{ .wrap {{ padding:24px; }} details {{ display:none; }} }}
</style></head>
<body><div class="wrap">
  <header>
    <h1>{html.escape(title)}</h1>
    <div class="meta">{html.escape(metabits)}　|　강의보고서 · 생성 {datetime.now():%Y-%m-%d}</div>
  </header>

  <h2>핵심 요약</h2>
  <div class="tldr"><ul>{_li(data.get('summary', []))}</ul></div>

  <h2>주요 내용 정리</h2>
  {outline_html}

  <h2>핵심 파악 · 통찰</h2>
  <ul>{_li(data.get('insights', []))}</ul>

  <h2>이슈 &amp; 논점</h2>
  <ul class="issue">{_li(data.get('issues', []))}</ul>

  {"<h2>Q&amp;A</h2>" + qna_html if qna_html else ""}

  <h2>정리 방법 · 액션 아이템</h2>
  <ul class="actions">{_li(data.get('actions', []))}</ul>

  <details><summary>전사 원문 보기</summary>
    <pre class="transcript">{html.escape(transcript)}</pre>
  </details>

  <footer>{html.escape(label) if label else ''}</footer>
</div></body></html>"""


# ---------------------------------------------------------------- CLI
def main() -> None:
    ap = argparse.ArgumentParser(description="강의 전사본 → 강의보고서 HTML")
    ap.add_argument("transcript", help="전사본 .txt")
    ap.add_argument("--event", help="events.json (메타·테마 자동)")
    ap.add_argument("--index", type=int, default=0)
    ap.add_argument("--title"); ap.add_argument("--date")
    ap.add_argument("--theme", help="고객사 테마 강제 지정")
    ap.add_argument("-o", "--output", default="output/report.html")
    args = ap.parse_args()

    transcript = open(args.transcript, encoding="utf-8").read()

    if args.event:
        events = json.load(open(args.event, encoding="utf-8"))
        meta = events[args.index]
    else:
        meta = {"title": args.title or "강의 보고서", "date": args.date or ""}

    th = theme_mod.resolve(meta, forced=args.theme)
    print(f"🎨 테마: {th['display_name']} — {th.get('_resolved_by','')}")

    if os.getenv("ANTHROPIC_API_KEY"):
        try:
            data = analyze_with_ai(transcript, meta)
            print("🧠 Claude 분석 완료")
        except Exception as e:
            print(f"⚠️ Claude 분석 실패({e}) → 휴리스틱 골격 사용")
            data = analyze_heuristic(transcript, meta)
    else:
        print("⚠️ ANTHROPIC_API_KEY 미설정 → 휴리스틱 골격 보고서 생성")
        data = analyze_heuristic(transcript, meta)

    out = render_html(data, meta, transcript, th)
    os.makedirs(os.path.dirname(args.output) or ".", exist_ok=True)
    open(args.output, "w", encoding="utf-8").write(out)
    print(f"✅ 강의보고서 → {args.output}")


if __name__ == "__main__":
    main()
