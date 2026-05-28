#!/usr/bin/env python3
"""Generate og-image.png (1200x630) for Nedabah Way / Drip Lines."""
from PIL import Image, ImageDraw, ImageFont

# Brand palette
PAPER = (244, 238, 228)
INK = (58, 40, 23)
ACCENT = (184, 92, 60)
MUTED = (122, 102, 82)

W, H = 1200, 630
img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)

# subtle border frame
d.rectangle([24, 24, W - 25, H - 25], outline=(214, 204, 188), width=2)

# ---- Fonts ----
# Korean-capable Noto CJK (KR face). Serif for headings, Sans for body Korean.
SERIF_CJK = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc"
SANS_CJK = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"

# KR face index in Debian Noto CJK ttc files is 1 (JP=0, ...). Glyph coverage
# is shared across faces, so Hangul renders regardless; we select KR explicitly.
def f(path, size, index=0):
    try:
        return ImageFont.truetype(path, size, index=index)
    except Exception:
        return ImageFont.truetype(path, size)

KR = 1  # Korean face index in Noto CJK ttc
font_title = f(SERIF_CJK, 78, KR)       # "Nedabah Way" (serif)
font_kr_accent = f(SANS_CJK, 40, KR)    # Korean tagline (accent)
font_muted = f(SANS_CJK, 27, KR)        # Drip Lines line (muted, has Korean)
font_url = f(SANS_CJK, 26, KR)          # url (muted)

# ---- Left: coffee-drip logo mark (scaled from favicon viewBox 64x72) ----
# Place mark area on the left.
S = 5.2                      # scale factor
ox, oy = 150, 195            # offset of viewBox origin in image coords

def P(x, y):
    return (ox + x * S, oy + y * S)

def scaled(coords):
    return [P(x, y) for x, y in coords]

stroke_w = max(2, int(2.2 * S))

# drip drop (filled accent) - approximate the SVG teardrop with a polygon path
drop = [(32, 6), (29, 13), (27, 18), (32, 22), (37, 18), (35, 13), (32, 6)]
d.polygon(scaled(drop), fill=ACCENT)

# cup body: M14 30 H50 L46 58 Q46 62 42 62 H22 Q18 62 18 58 Z
cup = [(14, 30), (50, 30), (46, 58), (44, 61), (42, 62),
       (22, 62), (20, 61), (18, 58), (14, 30)]
d.line(scaled(cup), fill=INK, width=stroke_w, joint="curve")

# handle: M50 36 Q60 38 60 44 Q60 50 50 52  -> approximate arc with points
handle = [(50, 36), (56, 37), (60, 40), (60, 44), (60, 48), (56, 51), (50, 52)]
d.line(scaled(handle), fill=INK, width=stroke_w, joint="curve")

# saucer line: x1 10 y1 68 -> x2 54 y2 68
d.line([P(10, 68), P(54, 68)], fill=INK, width=max(2, int(1.8 * S)))

# ---- Right: text block ----
tx = 470
y = 150

d.text((tx, y), "Nedabah Way", font=font_title, fill=INK)
y += 110

d.text((tx, y), "한 방울씩 스며드는 공동체의 길", font=font_kr_accent, fill=ACCENT)
y += 70

d.text((tx, y), "Drip Lines · 매달 한 줄씩 내려 드리는 묵상 간행물",
       font=font_muted, fill=MUTED)
y += 52

d.text((tx, y), "nedabah.org", font=font_url, fill=MUTED)

img.save("/home/user/https-github.com-bebeggogo-byte-sbm-new-main/og-image.png", "PNG")

# verify
chk = Image.open("/home/user/https-github.com-bebeggogo-byte-sbm-new-main/og-image.png")
print("saved size:", chk.size)
