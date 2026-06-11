---
name: erase-logo
description: Remove the NotebookLM (or any corner) watermark/logo from PPTX, PDF, or image slides by inpainting — it erases the pixels and reconstructs the background, not a cover-up. Trigger when the user uploads or points to a NotebookLM-generated deck (or any slides) and asks to remove/erase the logo, watermark, or mark.
---

# 로고/워터마크 지우개

노트북LM 등 슬라이드의 코너 로고를 **인페인팅으로 삭제·배경 복원**한다. 덮개가 아니다.

## 절차

1. **준비(최초 1회)**: `cd automation && pip install -r requirements.txt`
   (opencv-python-headless, numpy, pymupdf, python-pptx 필요)

2. **입력 확보**: 사용자가 올린 파일 경로를 확인한다(업로드는 보통 `/root/.claude/uploads/...`).
   PPTX·PDF·PNG/JPG 모두 가능.

3. **실행** (노트북LM 로고는 우하단, 작게):
   ```bash
   cd automation
   python tools/erase_watermark.py "<입력파일>" --corner br --h 0.07 --w 0.15 --thresh 25 --pad 6 -o "output/clean/<이름>_clean.pptx"
   ```
   - 다른 위치면 `--corner bl|tr|tl`, 영역이 더 크면 `--h/--w` 키우기.

4. **전수 검사(반드시)**: 원본과 결과의 내장 이미지를 픽셀 비교해, 변경이 코너 영역
   안에만 있는지 확인한다("코너 밖 변경 0장"이어야 함). 본문/도표가 훼손되면 영역을 줄여 재실행.

5. **시각 증거 + 전달**: 슬라이드 1장의 코너 BEFORE/AFTER 비교 이미지를 만들어 보여주고,
   완성본을 `SendUserFile` 로 전달한다.

## 검증 스니펫 (참고)
```python
import zipfile, cv2, numpy as np
zo, zc = zipfile.ZipFile(ORIG), zipfile.ZipFile(CLEAN)
media = sorted(n for n in zo.namelist() if n.startswith("ppt/media/"))
outside = 0
for m in media:
    a = cv2.imdecode(np.frombuffer(zo.read(m), np.uint8), cv2.IMREAD_COLOR)
    b = cv2.imdecode(np.frombuffer(zc.read(m), np.uint8), cv2.IMREAD_COLOR)
    if a is None or b is None or a.shape != b.shape: continue
    d = (np.abs(a.astype(int) - b.astype(int)).sum(2) > 12); h, w = d.shape
    d[int(h*0.91):, int(w*0.83):] = False   # 코너 제외
    if d.sum() > 50: outside += 1
print(f"{len(media)}장 — 코너 밖 변경 {outside}장 (0=정상)")
```

도구 본체: `automation/tools/erase_watermark.py`. 전체 가이드: 루트 `CLAUDE.md`.
