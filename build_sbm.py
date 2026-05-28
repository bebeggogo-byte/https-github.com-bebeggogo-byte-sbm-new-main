#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build sbm.html from sbm-sessions.json.

Re-runnable: reads the JSON session data and regenerates the static
SBM 모임 자료실 page, reusing the site's fonts, styles.css and nav style.
The page is review-stage draft material -> meta robots noindex.

Usage:
    python3 build_sbm.py
"""
import html
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "sbm-sessions.json")
OUT = os.path.join(HERE, "sbm.html")


def esc(s):
    return html.escape(str(s), quote=True)


def render_session(s):
    questions = "\n".join(
        f"                    <li>{esc(q)}</li>" for q in s["questions"]
    )
    return f"""\
            <article class="sbm-card" id="session-{s['no']}">
                <header class="sbm-card-head">
                    <span class="sbm-no">{s['no']:02d}회차</span>
                    <h3 class="sbm-card-title">{esc(s['title'])}</h3>
                </header>
                <div class="sbm-scripture">
                    <p class="sbm-scripture-ref">{esc(s['scripture_ref'])}</p>
                    <blockquote class="sbm-scripture-text">{esc(s['scripture_text'])}</blockquote>
                </div>
                <div class="sbm-block">
                    <h4 class="sbm-block-label">묵상</h4>
                    <p>{esc(s['meditation'])}</p>
                </div>
                <div class="sbm-block">
                    <h4 class="sbm-block-label">묵상 · 나눔 질문</h4>
                    <ol class="sbm-questions">
{questions}
                    </ol>
                </div>
                <div class="sbm-block sbm-practice">
                    <h4 class="sbm-block-label">이번 주 실천</h4>
                    <p>{esc(s['practice'])}</p>
                </div>
            </article>"""


def render_series(name, sessions):
    cards = "\n".join(render_session(s) for s in sessions)
    return f"""\
        <section class="sbm-series" aria-labelledby="series-{esc(name)}">
            <h2 class="sbm-series-title" id="series-{esc(name)}">{esc(name)}</h2>
            <div class="sbm-cards">
{cards}
            </div>
        </section>"""


def build():
    with open(DATA, encoding="utf-8") as f:
        sessions = json.load(f)

    # Preserve first-seen series order.
    order = []
    grouped = {}
    for s in sessions:
        sr = s["series"]
        if sr not in grouped:
            grouped[sr] = []
            order.append(sr)
        grouped[sr].append(s)

    series_html = "\n".join(render_series(sr, grouped[sr]) for sr in order)

    toc = "\n".join(
        f'                <li><a href="#series-{esc(sr)}">{esc(sr)} '
        f'<span class="sbm-toc-count">{len(grouped[sr])}</span></a></li>'
        for sr in order
    )

    page = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SBM 모임 자료실 — Nedabah Way</title>
    <meta name="description" content="매주 수요일 SBM 모임을 위한 말씀 묵상 → 나눔 → 실천 세션 자료 모음 (운영진 검토용 초안).">
    <!-- 검토용 초안: 색인 제외 (sitemap에서도 제외) -->
    <meta name="robots" content="noindex, follow">

    <link rel="icon" type="image/svg+xml" href="favicon.svg">

    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:wght@300;400;600&family=Noto+Serif+KR:wght@300;400;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="styles.css">

    <style>
        /* ==== SBM 자료실 (페이지 전용 레이아웃) ==== */
        .sbm-main {{
            max-width: 920px;
            margin: 0 auto;
            padding: var(--spacing-lg) var(--spacing-md) var(--spacing-xl);
        }}
        .sbm-notice {{
            background: var(--color-kraft);
            border: 1px solid var(--color-crema);
            border-left: 4px solid var(--color-terracotta);
            border-radius: var(--border-radius);
            padding: var(--spacing-sm) var(--spacing-md);
            margin-bottom: var(--spacing-lg);
            color: var(--color-stone);
            font-size: 0.95rem;
        }}
        .sbm-notice strong {{ color: var(--color-terracotta); }}
        .sbm-back {{
            display: inline-block;
            margin-bottom: var(--spacing-md);
            color: var(--color-earth);
            text-decoration: none;
            font-size: 0.95rem;
        }}
        .sbm-back:hover {{ color: var(--color-accent); }}
        .sbm-header {{ margin-bottom: var(--spacing-lg); }}
        .sbm-kicker {{
            display: block;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            font-size: 0.8rem;
            color: var(--color-earth);
            margin-bottom: var(--spacing-xs);
        }}
        .sbm-title {{
            font-family: var(--font-display);
            font-size: clamp(2rem, 5vw, 3rem);
            font-weight: 600;
            color: var(--color-espresso);
            margin: 0 0 var(--spacing-sm);
        }}
        .sbm-subtitle {{ color: var(--color-stone); line-height: 1.7; }}
        .sbm-flow {{
            color: var(--color-terracotta);
            font-weight: 600;
            white-space: nowrap;
        }}
        .sbm-toc {{
            background: var(--color-sand);
            border: 1px solid var(--color-clay);
            border-radius: var(--border-radius);
            padding: var(--spacing-md);
            margin-bottom: var(--spacing-xl);
        }}
        .sbm-toc h2 {{
            font-size: 0.85rem;
            letter-spacing: 0.12em;
            text-transform: uppercase;
            color: var(--color-earth);
            margin: 0 0 var(--spacing-sm);
        }}
        .sbm-toc ul {{
            list-style: none;
            margin: 0;
            padding: 0;
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: 0.5rem 1rem;
        }}
        .sbm-toc a {{ color: var(--color-stone); text-decoration: none; }}
        .sbm-toc a:hover {{ color: var(--color-accent); }}
        .sbm-toc-count {{
            color: var(--color-earth);
            font-size: 0.8rem;
        }}
        .sbm-series {{ margin-bottom: var(--spacing-xl); scroll-margin-top: 80px; }}
        .sbm-series-title {{
            font-family: var(--font-display);
            font-size: 1.7rem;
            color: var(--color-mocha);
            border-bottom: 2px solid var(--color-clay);
            padding-bottom: var(--spacing-xs);
            margin-bottom: var(--spacing-md);
        }}
        .sbm-cards {{
            display: flex;
            flex-direction: column;
            gap: var(--spacing-md);
        }}
        .sbm-card {{
            background: var(--color-light);
            border: 1px solid var(--color-clay);
            border-radius: var(--border-radius);
            padding: var(--spacing-md);
            scroll-margin-top: 80px;
        }}
        .sbm-card-head {{
            display: flex;
            align-items: baseline;
            gap: var(--spacing-sm);
            margin-bottom: var(--spacing-sm);
            flex-wrap: wrap;
        }}
        .sbm-no {{
            background: var(--color-mocha);
            color: var(--color-light);
            font-size: 0.78rem;
            letter-spacing: 0.05em;
            padding: 0.2rem 0.6rem;
            border-radius: var(--border-radius);
            flex: none;
        }}
        .sbm-card-title {{
            font-family: var(--font-display);
            font-size: 1.35rem;
            color: var(--color-espresso);
            margin: 0;
        }}
        .sbm-scripture {{
            background: var(--color-sand);
            border-radius: var(--border-radius);
            padding: var(--spacing-sm) var(--spacing-md);
            margin-bottom: var(--spacing-sm);
        }}
        .sbm-scripture-ref {{
            font-weight: 600;
            color: var(--color-terracotta);
            margin: 0 0 0.4rem;
            font-size: 0.95rem;
        }}
        .sbm-scripture-text {{
            margin: 0;
            color: var(--color-stone);
            font-style: italic;
            line-height: 1.7;
            border: none;
            padding: 0;
        }}
        .sbm-block {{ margin-bottom: var(--spacing-sm); }}
        .sbm-block p {{ color: var(--color-night); line-height: 1.8; margin: 0; }}
        .sbm-block-label {{
            font-size: 0.8rem;
            letter-spacing: 0.1em;
            text-transform: uppercase;
            color: var(--color-earth);
            margin: 0 0 0.4rem;
        }}
        .sbm-questions {{
            margin: 0;
            padding-left: 1.4rem;
            color: var(--color-night);
            line-height: 1.8;
        }}
        .sbm-questions li {{ margin-bottom: 0.2rem; }}
        .sbm-practice {{
            background: var(--color-cream);
            border-left: 3px solid var(--color-amber);
            border-radius: var(--border-radius);
            padding: var(--spacing-sm) var(--spacing-md);
        }}
        .sbm-practice .sbm-block-label {{ color: var(--color-mocha); }}
        .sbm-footer {{
            text-align: center;
            padding: var(--spacing-md);
            color: var(--color-earth);
            font-size: 0.9rem;
            border-top: 1px solid var(--color-clay);
        }}
    </style>
</head>
<body>
    <!-- Navigation -->
    <nav class="nav">
        <div class="nav-container">
            <a href="index.html" class="logo">NEDABAH WAY</a>
            <div class="nav-links">
                <a href="index.html#programs">프로그램</a>
                <a href="index.html#drip-lines">Drip Lines</a>
                <a href="sbm.html" class="nav-cta">SBM 자료실</a>
            </div>
        </div>
    </nav>

    <main class="sbm-main">
        <a href="index.html" class="sbm-back">← 메인으로</a>

        <div class="sbm-notice" role="note">
            <strong>운영진 검토용 초안</strong> — 공개 전 신학적 검수가 필요합니다.
            본 자료는 자동 생성된 초안이며 색인에서 제외(noindex)되어 있습니다.
        </div>

        <header class="sbm-header">
            <span class="sbm-kicker">SBM 모임 자료실</span>
            <h1 class="sbm-title">SBM 모임 자료실</h1>
            <p class="sbm-subtitle">
                매주 수요일, <span class="sbm-flow">말씀 묵상 → 나눔 → 실천</span>을 한 흐름으로 이어가는
                모임을 위한 세션 모음입니다. 총 {len(sessions)}개의 세션을 주제별 시리즈로 묶었습니다.
            </p>
        </header>

        <nav class="sbm-toc" aria-label="시리즈 목차">
            <h2>시리즈 목차</h2>
            <ul>
{toc}
            </ul>
        </nav>

{series_html}

        <footer class="sbm-footer">
            <p>© 2026 Nedabah Way · SBM 모임 자료실 (검토용 초안)</p>
            <p><a href="index.html" class="sbm-back" style="margin:0;">← 메인으로</a></p>
        </footer>
    </main>
</body>
</html>
"""

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(page)

    print(f"built {OUT}: {len(sessions)} sessions, {len(order)} series")


if __name__ == "__main__":
    build()
