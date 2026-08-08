---
name: erase-logo
description: Remove the NotebookLM badge/watermark from PPTX, PDF, or image slides by surgical inpainting — erases ONLY the badge pixels (cross-slide consensus or template matching), never text, lines, or shapes. Trigger when the user uploads a NotebookLM-generated deck (or any slides) and asks to remove/erase the logo, watermark, or mark.
---

# 노트북LM 배지 지우개 (배지만 정밀 제거)

캔바 지우개처럼 **지정 대상(배지)만** 지운다. 원리:
- **PPTX/PDF(4장 이상)**: 배지는 전 슬라이드 같은 위치·같은 픽셀 → '전 장 공통 전경 픽셀'만
  배지로 식별해 인페인트. 한 장에만 있는 글자·선·도형은 공통이 아니므로 **절대 안 건드림**.
- **단일 이미지/짧은 덱**: `tools/templates/notebooklm_badge.png` 템플릿 매칭으로 배지 위치 식별.

## 절차

1. (최초 1회) `cd automation && pip install -r requirements.txt`
2. 실행 — 옵션 없이 기본값이 곧 정밀 모드:
   ```bash
   cd automation
   python tools/erase_watermark.py "<입력>" -o "output/clean/<이름>_clean.pptx"
   ```
3. **전수 검증(필수)**: 원본 vs 결과 픽셀 비교, **배지 박스(우하단 ~4.5%h × 9%w) 밖 변경 = 0픽셀** 확인:
   ```python
   import zipfile, cv2, numpy as np
   zo, zc = zipfile.ZipFile(ORIG), zipfile.ZipFile(CLEAN)
   worst = 0
   for m in sorted(n for n in zo.namelist() if n.startswith("ppt/media/")):
       a = cv2.imdecode(np.frombuffer(zo.read(m), np.uint8), cv2.IMREAD_COLOR)
       b = cv2.imdecode(np.frombuffer(zc.read(m), np.uint8), cv2.IMREAD_COLOR)
       if a is None or b is None or a.shape != b.shape: continue
       d = (np.abs(a.astype(int) - b.astype(int)).sum(2) > 12); H, W = d.shape
       d[int(H*0.955):, int(W*0.91):] = False
       worst = max(worst, int(d.sum()))
   print(f"배지 밖 변경 최대 {worst}픽셀 (0=완벽)")   # 0이 아니면 사용자에게 보고
   ```
   0이 아니면 결과를 보내지 말고 원인 슬라이드를 찾아 보고할 것.
4. 검증 통과 시: 코너 BEFORE/AFTER 비교 이미지 1장 + 완성본을 `SendUserFile`로 전달.

## 이력 (재발 방지)
- v1 영역 일괄 삭제 → 박스 테두리 선 삭제 사고
- v2 연결요소 필터 → 코너에 걸친 본문 글자 삭제 사고
- **v3(현재) 공통픽셀/템플릿 = 배지만** → 배지 밖 0픽셀 검증 의무화
