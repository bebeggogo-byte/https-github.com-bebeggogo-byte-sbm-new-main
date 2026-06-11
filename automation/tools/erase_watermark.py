"""
워터마크/로고 '지우개' 제거 (인페인팅)
========================================
슬라이드 이미지의 특정 영역(보통 오른쪽 하단 로고)을 '덮는' 게 아니라
그 픽셀을 추출·삭제하고 주변 배경으로 자연스럽게 복원(inpaint)합니다.

대상: PNG/JPG 이미지, PDF(페이지 래스터), PPTX(내장 슬라이드 이미지) 모두.
노트북LM이 만든 슬라이드(이미지 레이어)의 로고 제거에 적합합니다.

사용법:
  python tools/erase_watermark.py slide.png -o slide_clean.png
  python tools/erase_watermark.py deck.pdf  -o deck_clean.pdf
  python tools/erase_watermark.py deck.pptx -o deck_clean.pptx
  # 영역 조정(기본: 하단 14% × 우측 32%):
  python tools/erase_watermark.py s.png --corner br --h 0.14 --w 0.32 -o out.png
"""
from __future__ import annotations

import argparse
import io
import os
import shutil
import zipfile

import cv2
import numpy as np


def erase_region(img: np.ndarray, corner: str, hf: float, wf: float,
                 thresh: int, pad: int) -> np.ndarray:
    """코너의 '로고 같은' 작고 고립된 덩어리만 골라 인페인트.
    가로로 길거나(밑줄/박스 가로변) 세로로 긴(박스 세로변) 선은 보존한다."""
    H, W = img.shape[:2]
    # 탐지 밴드: 코너의 세로 범위를 '전체 너비'로 잡아, 가로로 뻗는 박스선을
    # 하나의 큰 컴포넌트로 인식해 제외할 수 있게 한다.
    rh = max(8, int(H * hf))
    by0 = H - rh if "b" in corner else 0
    by1 = H if "b" in corner else rh
    band = img[by0:by1, :]
    gray = cv2.cvtColor(band, cv2.COLOR_BGR2GRAY)
    # 배경색 = 밴드 좌/우 가장자리(로고 없는 쪽)의 중앙값
    edge = np.concatenate([gray[:, :3].ravel(), gray[:, -3:].ravel()])
    bg = int(np.median(edge))
    fg = (np.abs(gray.astype(int) - bg) > thresh).astype(np.uint8)
    if fg.sum() == 0:
        return img

    # 코너 가로 위치 한계(로고가 있어야 할 영역)
    x_lo = W * (1 - wf) if "r" in corner else 0
    x_hi = W * wf if "l" in corner else W
    bh = band.shape[0]

    n, labels, stats, _ = cv2.connectedComponentsWithStats(fg, 8)
    keep = np.zeros_like(fg)
    for i in range(1, n):
        x, y, w, h, area = stats[i]
        # 1) 너무 넓음 → 가로 선/박스 가로변 → 보존(제외)
        if w > W * 0.16:
            continue
        # 2) 밴드 높이를 거의 꽉 채움 → 세로 선/박스 세로변 → 보존(제외)
        if h >= bh * 0.85:
            continue
        # 3) 코너 영역 밖 → 제외
        cx = x + w / 2
        if "r" in corner and cx < x_lo:
            continue
        if "l" in corner and cx > x_hi:
            continue
        # 4) 면적이 지나치게 작은 잡티(점)는 무시(선택)
        if area < 3:
            continue
        keep[labels == i] = 255

    if keep.sum() == 0:
        return img
    keep = cv2.dilate(keep, np.ones((pad, pad), np.uint8), iterations=1)

    full_mask = np.zeros((H, W), np.uint8)
    full_mask[by0:by1, :] = keep
    return cv2.inpaint(img, full_mask, 4, cv2.INPAINT_TELEA)


def _decode(data: bytes) -> np.ndarray | None:
    arr = np.frombuffer(data, np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def clean_image_bytes(data: bytes, **kw) -> bytes | None:
    img = _decode(data)
    if img is None:
        return None
    out = erase_region(img, **kw)
    ok, buf = cv2.imencode(".png", out)
    return buf.tobytes() if ok else None


def clean_image_file(src: str, dst: str, **kw) -> None:
    img = cv2.imread(src)
    if img is None:
        raise SystemExit(f"❌ 이미지 못 읽음: {src}")
    cv2.imwrite(dst, erase_region(img, **kw))
    print(f"✅ 이미지 제거 완료 → {dst}")


def clean_pdf(src: str, dst: str, dpi: int = 150, **kw) -> None:
    import fitz
    doc = fitz.open(src)
    out = fitz.open()
    for page in doc:
        pix = page.get_pixmap(dpi=dpi)
        img = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, pix.n)
        img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR) if pix.n >= 3 else cv2.cvtColor(img, cv2.COLOR_GRAY2BGR)
        cleaned = erase_region(img, **kw)
        ok, buf = cv2.imencode(".png", cleaned)
        rect = page.rect
        npage = out.new_page(width=rect.width, height=rect.height)
        npage.insert_image(rect, stream=buf.tobytes())
    out.save(dst)
    print(f"✅ PDF {len(doc)}쪽 로고 제거 → {dst}")


def clean_pptx(src: str, dst: str, **kw) -> None:
    """PPTX 내장 슬라이드 이미지(ppt/media/*)의 코너 로고를 제거."""
    shutil.copy(src, dst)
    cleaned = 0
    with zipfile.ZipFile(src) as zin:
        names = zin.namelist()
        media = [n for n in names if n.startswith("ppt/media/")
                 and n.lower().endswith((".png", ".jpg", ".jpeg"))]
        data = {n: zin.read(n) for n in names}
    for n in media:
        out = clean_image_bytes(data[n], **kw)
        if out:
            data[n] = out
            cleaned += 1
    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for n, d in data.items():
            zout.writestr(n, d)
    print(f"✅ PPTX 내장 이미지 {cleaned}개 로고 제거 → {dst}")


def main() -> None:
    ap = argparse.ArgumentParser(description="슬라이드 로고/워터마크 지우개(인페인팅)")
    ap.add_argument("input")
    ap.add_argument("-o", "--output", required=True)
    ap.add_argument("--corner", default="br", help="br/bl/tr/tl (기본 br=우하단)")
    ap.add_argument("--h", type=float, default=0.08, help="탐지 밴드 높이 비율(기본 0.08)")
    ap.add_argument("--w", type=float, default=0.18, help="로고 가로 위치 한계 비율(기본 0.18)")
    ap.add_argument("--thresh", type=int, default=28, help="배경 대비 임계값")
    ap.add_argument("--pad", type=int, default=5, help="마스크 확장(px)")
    args = ap.parse_args()

    kw = dict(corner=args.corner, hf=args.h, wf=args.w, thresh=args.thresh, pad=args.pad)
    ext = os.path.splitext(args.input)[1].lower()
    if ext == ".pdf":
        clean_pdf(args.input, args.output, **kw)
    elif ext == ".pptx":
        clean_pptx(args.input, args.output, **kw)
    else:
        clean_image_file(args.input, args.output, **kw)


if __name__ == "__main__":
    main()
