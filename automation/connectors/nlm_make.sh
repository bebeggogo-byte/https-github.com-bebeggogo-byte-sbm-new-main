#!/bin/sh
# =====================================================================
# 클로드 집필 → 노트북LM 슬라이드 생성 → 다운로드 → 로고 삭제 (원샷)
# ---------------------------------------------------------------------
# 회원님이 PC에서 '한 번' 실행하면 ②③④가 자동으로 끝납니다.
#   ② 노트북LM 슬라이드 생성  ③ PPTX 다운로드  ④ 로고 지우개 삭제
# (① 슬라이드 내용은 클로드가 집필해 content 파일로 줍니다)
#
# 준비(최초 1회): nlm login   (브라우저로 본인 구글 로그인 — IP가 맞아 통과됨)
#
# 사용법:
#   sh connectors/nlm_make.sh <집필파일(.pdf|.md|.txt)> ["포커스 주제"]
# 예:
#   sh connectors/nlm_make.sh "output/커리큘럼_자발적거룩_0612.pdf" \
#       "강요가 아닌 자발성에서 시작되는 거룩"
# =====================================================================
set -e
SRC="$1"; FOCUS="${2:-핵심 내용 중심의 발표 슬라이드}"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
OUT="$ROOT/output/nlm"; mkdir -p "$OUT"

[ -f "$SRC" ] || { echo "❌ 집필 파일 없음: $SRC"; exit 1; }

echo "① 인증 확인…"
nlm doctor >/dev/null 2>&1 || true
nlm notebook list >/dev/null 2>&1 || { echo "→ 먼저 'nlm login' 으로 로그인하세요 (브라우저)"; exit 1; }

echo "② 노트북 생성 + 소스 업로드…"
NB=$(nlm notebook create "강의 $(date +%m%d_%H%M)" 2>&1 | grep -oE '[a-f0-9-]{36}' | head -1)
echo "   notebook=$NB"
case "$SRC" in
  *.pdf) nlm source add "$NB" --file "$SRC" -y ;;
  *)     nlm source add "$NB" --type text --file "$SRC" -y 2>/dev/null \
            || nlm source add "$NB" --file "$SRC" -y ;;
esac

echo "③ 슬라이드 생성(한국어, 발표용) — 60~90초…"
nlm slides create "$NB" --format detailed_deck --language ko --focus "$FOCUS" -y
sleep 90

echo "④ PPTX 다운로드…"
RAW="$OUT/deck_raw.pptx"
nlm download slides "$NB" --format pptx -o "$RAW" 2>/dev/null \
  || nlm download artifact "$NB" -o "$OUT"

echo "⑤ 노트북LM 로고 지우개 삭제…"
CLEAN="$OUT/deck_clean.pptx"
python3 "$ROOT/tools/erase_watermark.py" "$RAW" --corner br --h 0.07 --w 0.15 -o "$CLEAN"

echo ""
echo "✅ 완성: $CLEAN"
echo "   (수정 원하면: nlm slides revise $NB  → 다시 ④⑤만 실행)"
