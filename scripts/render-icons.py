"""Render MuseMint's geometric M / sound-wave mark with Pillow."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'icons'
root.mkdir(exist_ok=True)
scale = 4
image = Image.new('RGBA', (128 * scale, 128 * scale))
draw = ImageDraw.Draw(image)
def box(values):
    return tuple(int(value * scale) for value in values)
draw.rounded_rectangle(box((2, 2, 126, 126)), radius=30 * scale, fill='#171713')
draw.ellipse(box((14, 14, 114, 114)), fill='#d9ff43')
points = [(34, 86), (34, 44), (49, 65), (64, 40), (79, 65), (94, 44), (94, 86)]
draw.line([(x * scale, y * scale) for x, y in points], fill='#171713', width=9 * scale, joint='curve')
for x, y in points:
    draw.ellipse(box((x-4.5, y-4.5, x+4.5, y+4.5)), fill='#171713')
draw.polygon([(x * scale, y * scale) for x, y in [(104, 7), (108, 18), (119, 22), (108, 26), (104, 37), (100, 26), (89, 22), (100, 18)]], fill='#ff6a4c')
for size in (16, 32, 48, 128):
    image.resize((size, size), getattr(Image, "Resampling", Image).LANCZOS).save(root / f'icon-{size}.png')
