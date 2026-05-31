"""
녹음파일 → 전사본(.txt)   [faster-whisper, 로컬]
=================================================
강의 녹음을 한국어 텍스트로 전사합니다. 로컬에서 동작(업로드 불필요).

설치:
  pip install faster-whisper
  # (CPU로도 동작. 'small'~'medium' 권장, 정확도 우선이면 'large-v3')

사용법:
  python transcribe.py recordings/2026-06-12_강의.m4a -o recordings/2026-06-12_강의.txt
  python transcribe.py rec.m4a --model medium --device cpu -o out.txt

전사본은 lecture_report.py 로 넘겨 강의보고서(HTML)를 만듭니다.
(OpenAI/그 외 클라우드 STT를 쓰려면 이 파일의 transcribe() 만 교체하면 됩니다.)
"""
from __future__ import annotations

import argparse
import os


def transcribe(audio: str, model_size: str, device: str, compute_type: str) -> str:
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise SystemExit("❌ pip install faster-whisper 먼저 실행하세요.")
    if not os.path.exists(audio):
        raise SystemExit(f"❌ 파일 없음: {audio}")
    print(f"🎧 전사 중… (model={model_size}, device={device})")
    model = WhisperModel(model_size, device=device, compute_type=compute_type)
    segments, info = model.transcribe(audio, language="ko", vad_filter=True)
    print(f"   감지 언어: {info.language} (p={info.language_probability:.2f})")
    parts = []
    for seg in segments:
        ts = f"[{int(seg.start)//60:02d}:{int(seg.start)%60:02d}]"
        parts.append(f"{ts} {seg.text.strip()}")
    return "\n".join(parts)


def main() -> None:
    ap = argparse.ArgumentParser(description="녹음 → 전사본(.txt)")
    ap.add_argument("audio", help="오디오 파일")
    ap.add_argument("-o", "--output", help="전사본 출력(.txt)")
    ap.add_argument("--model", default="small", help="tiny/base/small/medium/large-v3")
    ap.add_argument("--device", default="cpu", help="cpu/cuda")
    ap.add_argument("--compute-type", default="int8", help="int8/float16 등")
    args = ap.parse_args()

    text = transcribe(args.audio, args.model, args.device, args.compute_type)
    out = args.output or os.path.splitext(args.audio)[0] + ".txt"
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    open(out, "w", encoding="utf-8").write(text + "\n")
    print(f"✅ 전사본 → {out}  ({len(text)}자)")


if __name__ == "__main__":
    main()
