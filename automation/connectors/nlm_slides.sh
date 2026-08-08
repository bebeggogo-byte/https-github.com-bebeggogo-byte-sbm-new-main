#!/bin/sh
# =====================================================================
# 노트북LM 슬라이드 원샷 제작 (notebooklm-mcp-cli 기반)
# ---------------------------------------------------------------------
# 준비물: cookies.txt 1개 (notebooklm.google.com 로그인 쿠키)
#   → 크롬 확장 "Get cookies.txt LOCALLY"로 2분 만에 내보내기 가능
#   → ⚠️ 쿠키는 비밀번호처럼 취급! (2~4주 유효, .gitignore 처리됨)
#
# 사용법:
#   sh connectors/nlm_slides.sh <cookies.txt> <커리큘럼.pdf> ["포커스 주제"]
# 예:
#   sh connectors/nlm_slides.sh cookies.txt "output/커리큘럼_자발적거룩_0612.pdf" \
#       "자발적 거룩: 강요가 아닌 감동에서 시작되는 헌신"
# =====================================================================
set -e
COOKIES="$1"; PDF="$2"; FOCUS="${3:-핵심 내용 중심의 강의 슬라이드}"

[ -f "$COOKIES" ] || { echo "❌ 쿠키 파일 없음: $COOKIES"; exit 1; }
[ -f "$PDF" ]     || { echo "❌ PDF 없음: $PDF"; exit 1; }

echo "① 로그인(쿠키 주입)…"
nlm login --file "$COOKIES"

echo "② 노트북 생성…"
NB=$(nlm notebook create "강의자료 $(date +%m%d)" 2>&1 | grep -oE '[a-f0-9-]{36}' | head -1)
echo "   notebook_id=$NB"

echo "③ 커리큘럼 PDF 소스 업로드…"
nlm source add "$NB" --file "$PDF" -y

echo "④ 슬라이드 생성 (한국어, 발표용)…"
nlm slides create "$NB" --format detailed_deck --language ko --focus "$FOCUS" -y

echo "⑤ 생성 대기 후 PPTX 다운로드…"
sleep 90
nlm download slides "$NB" -o output/ 2>/dev/null || nlm download artifact "$NB" -o output/

echo "✅ 완료 — output/ 폴더 확인. 수정은: nlm slides revise $NB"
