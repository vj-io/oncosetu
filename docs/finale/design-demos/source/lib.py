ICONS={
'file':"M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 13h6 M9 17h6",
'camera':"M4 8h3l2-3h6l2 3h3v11H4z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
'clip':"M9 4h6v3H9z M7 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-1 M9 12h6 M9 16h4",
'mail':"M3 6h18v12H3z M3 7l9 6 9-6",
'chev':"M9 6l6 6-6 6",
'down':"M6 9l6 6 6-6",
'check':"M5 12l5 5 9-10",
'alert':"M12 3l10 18H2z M12 10v5 M12 18v.5",
'search':"M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4",
'home':"M3 11l9-8 9 8 M5 10v10h14V10",
'scan':"M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M8 12h8",
'flask':"M9 3h6 M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3",
'pill':"M10.5 20.5l-7-7a4.9 4.9 0 0 1 7-7l7 7a4.9 4.9 0 0 1-7 7z M8.5 8.5l7 7",
'help':"M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7 M12 17v.5",
'shield':"M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
'list':"M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01",
'users':"M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2 20c0-3.5 3-6 7-6s7 2.5 7 6 M17 5a3 3 0 0 1 0 6 M19 14c2 .7 3 2.4 3 5",
'arrow':"M5 12h14 M13 6l6 6-6 6",
'ext':"M8 16L16 8 M9 8h7v7",
'cal':"M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4",
'bell':"M6 16V11a6 6 0 0 1 12 0v5l2 2H4z M10 21h4",
'logo':"M4 20V12a8 8 0 0 1 16 0v8 M8 20v-7a4 4 0 0 1 8 0v7",
'lock':"M6 11h12v10H6z M8 11V8a4 4 0 0 1 8 0v3",
'img':"M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6 M8 9.5h.01",
'set':"M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.7a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.7a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z",
}
def ic(n,s=18,c='currentColor',w=1.8):
    return f'<svg width="{s}" height="{s}" viewBox="0 0 24 24" fill="none" stroke="{c}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round" style="flex:none">'+''.join(f'<path d="{d}"/>' for d in ICONS[n].split(' M')[0:1] and ['M'+p if not p.startswith('M') else p for p in ICONS[n].split(' M')])+'</svg>'
GF="https://fonts.googleapis.com/css2?"
FONT_CURRENT=GF+"family=Instrument+Sans:wght@400;500;600&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap"
FONT_MEDICAL=GF+"family=Figtree:wght@400;500;600;700&family=Noto+Sans:wght@400;500;600&family=Noto+Sans+Devanagari:wght@400;500;600;700&display=swap"
SCAN_CSS="""
.scan{position:relative;overflow:hidden;background:#050607;border-radius:3px}
.scan:before{content:"";position:absolute;left:14%;right:14%;top:16%;bottom:12%;border-radius:46% 46% 40% 40%;background:radial-gradient(ellipse at 50% 50%,#a3a8ae 0,#7d8389 70%,#5d6268 100%)}
.scan:after{content:"";position:absolute;inset:0;background:
radial-gradient(ellipse 14% 27% at 36% 47%,#0b0c0d 0,#17191b 80%,transparent 84%),
radial-gradient(ellipse 14% 27% at 64% 47%,#0b0c0d 0,#17191b 80%,transparent 84%),
radial-gradient(circle at 50% 70%,#d8dbde 0,#d8dbde 4%,transparent 6%),
radial-gradient(circle at 50% 38%,#8d9298 0,#8d9298 7%,transparent 9%)}
.scan.pet:after{background:
radial-gradient(ellipse 14% 27% at 36% 47%,#0b0c0d 0,#17191b 80%,transparent 84%),
radial-gradient(ellipse 14% 27% at 64% 47%,#0b0c0d 0,#17191b 80%,transparent 84%),
radial-gradient(circle at 60% 58%,#ff9d2e 0,#ff9d2e 5%,transparent 9%),
radial-gradient(circle at 44% 66%,#ffd84a 0,#ffd84a 3%,transparent 6%)}
.scan.mri:before{background:radial-gradient(ellipse at 50% 50%,#b9bec4 0,#8b9096 60%,#454a50 100%);border-radius:50%}
.scan.mri:after{background:radial-gradient(circle at 38% 52%,#e8eaec 0,#e8eaec 12%,transparent 15%),radial-gradient(circle at 62% 52%,#e8eaec 0,#e8eaec 12%,transparent 15%),radial-gradient(circle at 50% 30%,#2c3035 0,#2c3035 6%,transparent 8%)}
.scan i{position:absolute;left:4px;bottom:3px;font:500 8px/1 sans-serif;color:#9aa0a6;font-style:normal;letter-spacing:.06em;z-index:2}
"""
