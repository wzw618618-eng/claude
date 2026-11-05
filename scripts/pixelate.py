# 把 art/paintings 里的古画缩成像素画，输出到 art/pixel-bg（需要 Pillow：pip install pillow）。
# 长边缩到 160 像素，略提对比度，再压成 28 色，不抖动。改了画或参数后运行：python3 scripts/pixelate.py
import os
from PIL import Image, ImageEnhance

SRC, OUT, LONG, COLORS = 'art/paintings', 'art/pixel-bg', 160, 28
os.makedirs(OUT, exist_ok=True)
for f in sorted(os.listdir(SRC)):
    if not f.endswith('.jpg'):
        continue
    im = Image.open(os.path.join(SRC, f)).convert('RGB')
    k = LONG / max(im.size)
    sm = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    sm = ImageEnhance.Contrast(sm).enhance(1.15)
    px = sm.quantize(colors=COLORS, method=Image.MEDIANCUT, dither=Image.NONE).convert('RGB')
    dst = os.path.join(OUT, f.replace('.jpg', '.png'))
    px.save(dst, optimize=True)
    print(f'{dst} {px.size[0]}x{px.size[1]} {os.path.getsize(dst) // 1024} KB')
