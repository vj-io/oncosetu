"""Render the mock-up HTML files to PNG. Usage: python shoot.py [name ...]"""
import sys, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).parent
SHOTS = {
    "01-doctor-patient": (1440, 900, "?tip"),
    "02-all-records": (1440, 900, ""),
    "03-patient-list": (1440, 900, ""),
    "04-records-desk": (1440, 900, ""),
    "05-admin": (1440, 900, ""),
    "06-patient-portal": (390, 844, ""),
}
names = sys.argv[1:] or list(SHOTS)
with sync_playwright() as p:
    b = p.chromium.launch()
    for n in names:
        w, h, q = SHOTS[n]
        pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=2 if w < 500 else 1)
        pg.goto((ROOT / "html" / (n + ".html")).as_uri() + q)
        pg.wait_for_load_state("networkidle")
        pg.evaluate("document.fonts.ready")
        pg.wait_for_timeout(600)
        out = ROOT / "png" / (n + ".png")
        pg.screenshot(path=str(out))
        # overflow check
        info = pg.evaluate("({sw:document.documentElement.scrollWidth,sh:document.documentElement.scrollHeight,cw:document.documentElement.clientWidth})")
        caps = pg.evaluate("""[...document.querySelectorAll('body *')].filter(e=>{const s=getComputedStyle(e);return s.textTransform==='uppercase'||/mono/i.test(s.fontFamily)}).length""")
        print(n, info, "uppercase/mono elements:", caps)
        pg.close()
    b.close()
