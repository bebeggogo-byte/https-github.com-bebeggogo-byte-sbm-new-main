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
    """corner 영역에서 배경과 다른 픽셀(로고/글자)을 마스킹해 인페인트."""
    H, W = img.shape[:2]
    rh, rw = int(H * hf), int(W * wf)
    y0 = H - rh if "b" in corner else 0
    y1 = H if "b" in corner else rh
    x0 = W - rw if "r" in corner else 0
    x1 = W if "r" in corner else rw

    roi = img[y0:y1, x0:x1]
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    # 배경색 추정: ROI 가장자리(로고가 없는 쪽)의 중앙값
    border = np.concatenate([gray[0, :], gray[-1, :], gray[:, 0], gray[:, -1]])
    bg = int(np.median(border))
    # 배경과 충분히 다른 픽셀 = 로고/글자
    mask_roi = (np.abs(gray.astype(int) - bg) > thresh).astype(np.uint8) * 255
    if mask_roi.sum() == 0:
        return img  # 지울 것 없음
    # 마스크를 약간 키워 글자 경계까지 확실히 덮기
    mask_roi = cv2.dilate(mask_roi, np.ones((pad, pad), np.uint8), iterations=1)

    full_mask = np.zeros((H, W), np.uint8)
    full_mask[y0:y1, x0:x1] = mask_roi
    # TELEA 인페인팅: 마스크 영역을 주변 배경으로 복원
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
    ap.add_argument("--h", type=float, default=0.14, help="코너 높이 비율(기본 0.14)")
    ap.add_argument("--w", type=float, default=0.32, help="코너 너비 비율(기본 0.32)")
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
