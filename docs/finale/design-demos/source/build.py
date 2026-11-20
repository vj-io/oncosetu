import base64, os, sys
from pathlib import Path
from playwright.sync_api import sync_playwright
from mocks1 import mock_A, mock_B
from mocks2 import mock_C_light, mock_C_dark, mock_D, mock_E, mock_F

OUT = Path(r"C:\Users\GARV BANSAL\Documents\onco\docs\finale\design-demos")
SH = OUT / "shots"
W = Path(__file__).parent / "work"; W.mkdir(exist_ok=True)
(OUT / "after-full").mkdir(exist_ok=True)

mocks = {
 'A': (mock_A, 880, 720), 'B': (mock_B, 880, 720), 'C1': (mock_C_light, 700, 760), 'C2': (mock_C_dark, 700, 760),
 'D': (mock_D, 375, 740), 'E': (mock_E, 880, 720), 'F': (mock_F, 880, 720),
}
for k, (fn, w, h) in mocks.items():
    (W / f"mock_{k}.html").write_text(fn(), encoding="utf-8")

def b64(p):
    return "data:image/png;base64," + base64.b64encode(Path(p).read_bytes()).decode()

BASE = """
*{box-sizing:border-box;margin:0;padding:0}
body{width:1200px;height:675px;background:#eceae4;font-family:'Instrument Sans','Segoe UI',sans-serif;color:#1b1c1a;position:relative;overflow:hidden}
.hd{position:absolute;left:16px;right:16px;top:8px;height:30px;display:flex;align-items:center;gap:10px}
.hd .k{width:28px;height:28px;border-radius:6px;background:#1b1c1a;color:#fff;display:grid;place-items:center;font-weight:700;font-size:16px}
.hd h1{font-size:17px;font-weight:600}.hd span{margin-left:auto;font-size:12px;color:#5c5a55}
.pn{position:absolute;top:44px;background:#fff;border:1px solid #cfccc3;border-radius:8px;overflow:hidden}
.pl{height:26px;display:flex;align-items:center;padding:0 10px;font-size:11.5px;font-weight:700;letter-spacing:.08em}
.pl.b{background:#e7e4dc;color:#55534e}.pl.a{background:#0f6e6a;color:#fff}
.bd{position:relative;overflow:hidden}
.nt{padding:10px 12px;font-size:12.5px;line-height:1.4;color:#3a3935}
.nt li{margin:0 0 5px 16px}.nt b{font-weight:600}
.cap{position:absolute;left:16px;right:16px;bottom:8px;height:104px;background:#fff;border:1px solid #cfccc3;border-radius:8px;padding:10px 16px;display:flex;flex-direction:column;justify-content:center;gap:5px}
.cap div{font-size:14.5px;line-height:1.35}.cap b{color:#0f6e6a;font-weight:700;margin-right:4px}
.fr{border:0;position:absolute;left:0;top:0;transform-origin:0 0}
"""

def frame(k, w, h, s):
    return f'<iframe class="fr" src="mock_{k}.html" width="{w}" height="{h}" style="transform:scale({s})"></iframe>'

def comp_std(letter, title, before, notes, mockk, caption, w=880, h=720):
    s = 584 / w
    ah = round(h * s)
    notes_html = "<ul>" + "".join(f"<li>{n}</li>" for n in notes) + "</ul>"
    bh = round(584 * 768 / 1366)
    return f"""<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap"><style>{BASE}</style></head><body>
<div class="hd"><div class="k">{letter}</div><h1>{title}</h1><span>Proposal for approval · synthetic data · live site screenshot as BEFORE</span></div>
<div class="pn" style="left:16px;width:584px"><div class="pl b">BEFORE · LIVE SITE TODAY</div><div class="bd" style="height:{ah}px"><img src="{b64(SH/before)}" style="width:584px;display:block"><div class="nt"><ul>{''.join(f'<li>{n}</li>' for n in notes)}</ul></div></div></div>
<div class="pn" style="left:600px;width:584px"><div class="pl a">AFTER · PROPOSED MOCK-UP</div><div class="bd" style="height:{ah}px">{frame(mockk,w,h,s)}</div></div>
<div class="cap"><div><b>What changes.</b>{caption[0]}</div><div><b>Why.</b>{caption[1]}</div></div>
</body></html>"""

def comp_phone(letter, title, before, notes_b, mockk, notes_a, caption):
    s = 478 / 740
    return f"""<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap"><style>{BASE}</style></head><body>
<div class="hd"><div class="k">{letter}</div><h1>{title}</h1><span>Proposal for approval · synthetic data · live site screenshot as BEFORE</span></div>
<div class="pn" style="left:16px;width:584px"><div class="pl b">BEFORE · LIVE SITE TODAY (375x812 PHONE)</div><div class="bd" style="height:504px;display:flex;gap:14px;padding:12px 12px 0">
<img src="{b64(SH/before)}" style="height:478px;border:1px solid #cfccc3;display:block;flex:none;object-position:top;object-fit:cover;width:221px"><div class="nt" style="padding:6px 0"><ul>{''.join(f'<li>{n}</li>' for n in notes_b)}</ul></div></div></div>
<div class="pn" style="left:600px;width:584px"><div class="pl a">AFTER · PROPOSED MOCK-UP</div><div class="bd" style="height:504px;padding:12px 12px 0;display:flex;gap:14px"><div style="position:relative;width:{round(375*s)}px;height:478px;flex:none;border:1px solid #cfccc3;overflow:hidden">{frame(mockk,375,740,s)}</div><div class="nt" style="padding:6px 0"><ul>{''.join(f'<li>{n}</li>' for n in notes_a)}</ul></div></div></div>
<div class="cap"><div><b>What changes.</b>{caption[0]}</div><div><b>Why.</b>{caption[1]}</div></div>
</body></html>"""

def comp_C(letter, title, before, notes, caption):
    s = 444 / 700
    ah = round(760 * s)
    return f"""<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap"><style>{BASE}</style></head><body>
<div class="hd"><div class="k">{letter}</div><h1>{title}</h1><span>Proposal for approval · synthetic data (illustrative scans) · live site screenshot as BEFORE</span></div>
<div class="pn" style="left:16px;width:256px"><div class="pl b">BEFORE · DOCUMENTS TAB</div><div class="bd" style="height:{ah}px"><div style="width:256px;height:200px;overflow:hidden;border-bottom:1px solid #cfccc3"><img src="{b64(SH/before)}" style="width:{round(1366*256/760)}px;display:block"></div><div class="nt"><ul>{''.join(f'<li>{n}</li>' for n in notes)}</ul></div></div></div>
<div class="pn" style="left:284px;width:444px"><div class="pl a">AFTER · LIGHT: ALL RECORDS FEED</div><div class="bd" style="height:{ah}px">{frame('C1',700,760,s)}</div></div>
<div class="pn" style="left:740px;width:444px"><div class="pl a" style="background:#111418">AFTER · DARK: SCAN READING ROOM</div><div class="bd" style="height:{ah}px;width:444px">{frame("C2",700,760,444/700)}</div></div>
<div class="cap"><div><b>What changes.</b>{caption[0]}</div><div><b>Why.</b>{caption[1]}</div></div>
</body></html>"""

specs = {
 'A': dict(kind='std', title='Minimal clinical', before='overview.png', mock='A',
   notes=['Demo banner, tour button and 11 tabs sit above the content.', 'Four equal cards: the three zeros take as much room as the one real "3".', 'Mono capitals, borders and boxed counters on almost every label.'],
   cap=['One accent, one big number ("3 papers not in file"), quiet zero-counts as a plain list, no boxed cards, tour moved to a small help link.',
        'styles #1 Minimalism &amp; Swiss (white space, high contrast) + #8 Accessible &amp; Ethical (16px+, 4.5:1); products #58 Medical Clinic. Safety line kept at foot.']),
 'B': dict(kind='std', title='Calm medical palette', before='patients.png', mock='B',
   notes=['Table runs wider than the screen: the Consent and Record code columns are cut off.', 'Square corners, outline badges, one flat yellow for everything that matters.', 'Status words in mono capitals; "NOT YET RECORDED" repeats on every row.'],
   cap=['Cards replace the wide table. Soft teal/green palette (#0891B2, #F0FDFA, #134E4A), 16px radius, status as icon + words, "needs a look" row tinted.',
        'colors #58 Medical Clinic; styles #19 Soft UI Evolution; ux #37 never colour alone; ui-reasoning #8 no neon or heavy motion. Primary darkened to #0E7490 for white text (3.7:1 to 5.4:1).']),
 'C': dict(kind='C', title='Doctor view: All records, in date order', before='documents_index.png',
   notes=['Records grouped by type (Pathology, Discharge, Treatment), not one date order.', 'No scan thumbnails in the list; no earlier-scan comparison.', 'Upload box and counts fill the top before any record appears.'],
   cap=['One date-ordered feed of every report, scan, lab and prescription: type filters, thumbnails, earlier same-part scans; a dark room to compare two scans.',
        'ui-reasoning #182 must-have lab-results-timeline; styles #7 Dark Mode (OLED). Safety cues kept: stored not read, quotes link to source, not a summary.']),
 'D': dict(kind='phone', title='Simple patient portal on a phone', before='portal_home.png', mock='D',
   notes_b=['Menu bar, greeting and a 3-line intro push the first action down.', 'Action cards carry 3 lines of small text each.', 'Hindi appears only after switching language.'],
   notes_a=['4 actions, 76px tall, whole card is the tap target.', 'Hindi first with English under it; Figtree + Noto Sans Devanagari.', '3 bottom tabs. Safety line kept: "list of papers, not a medical summary".'],
   cap=['Four big actions in plain Hindi with English beneath, one filled primary button (Send papers), bottom tabs for Home / Papers / Help, 16px+ text.',
        'ux #22 + app-interface #6 touch target 44-48; app-interface #10 bottom tabs 3-5; ux #67 16px body; typography #30 Medical Clean; colors #182 Patient Portal (#0284C7 family).']),
 'E': dict(kind='std', title='Typography swap', before='admin.png', mock='E',
   notes=['Three families: Instrument Sans, Inter Tight, JetBrains Mono.', 'Every label is a letter-spaced mono capital ("BLOCKED AND HELD").', 'Hindi falls back to a separate Devanagari font with a different look.'],
   cap=['Figtree headings + Noto Sans body, sentence-case labels instead of mono capitals, tabular figures for counts, Noto Sans Devanagari for Hindi.',
        'typography #30 Medical Clean (Figtree / Noto Sans: healthcare, accessibility); ux #72 line-height 1.5-1.75; ux #67 16px body. Alternative: #16 Corporate Trust (Lexend / Source Sans 3).']),
 'F': dict(kind='std', title='Navigation simplification', before='documents.png', mock='F',
   notes=['11 tabs in one row plus Desk / Patients and a Tour button.', 'No single "what to do next"; the reader must scan every tab.', 'Counts in boxes beside several tabs compete for attention.'],
   cap=['11 patient tabs become 5 (Overview, Records, To do, People &amp; consent, More) and a "Next step" card says what to do first: make the request letter.',
        'app-interface #10 use 3-5 top items, extras under More; ux #3 clear active state; ux #79 give a helpful next action.']),
}

TITLES = {k: v['title'] for k, v in specs.items()}

def make_html(k):
    v = specs[k]
    if v['kind'] == 'std':
        w, h = mocks[v['mock']][1:]
        return comp_std(k, v['title'], v['before'], v['notes'], v['mock'], v['cap'], w, h)
    if v['kind'] == 'phone':
        return comp_phone(k, v['title'], v['before'], v['notes_b'], v['mock'], v['notes_a'], v['cap'])
    return comp_C(k, v['title'], v['before'], v['notes'], v['cap'])

with sync_playwright() as p:
    b = p.chromium.launch()
    # full-size after renders
    ctx = b.new_context(device_scale_factor=2)
    for k, (fn, w, h) in mocks.items():
        pg = ctx.new_page(); pg.set_viewport_size({'width': w, 'height': h})
        pg.goto((W / f"mock_{k}.html").as_uri(), wait_until='networkidle'); pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(600)
        name = {'C1': 'C-light', 'C2': 'C-dark'}.get(k, k) + '-after-full.png'
        pg.screenshot(path=str(OUT / 'after-full' / name)); pg.close()
    ctx.close()
    ctx = b.new_context(viewport={'width': 1200, 'height': 675}, device_scale_factor=1)
    for k in specs:
        f = W / f"comp_{k}.html"; f.write_text(make_html(k), encoding='utf-8')
        pg = ctx.new_page(); pg.goto(f.as_uri(), wait_until='networkidle'); pg.evaluate("document.fonts.ready"); pg.wait_for_timeout(1500)
        pg.screenshot(path=str(OUT / f"{k}.png")); pg.close()
    # contact sheet
    cells = ""
    pitch = {
     'A': 'Quiet page: one number, one action.', 'B': 'Soft cards, calm teal and green.', 'C': "Radiologist's date-ordered records feed + reading room.",
     'D': 'Four big Hindi-first actions on a phone.', 'E': 'Figtree + Noto Sans replace three fonts.', 'F': '11 tabs become 5 and one next step.'}
    for k in specs:
        cells += f'<div class="cell"><div class="lb"><span>{k}</span><b>{specs[k]["title"]}</b></div><img src="{b64(OUT / (k + ".png"))}"><div class="pt">{pitch[k]}</div></div>'
    sheet = f"""<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&display=swap"><style>
*{{box-sizing:border-box;margin:0;padding:0}}body{{width:1920px;height:1080px;background:#eceae4;font-family:'Instrument Sans',sans-serif;color:#1b1c1a;padding:14px 8px}}
.t{{display:flex;align-items:baseline;gap:14px;padding:0 8px 8px}}.t h1{{font-size:26px;font-weight:700}}.t span{{font-size:14px;color:#55534e}}
.g{{display:grid;grid-template-columns:repeat(3,624px);gap:6px 16px;padding:0 8px}}
.cell{{height:520px}}.lb{{display:flex;align-items:center;gap:10px;height:34px}}.lb span{{width:30px;height:30px;border-radius:6px;background:#0f6e6a;color:#fff;display:grid;place-items:center;font-weight:700;font-size:17px}}.lb b{{font-size:18px;font-weight:600}}
.cell img{{width:624px;height:351px;display:block;border:1px solid #cfccc3;border-radius:6px}}.pt{{font-size:17px;margin-top:10px;color:#3a3935}}
</style></head><body><div class="t"><h1>OncoSetu: six UI directions for approval</h1><span>BEFORE (live site) left, AFTER (mock-up) right in each. Synthetic data only. Based on UI UX Pro Max 2.13.0.</span></div><div class="g">{cells}</div></body></html>"""
    f = W / "sheet.html"; f.write_text(sheet, encoding='utf-8')
    c2 = b.new_context(viewport={'width': 1920, 'height': 1080}); pg = c2.new_page()
    pg.goto(f.as_uri(), wait_until='networkidle'); pg.wait_for_timeout(1000)
    pg.screenshot(path=str(OUT / "contact-sheet.png"))
    b.close()
print("done")
