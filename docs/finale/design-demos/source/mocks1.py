from lib import *
def doc(font,css,body,w,h):
    return f'<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="{font}"><style>*{{box-sizing:border-box;margin:0;padding:0}}html,body{{width:{w}px;height:{h}px;overflow:hidden}}{css}</style></head><body>{body}</body></html>'

# ---------- A: Minimal clinical (Khan overview) ----------
def mock_A():
    css="""
body{font-family:'Instrument Sans',sans-serif;background:#faf9f6;color:#1b1c1a;font-size:15px;line-height:1.55;position:relative}
.top{display:flex;align-items:center;gap:34px;padding:0 48px;height:62px}
.logo{display:flex;align-items:center;gap:8px;font-size:21px;color:#1b1c1a;font-weight:500}.logo svg{color:#0f6e6a}
.nav a{font-size:15px;color:#5c5a55;margin-right:26px}.nav a.on{color:#1b1c1a;font-weight:600;border-bottom:2px solid #0f6e6a;padding-bottom:6px}
.sp{flex:1}.av{width:34px;height:34px;border-radius:50%;background:#e2efed;color:#0b5c58;display:grid;place-items:center;font-weight:600;font-size:13px}
.help{color:#5c5a55;display:flex;gap:6px;align-items:center;font-size:14px}
.pg{padding:12px 48px 0}
.crumb{font-size:13.5px;color:#6a6862}
h1{font-size:38px;font-weight:500;letter-spacing:-.02em;margin:6px 0 2px;line-height:1.15}
.meta{color:#5c5a55;font-size:15px}.meta b{font-weight:600;color:#1b1c1a}
.tabs{display:flex;gap:28px;margin:18px 0 0;border-bottom:1px solid #e3e0d8;font-size:15px;color:#5c5a55}
.tabs span{padding:10px 0}.tabs .on{color:#1b1c1a;font-weight:600;box-shadow:0 2px 0 #0f6e6a}
.tabs em{font-style:normal;color:#6a6862;margin-left:5px}
.grid{display:grid;grid-template-columns:1.55fr 1fr;gap:56px;margin-top:20px}
.lab{font-size:13px;color:#6a6862;letter-spacing:.02em;margin-bottom:12px;font-weight:500}
.big{display:flex;gap:18px;align-items:flex-start}
.num{font-size:84px;line-height:.9;color:#0f6e6a;font-weight:500;letter-spacing:-.04em}
.big h2{font-size:22px;font-weight:600;line-height:1.25;margin-top:4px}
.big p{color:#5c5a55;font-size:14.5px;margin-top:4px}
.items{margin-top:14px}
.it{padding:9px 0;border-top:1px solid #ebe8e1;font-size:15px}.it small{display:block;color:#6a6862;font-size:13px;margin-top:2px}
.it a{border-bottom:1px solid #0f6e6a55}
.btn{display:inline-flex;align-items:center;gap:8px;background:#0f6e6a;color:#fff;font-weight:600;border-radius:8px;padding:11px 18px;margin-top:12px;font-size:15px}
.q div{display:flex;justify-content:space-between;padding:12px 0;border-top:1px solid #ebe8e1;font-size:15px;color:#3a3935}
.q div b{font-weight:600;color:#1b1c1a;font-variant-numeric:tabular-nums}
.q div:first-of-type{border-top:0}
.foot{position:absolute;left:48px;right:48px;bottom:14px;display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#5c5a55;border-top:1px solid #ebe8e1;padding-top:10px}
.foot span{display:flex;gap:7px;align-items:center}
.seal{margin-top:20px;font-size:13.5px;color:#5c5a55;line-height:1.5}
"""
    body=f"""
<div class="top"><div class="logo">{ic('logo',22)}OncoSetu</div><div class="nav"><a class="on">Patients</a><a>Today</a></div><div class="sp"></div><div class="help">{ic('help',17)}Take the tour</div><div class="av">MI</div></div>
<div class="pg">
<div class="crumb">Patients / Mohd. Abdul Rahim Khan</div>
<h1>Mohd. Abdul Rahim Khan</h1>
<div class="meta">64 years, male &nbsp;·&nbsp; record <b>OS-9EA40B</b> &nbsp;·&nbsp; diagnosis may be discussed</div>
<div class="tabs"><span class="on">Overview</span><span>Documents<em>7</em></span><span>Timeline</span><span>Missing papers<em>3</em></span><span>More</span></div>
<div class="grid">
<div>
<div class="lab">Before the visit</div>
<div class="big"><div class="num">3</div><div><h2>papers are not in the file</h2><p>Other papers mention them, but we do not hold them. Not in file does not mean it was not done.</p></div></div>
<div class="items">
<div class="it"><a>Laboratory report, pending on 20 Jan 2026</a><small>Discharge summary, p.1 &nbsp;·&nbsp; ask at Upvan Multispeciality Hospital</small></div>
<div class="it"><a>PET-CT report the patient mentioned</a><small>Patient statement &nbsp;·&nbsp; place not stated</small></div>
<div class="it"><a>Prescription from City Care Hospital, Nagpur</a><small>Patient statement &nbsp;·&nbsp; place not stated</small></div>
</div>
<div class="btn">Make a request letter {ic('arrow',17)}</div>
</div>
<div>
<div class="lab">Also on file</div>
<div class="q"><div>New since the last sealed visit<b>0</b></div><div>Held for a person to check<b>0</b></div><div>Sources that disagree<b>0</b></div><div>Not yet checked against the page<b>22</b></div></div>
<div class="seal">Last sealed 12 Nov 2026, 11:29 IST by Dr. Meera Iyer. Nobody can change it afterwards.</div>
</div></div></div>
<div class="foot"><span>{ic('shield',16)}Document index, not a clinical summary. Every fact links to its source quote.</span><span>Synthetic demo data</span></div>
"""
    return doc(FONT_CURRENT,css,body,880,720)

# ---------- B: Calm medical palette (patients list) ----------
def mock_B():
    css="""
body{font-family:'Instrument Sans',sans-serif;background:#F0FDFA;color:#134E4A;font-size:15px;line-height:1.5;position:relative}
.top{display:flex;align-items:center;gap:30px;padding:0 40px;height:64px;background:#fff;border-bottom:1px solid #CCFBF1}
.logo{display:flex;align-items:center;gap:8px;font-size:21px;font-weight:600;color:#0E7490}
.nav a{font-size:15px;color:#475569;margin-right:8px;padding:8px 14px;border-radius:999px}.nav a.on{background:#CCFBF1;color:#134E4A;font-weight:600}
.sp{flex:1}.av{width:36px;height:36px;border-radius:50%;background:#0E7490;color:#fff;display:grid;place-items:center;font-weight:600;font-size:13px}
.pg{padding:16px 40px}
h1{font-size:30px;font-weight:600;letter-spacing:-.01em}
.sub{color:#475569;margin-top:2px}
.srch{display:flex;gap:10px;margin:12px 0 10px}
.in{flex:1;display:flex;align-items:center;gap:10px;background:#fff;border:1.5px solid #CCFBF1;border-radius:14px;padding:13px 16px;color:#64748b;box-shadow:0 6px 18px -12px #0891B2}
.b1{background:#0E7490;color:#fff;border-radius:14px;padding:13px 20px;font-weight:600;display:flex;gap:8px;align-items:center}
.chips{display:flex;gap:8px;margin-bottom:10px}.chips span{background:#fff;border:1px solid #CCFBF1;border-radius:999px;padding:6px 14px;font-size:14px;color:#475569}.chips .on{background:#134E4A;color:#fff;border-color:#134E4A}
.card{display:flex;align-items:center;gap:16px;background:#fff;border:1px solid #CCFBF1;border-radius:16px;padding:10px 18px;margin-bottom:8px;box-shadow:0 8px 22px -16px #0891B2}
.card.hot{background:#FFFBEB;border-color:#FDE68A}
.ini{width:44px;height:44px;border-radius:50%;background:#E8F1F6;color:#0E7490;display:grid;place-items:center;font-weight:600}
.nm{flex:1.3}.nm b{font-size:17px;font-weight:600;display:block}.nm span{font-size:13.5px;color:#475569}
.st{flex:2;display:flex;gap:8px;flex-wrap:wrap}
.pill{display:inline-flex;gap:6px;align-items:center;border-radius:999px;padding:4px 11px;font-size:13px;font-weight:500;background:#E8F1F6;color:#334155}
.pill.am{background:#FEF3C7;color:#92400E}.pill.gr{background:#DCFCE7;color:#166534}.pill.rd{background:#FEE2E2;color:#991B1B}
.open{display:flex;gap:6px;align-items:center;color:#0E7490;font-weight:600;border:1.5px solid #CCFBF1;border-radius:12px;padding:8px 14px}
.sw{position:absolute;left:40px;right:40px;bottom:14px;display:flex;gap:10px;align-items:center;font-size:12.5px;color:#475569}
.sw div{display:flex;align-items:center;gap:6px}.sw i{width:22px;height:22px;border-radius:6px;border:1px solid #0001}
.note{position:absolute;left:40px;bottom:46px;font-size:13px;color:#475569;display:flex;gap:7px;align-items:center}
"""
    def card(n,ini,meta,pills,hot=False):
        return f'<div class="card{" hot" if hot else ""}"><div class="ini">{ini}</div><div class="nm"><b>{n}</b><span>{meta}</span></div><div class="st">{pills}</div><div class="open">Open {ic("chev",16)}</div></div>'
    cards=card('Sunita Deshmukh','SD','52, female · OS-7F895F',f'<span class="pill">{ic("file",14)}8 documents</span><span class="pill am">{ic("alert",14)}5 not in file</span><span class="pill am">{ic("bell",14)}41 new</span>',True)
    cards+=card('Mohd. Abdul Rahim Khan','MK','64, male · OS-9EA40B',f'<span class="pill">{ic("file",14)}7 documents</span><span class="pill am">{ic("alert",14)}3 not in file</span><span class="pill gr">{ic("check",14)}Sealed 12 Nov</span>')
    cards+=card('Lakshmi Narayanan','LN','46, female · OS-7762A2',f'<span class="pill">{ic("file",14)}2 documents</span><span class="pill gr">{ic("check",14)}Nothing missing</span><span class="pill gr">{ic("check",14)}Sealed 8 Nov</span>')
    cards+=card('Aarav Kulkarni','AK','12, male · minor · OS-09596B',f'<span class="pill">{ic("file",14)}0 documents</span><span class="pill">Not yet sealed</span><span class="pill rd">{ic("users",14)}Minor: guardian consent</span>')
    sw=''.join(f'<div><i style="background:{c}"></i>{n} {c}</div>' for n,c in [('Primary','#0891B2'),('Secondary','#22D3EE'),('Accent','#16A34A'),('Background','#F0FDFA'),('Foreground','#134E4A'),('Border','#CCFBF1')])
    body=f"""<div class="top"><div class="logo">{ic('logo',24)}OncoSetu</div><div class="nav"><a class="on">Patients</a><a>Today</a></div><div class="sp"></div><div class="av">MI</div></div>
<div class="pg"><h1>Patients</h1><div class="sub">Each card shows what needs a look before the visit.</div>
<div class="srch"><div class="in">{ic('search',19)}Name, phone, hospital number or record code</div><div class="b1">{ic('users',18)}Register a patient</div></div>
<div class="chips"><span class="on">All 4</span><span>Needs a look 2</span><span>Minors 1</span><span>Sealed this week 2</span></div>
{cards}</div>
<div class="note">{ic('shield',15)}Document index, not a clinical summary. Status uses an icon and words, never colour alone.</div>
<div class="sw">{sw}</div>"""
    return doc(FONT_CURRENT,css,body,880,720)
