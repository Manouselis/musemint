"""Render a two-color MuseMint monogram, designed on a 16-pixel grid."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1] / 'icons'
root.mkdir(exist_ok=True)
resampling = getattr(Image, 'Resampling', Image).LANCZOS

for size in (16, 32, 48, 128):
    # Supersample each output independently to keep the small mark crisp.
    scale = 8
    unit = size * scale / 16
    image = Image.new('RGBA', (size * scale, size * scale))
    draw = ImageDraw.Draw(image)
    def box(values):
        return tuple(round(value * unit) for value in values)

    draw.rounded_rectangle(box((0, 0, 16, 16)), radius=round(3.5 * unit), fill='#d9ff43')
    points = [(4.5, 11.5), (4.5, 4.5), (8, 8), (11.5, 4.5), (11.5, 11.5)]
    draw.line([(round(x * unit), round(y * unit)) for x, y in points],
              fill='#171713', width=round(1.75 * unit), joint='curve')
    for x, y in points:
        draw.ellipse(box((x - .875, y - .875, x + .875, y + .875)), fill='#171713')
    image.resize((size, size), resampling).save(root / f'icon-{size}.png')
