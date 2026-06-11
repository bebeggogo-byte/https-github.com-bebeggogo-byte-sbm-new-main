"""
NotebookLM 배지 '지우개' 제거 (정밀 — 배지만 지움)
====================================================
캔바 지우개처럼 '지정한 대상만' 지웁니다. 동작 원리:

  • PPTX(기본, badge 모드): 노트북LM 배지는 모든 장에서 같은 위치·같은 픽셀이므로,
    '전 슬라이드에 공통으로 나타나는 전경 픽셀'만 배지로 식별해 인페인트.
    → 한 장에만 있는 글자·선·도형은 공통이 아니므로 절대 건드리지 않음.
  • 단일 이미지/PDF: 저장된 배지 템플릿(tools/templates/)을 매칭해 그 픽셀만 제거.
  • region 모드(--mode region): 예전 방식(코너 영역 일괄) — 비권장, 특수용.

사용법:
  python tools/erase_watermark.py deck.pptx -o deck_clean.pptx          # 배지만 제거(권장)
  python tools/erase_watermark.py slide.png -o slide_clean.png          # 템플릿 매칭
  python tools/erase_watermark.py deck.pdf  -o deck_clean.pdf
"""
from __future__ import annotations

import argparse
import os
import shutil
import zipfile

import cv2
import numpy as np

TPL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")

# 배지 탐지 영역(우하단): 높이 10%, 너비 22%
BAND_H, BAND_W = 0.10, 0.22
CONSENSUS = 0.8          # 이 비율 이상의 슬라이드에 공통이면 배지
FG_THRESH = 20           # 배경 대비 전경 임계
DILATE = 3               # 마스크 확장(px)


def _gray(img: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)


def _fg_mask(region: np.ndarray) -> np.ndarray:
    g = _gray(region)
    bg = int(np.median(np.concatenate([g[:, :3].ravel(), g[:3, :].ravel()])))
    return np.abs(g.astype(int) - bg) > FG_THRESH


def _inpaint(img: np.ndarray, mask: np.ndarray) -> np.ndarray:
    m = cv2.dilate((mask * 255).astype(np.uint8),
                   np.ones((DILATE, DILATE), np.uint8))
    return cv2.inpaint(img, m, 4, cv2.INPAINT_TELEA)


# ---------------------------------------------------------------- badge 모드
def consensus_badge_mask(imgs: list[np.ndarray]) -> np.ndarray | None:
    """같은 해상도 슬라이드들에서 '전 장 공통 전경' = 배지 마스크(전체 좌표)."""
    H, W = imgs[0].shape[:2]
    y0, x0 = int(H * (1 - BAND_H)), int(W * (1 - BAND_W))
    stack = [_fg_mask(im[y0:, x0:]) for im in imgs]
    cons = np.mean(stack, axis=0) >= CONSENSUS
    if cons.sum() < 30:           # 배지라기엔 너무 작음 → 실패
        return None
    full = np.zeros((H, W), bool)
    full[y0:, x0:] = cons
    return full


def template_badge_mask(img: np.ndarray) -> np.ndarray | None:
    """저장된 노트북LM 배지 템플릿을 우하단에서 매칭해 마스크 생성."""
    tpl_p = os.path.join(TPL_DIR, "notebooklm_badge.png")
    msk_p = os.path.join(TPL_DIR, "notebooklm_badge_mask.png")
    if not (os.path.exists(tpl_p) and os.path.exists(msk_p)):
        return None
    tpl = cv2.imread(tpl_p, cv2.IMREAD_GRAYSCALE)
    tmask = cv2.imread(msk_p, cv2.IMREAD_GRAYSCALE) > 127
    H, W = img.shape[:2]
    g = _gray(img)
    # 우하단 사분면에서 다중 스케일 매칭
    y0, x0 = int(H * 0.75), int(W * 0.55)
    roi = g[y0:, x0:]
    best = (0.0, None, None)
    for s in (0.75, 0.9, 1.0, 1.1, 1.3, 1.6, 2.0):
        th, tw = int(tpl.shape[0] * s), int(tpl.shape[1] * s)
        if th >= roi.shape[0] or tw >= roi.shape[1] or th < 6:
            continue
        t = cv2.resize(tpl, (tw, th))
        res = cv2.matchTemplate(roi, t, cv2.TM_CCOEFF_NORMED)
        _, mx, _, loc = cv2.minMaxLoc(res)
        if mx > best[0]:
            best = (mx, loc, s)
    score, loc, s = best
    if score < 0.6 or loc is None:
        return None
    th, tw = int(tpl.shape[0] * s), int(tpl.shape[1] * s)
    m = cv2.resize((tmask * 255).astype(np.uint8), (tw, th)) > 127
    full = np.zeros((H, W), bool)
    yy, xx = y0 + loc[1], x0 + loc[0]
    full[yy:yy + th, xx:xx + tw] = m
    return full


# ---------------------------------------------------------------- region 모드(구버전)
def region_mask(img: np.ndarray, corner: str, hf: float, wf: float) -> np.ndarray:
    H, W = img.shape[:2]
    rh = max(8, int(H * hf))
    by0, by1 = (H - rh, H) if "b" in corner else (0, rh)
    band = img[by0:by1, :]
    fg = _fg_mask(band).astype(np.uint8)
    x_lo = W * (1 - wf) if "r" in corner else 0
    x_hi = W * wf if "l" in corner else W
    bh = band.shape[0]
    n, labels, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    keep = np.zeros_like(fg, bool)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        if w > W * 0.16 or h >= bh * 0.85 or area < 3:
            continue
        cx = x + w / 2
        if ("r" in corner and cx < x_lo) or ("l" in corner and cx > x_hi):
            continue
        keep[labels == i] = True
    full = np.zeros((H, W), bool)
    full[by0:by1, :] = keep
    return full


# ---------------------------------------------------------------- 파일 처리
def clean_pptx(src: str, dst: str, mode: str, **kw) -> None:
    with zipfile.ZipFile(src) as zin:
        names = zin.namelist()
        data = {n: zin.read(n) for n in names}
    media = [n for n in names if n.startswith("ppt/media/")
             and n.lower().endswith((".png", ".jpg", ".jpeg"))]
    decoded = {}
    for n in media:
        im = cv2.imdecode(np.frombuffer(data[n], np.uint8), cv2.IMREAD_COLOR)
        if im is not None:
            decoded[n] = im

    masks: dict[str, np.ndarray] = {}
    if mode == "badge":
        # 해상도별 그룹 → 공통 전경(배지) 마스크
        groups: dict[tuple, list[str]] = {}
        for n, im in decoded.items():
            groups.setdefault(im.shape[:2], []).append(n)
        for shape, ns in groups.items():
            cons = consensus_badge_mask([decoded[n] for n in ns]) if len(ns) >= 4 else None
            for n in ns:
                m = cons if cons is not None else template_badge_mask(decoded[n])
                if m is not None:
                    masks[n] = m
    else:
        for n, im in decoded.items():
            masks[n] = region_mask(im, kw.get("corner", "br"),
                                   kw.get("hf", 0.08), kw.get("wf", 0.18))

    cleaned = 0
    for n, m in masks.items():
        if m.sum() == 0:
            continue
        out = _inpaint(decoded[n], m)
        ok, buf = cv2.imencode(".png", out)
        if ok:
            data[n] = buf.tobytes()
            cleaned += 1
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for n, d in data.items():
            zout.writestr(n, d)
    print(f"✅ PPTX {cleaned}/{len(media)}장 배지 제거 → {dst}")


def clean_image(src: str, dst: str, mode: str, **kw) -> None:
    img = cv2.imread(src)
    if img is None:
        raise SystemExit(f"❌ 이미지 못 읽음: {src}")
    m = template_badge_mask(img) if mode == "badge" else \
        region_mask(img, kw.get("corner", "br"), kw.get("hf", 0.08), kw.get("wf", 0.18))
    if m is None or m.sum() == 0:
        print("⚠️ 배지를 찾지 못함 — 원본 그대로 저장")
        shutil.copy(src, dst)
        return
    cv2.imwrite(dst, _inpaint(img, m))
    print(f"✅ 배지 제거 → {dst}")


def clean_pdf(src: str, dst: str, mode: str, dpi: int = 150, **kw) -> None:
    import fitz
    doc = fitz.open(src)
    pages = []
    for page in doc:
        pix = page.get_pixmap(dpi=dpi)
        im = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
        im = cv2.cvtColor(im, cv2.COLOR_RGB2BGR) if pix.n >= 3 else cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
        pages.append(im)
    if mode == "badge" and len(pages) >= 4:
        cons = consensus_badge_mask(pages)
        get_mask = lambda im: cons
    else:
        get_mask = template_badge_mask if mode == "badge" else \
            (lambda im: region_mask(im, kw.get("corner", "br"), kw.get("hf", 0.08), kw.get("wf", 0.18)))
    out = fitz.open()
    n_clean = 0
    for page, im in zip(doc, pages):
        m = get_mask(im)
        if m is not None and m.sum() > 0:
            im = _inpaint(im, m); n_clean += 1
        ok, buf = cv2.imencode(".png", im)
        rect = page.rect
        np_ = out.new_page(width=rect.width, height=rect.height)
        np_.insert_image(rect, stream=buf.tobytes())
    out.save(dst)
    print(f"✅ PDF {n_clean}/{len(pages)}쪽 배지 제거 → {dst}")


def main() -> None:
    ap = argparse.ArgumentParser(description="NotebookLM 배지 지우개(배지만 정밀 제거)")
    ap.add_argument("input")
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--mode", default="badge", choices=["badge", "region"],
                    help="badge=배지만(기본·권장) / region=코너 일괄(구방식)")
    ap.add_argument("--corner", default="br")
    ap.add_argument("--h", dest="hf", type=float, default=0.08)
    ap.add_argument("--w", dest="wf", type=float, default=0.18)
    args = ap.parse_args()

    kw = dict(corner=args.corner, hf=args.hf, wf=args.wf)
    ext = os.path.splitext(args.input)[1].lower()
    if ext == ".pptx":
        clean_pptx(args.input, args.output, args.mode, **kw)
    elif ext == ".pdf":
        clean_pdf(args.input, args.output, args.mode, **kw)
    else:
        clean_image(args.input, args.output, args.mode, **kw)


if __name__ == "__main__":
    main()
