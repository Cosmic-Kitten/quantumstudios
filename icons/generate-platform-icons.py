# Generate static platform PWA icons; run with python3 icons/generate-platform-icons.py.
# Requires cairosvg (pip install cairosvg)."
from pathlib import Path
import cairosvg
OUT = Path(__file__).parent
ICONS = {
    "ios": ("#b9f36b", '<path d="M256 170 278 234 342 256 278 278 256 342 234 278 170 256 234 234Z"/>'),
    "windows": ("#78a9ff", '<path d="M163 176h82v72h-82zm104 0h82v72h-82zm-104 94h82v72h-82zm104 0h82v72h-82z"/>'),
    "linux": ("#b9f36b", '<path d="m174 209 52 47-52 47v-30l19-17-19-17zm60 104h96v18h-96z"/>'),
    "chromebook": ("#8ab4f8", '<path d="M181 202h150v20H181zm0 44h150v20H181zm0 44h150v20H181z"/>'),
}

for name, (accent, shape) in ICONS.items():
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#111713"/>
  <circle cx="256" cy="256" r="142" fill="none" stroke="{accent}" stroke-width="22"/>
  <ellipse cx="256" cy="256" rx="207" ry="91" fill="none" stroke="#7c9cff" stroke-width="17" transform="rotate(-32 256 256)"/>
  <g fill="{accent}">{shape}</g>
  <circle cx="407" cy="143" r="26" fill="{accent}"/>
</svg>'''
    (OUT / f"orbit-{name}.svg").write_text(svg + "\n")
    for size in (192, 512):
        cairosvg.svg2png(bytestring=svg.encode(), write_to=str(OUT / f"orbit-{name}-{size}.png"), output_width=size, output_height=size)
