from lib import *
from mocks1 import doc

# ---------- C: All records, light ----------
def mock_C_light():
    css=SCAN_CSS+"""
body{font-family:'Instrument Sans',sans-serif;background:#f5f4f0;color:#1b1c1a;font-size:14px;line-height:1.45;position:relative}
.top{display:flex;align-items:center;gap:18px;padding:0 28px;height:52px;background:#faf9f5;border-bottom:1px solid #e3e0d8}
.logo{display:flex;align-items:center;gap:7px;font-size:18px;font-weight:500}.logo svg{color:#0f6e6a}
.sp{flex:1}.av{width:30px;height:30px;border-radius:50%;background:#e2efed;color:#0b5c58;display:grid;place-items:center;font-weight:600;font-size:12px}
.pg{padding:12px 28px}
.who{display:flex;align-items:baseline;gap:12px}.who h1{font-size:25px;font-weight:500;letter-spacing:-.015em}.who span{color:#5c5a55;font-size:13.5px}
.tabs{display:flex;gap:22px;margin-top:10px;border-bottom:1px solid #e3e0d8;font-size:14px;color:#5c5a55}.tabs span{padding:8px 0}.tabs .on{color:#1b1c1a;font-weight:600;box-shadow:0 2px 0 #0f6e6a}
.safe{display:flex;gap:7px;align-items:center;font-size:12.5px;color:#3e6447;background:#e6eee4;border-radius:6px;padding:6px 11px;margin:10px 0 8px}
.bar{display:flex;gap:7px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
.ch{border:1px solid #cfccc3;background:#fff;border-radius:999px;padding:5px 12px;font-size:13px;color:#3a3935;display:flex;gap:6px;align-items:center}.ch.on{background:#1b1c1a;color:#fff;border-color:#1b1c1a}.ch b{font-weight:600}
.dd{margin-left:auto;display:flex;gap:8px;font-size:13px;color:#3a3935}.dd span{border:1px solid #cfccc3;background:#fff;border-radius:6px;padding:5px 10px;display:flex;gap:5px;align-items:center}
.row{display:grid;grid-template-columns:60px 84px 1fr;gap:12px;padding:8px 0;border-top:1px solid #e3e0d8;align-items:start}
.dt{font-size:13px;color:#3a3935;font-weight:600;line-height:1.25}.dt small{display:block;font-weight:400;color:#6a6862;font-size:12px}
.th{width:84px;height:62px}
.ico{width:84px;height:62px;border-radius:3px;background:#eae8e2;display:grid;place-items:center;color:#55534e}
.ti{display:flex;gap:7px;align-items:center;flex-wrap:wrap}.ti b{font-size:15px;font-weight:600}
.tag{font-size:11.5px;font-weight:600;border-radius:4px;padding:2px 7px}.t-s{background:#ebe7f5;color:#553f9e}.t-r{background:#e2efed;color:#0b5c58}.t-l{background:#f9eed6;color:#875500}.t-p{background:#e6eee4;color:#3e6447}
.src{font-size:12.5px;color:#6a6862;margin-top:1px}
.q{margin-top:4px;font-size:13px;color:#1b1c1a;background:#ffecb3;border-radius:3px;padding:2px 7px;display:inline-block}
.q a{color:#0b5c58;border-bottom:1px solid #0b5c5880;margin-left:6px;font-size:12px}
.cmp{margin-top:5px;font-size:12.5px;color:#553f9e;display:flex;gap:6px;align-items:center}
.cmp u{text-decoration:none;border:1px solid #cfc8e8;border-radius:4px;padding:1px 7px;background:#f4f1fa}
"""
    def row(date,yr,th,tag,tcls,title,src,quote,cmp=None):
        c=f'<div class="cmp">{ic("scan",14)}Earlier same body part: {cmp}</div>' if cmp else ''
        return f'<div class="row"><div class="dt">{date}<small>{yr}</small></div>{th}<div><div class="ti"><span class="tag {tcls}">{tag}</span><b>{title}</b></div><div class="src">{src}</div><div class="q">{quote}<a>source p.1</a></div>{c}</div></div>'
    s=lambda cls='':f'<div class="th scan {cls}"><i>SYNTHETIC</i></div>'
    ico=lambda n:f'<div class="ico">{ic(n,28)}</div>'
    rows=row('04 Nov','2026',s(),'Scan + report','t-s','CT chest, with contrast','Narmada Regional Cancer Centre, Radiology','Comparison: CT chest of 12 Aug 2026.','<u>12 Aug</u><u>18 Mar</u>')
    rows+=row('22 Oct','2026',ico('flask'),'Lab','t-l','Complete blood count','Sanjeevani Pathology Laboratory','Haemoglobin 11.8 g/dL')
    rows+=row('09 Oct','2026',ico('pill'),'Prescription','t-p','Prescription, Dr. Meera Iyer','Narmada Regional Cancer Centre, OPD','Tab. Letrozole 2.5 mg, once daily')
    rows+=row('12 Aug','2026',s(),'Scan + report','t-s','CT chest, with contrast','Narmada Regional Cancer Centre, Radiology','Comparison: CT chest of 18 Mar 2026.','<u>18 Mar</u>')
    rows+=row('03 Jun','2026',s('pet'),'Scan + report','t-s','PET-CT, whole body','Madhyam Nuclear Imaging Centre','Report awaited; addendum dated 05 Jun 2026.')
    body=f"""<div class="top"><div class="logo">{ic('logo',20)}OncoSetu</div><div class="sp"></div><div class="av">MI</div></div>
<div class="pg"><div class="who"><h1>Sunita Deshmukh</h1><span>52 y · female · OS-7F895F</span></div>
<div class="tabs"><span>Overview</span><span class="on">All records 14</span><span>To do 5</span><span>People &amp; consent</span><span>More</span></div>
<div class="safe">{ic('shield',15)}Scans are stored and shown, not read. Report lines are quoted from the source. Not a clinical summary.</div>
<div class="bar"><span class="ch on">All <b>14</b></span><span class="ch">Reports <b>5</b></span><span class="ch">{ic('scan',13)}Scans <b>4</b></span><span class="ch">Labs <b>3</b></span><span class="ch">Prescriptions <b>2</b></span>
<div class="dd"><span>Body part: All {ic('down',13)}</span><span>Newest first {ic('down',13)}</span></div></div>
{rows}</div>"""
    return doc(FONT_CURRENT,css,body,700,760)

# ---------- C: reading room, dark ----------
def mock_C_dark():
    css=SCAN_CSS+"""
body{font-family:'Instrument Sans',sans-serif;background:#0b0d10;color:#d9dce0;font-size:14px;line-height:1.45;position:relative}
.top{display:flex;align-items:center;gap:14px;padding:0 24px;height:52px;border-bottom:1px solid #1f2328}
.top b{font-weight:600;color:#fff;font-size:15px}.top span{color:#8b929a;font-size:13px}
.sp{flex:1}.x{border:1px solid #2b3036;border-radius:6px;padding:5px 11px;font-size:13px;color:#c5cad0}
.pg{padding:14px 24px}
.safe{display:flex;gap:7px;align-items:center;font-size:12.5px;color:#9fd0b0;border:1px solid #23402d;border-radius:6px;padding:7px 11px;margin-bottom:12px}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pane .hd{display:flex;justify-content:space-between;font-size:13px;margin-bottom:6px;color:#c5cad0}.pane .hd b{color:#fff;font-weight:600}
.pane .scan{width:100%;height:268px;border:1px solid #1f2328}
.ov{position:absolute;font:500 10.5px/1.3 'JetBrains Mono',monospace;color:#c8ccd1;z-index:3}
.pane .qt{margin-top:7px;font-size:13px;color:#fff;background:#3a3010;border-left:3px solid #ffd84a;padding:5px 9px;border-radius:2px}
.pane .qt a{color:#7fd1ff;margin-left:6px;font-size:12px;border-bottom:1px solid #7fd1ff80}
.tools{display:flex;gap:8px;margin:12px 0;font-size:13px;color:#c5cad0;flex-wrap:wrap}.tools span{border:1px solid #2b3036;border-radius:6px;padding:5px 11px;display:flex;gap:6px;align-items:center}.tools .on{background:#1c2a3a;border-color:#2f4d70;color:#cfe6ff}
.lab{font-size:12.5px;color:#8b929a;margin:6px 0 7px}
.film{display:flex;gap:10px}.fi{width:150px}.fi .scan{width:150px;height:88px;border:2px solid #1f2328}.fi.sel .scan{border-color:#4aa3ff}
.fi div{font-size:12.5px;margin-top:4px;color:#c5cad0}.fi small{color:#8b929a;display:block;font-size:11.5px}
.rep{margin-top:12px;border-top:1px solid #1f2328;padding-top:10px;font-size:12.5px;color:#8b929a;display:flex;gap:7px;align-items:center}
"""
    body=f"""<div class="top"><b>Reading room</b><span>Sunita Deshmukh · CT chest · 2 of 3 earlier scans</span><div class="sp"></div><div class="x">Back to all records</div></div>
<div class="pg"><div class="safe">{ic('shield',15)}Images are shown, not interpreted. Report words below are quoted from the source. Not a clinical summary.</div>
<div class="pair">
<div class="pane"><div class="hd"><b>12 Aug 2026</b><span>CT chest · earlier</span></div><div class="scan"><i>SYNTHETIC IMAGE</i><div class="ov" style="left:8px;top:7px">Se 3 · Im 42/118<br>5.0 mm</div><div class="ov" style="right:8px;top:7px;text-align:right">12 Aug 2026</div></div>
<div class="qt">Comparison: CT chest of 18 Mar 2026.<a>source p.1</a></div></div>
<div class="pane"><div class="hd"><b>04 Nov 2026</b><span>CT chest · latest</span></div><div class="scan"><i>SYNTHETIC IMAGE</i><div class="ov" style="left:8px;top:7px">Se 3 · Im 42/121<br>5.0 mm</div><div class="ov" style="right:8px;top:7px;text-align:right">04 Nov 2026</div></div>
<div class="qt">Comparison: CT chest of 12 Aug 2026.<a>source p.1</a></div></div></div>
<div class="tools"><span class="on">{ic('link' if False else 'list',14)}Sync scroll</span><span>Window: soft tissue</span><span>Window: lung</span><span>{ic('ext',14)}Open in full viewer</span></div>
<div class="lab">All chest scans, oldest to newest. Tick two to compare.</div>
<div class="film"><div class="fi"><div class="scan"><i>SYNTHETIC</i></div><div>18 Mar 2026<small>CT chest</small></div></div><div class="fi sel"><div class="scan"><i>SYNTHETIC</i></div><div>12 Aug 2026<small>CT chest, selected</small></div></div><div class="fi sel"><div class="scan"><i>SYNTHETIC</i></div><div>04 Nov 2026<small>CT chest, selected</small></div></div></div>
<div class="rep">{ic('file',15)}Reports for these scans are filed beside each image. Nothing here is a diagnosis.</div></div>"""
    return doc(FONT_CURRENT,css,body,700,760)

# ---------- D: patient portal phone ----------
def mock_D():
    css="""
body{font-family:'Figtree','Noto Sans Devanagari',sans-serif;background:#F0F9FF;color:#0C4A6E;font-size:16px;line-height:1.5;position:relative}
.top{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#fff;border-bottom:1px solid #BAE6FD}
.logo{display:flex;align-items:center;gap:6px;font-weight:700;font-size:18px;color:#0369A1}
.lang{display:flex;border:1.5px solid #0369A1;border-radius:10px;overflow:hidden;font-size:14px;font-weight:600}.lang span{padding:9px 11px;min-width:44px;text-align:center;color:#0369A1}.lang .on{background:#0369A1;color:#fff}
.pg{padding:16px 16px 0}
h1{font-size:28px;font-weight:700;line-height:1.3}
.sub{color:#334155;font-size:16px;margin:4px 0 14px;line-height:1.6}
.btn{display:flex;align-items:center;gap:14px;background:#fff;border:1.5px solid #BAE6FD;border-radius:18px;padding:12px 14px;margin-bottom:10px;min-height:76px;box-shadow:0 8px 18px -14px #0284C7}
.btn.p{background:#0369A1;border-color:#0369A1;color:#fff}
.ib{width:52px;height:52px;border-radius:14px;background:#E8F2F8;display:grid;place-items:center;color:#0369A1;flex:none}.p .ib{background:#ffffff26;color:#fff}
.btn b{font-size:19px;font-weight:700;display:block;line-height:1.3}.btn span{font-size:14.5px;color:#334155;display:block;line-height:1.4}.p span{color:#E0F2FE}
.btn .en{font-size:13px;color:#475569;font-weight:500}.p .en{color:#BAE6FD}
.arr{margin-left:auto;color:#0369A1}.p .arr{color:#fff}
.note{display:flex;gap:8px;font-size:13.5px;color:#475569;margin-top:6px;line-height:1.5}
.tab{position:absolute;left:0;right:0;bottom:0;height:68px;background:#fff;border-top:1px solid #BAE6FD;display:grid;grid-template-columns:repeat(3,1fr)}
.tab div{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:13px;font-weight:600;color:#475569}.tab .on{color:#0369A1}
"""
    def b(icn,hi,en,sub,p=False):
        return f'<div class="btn{" p" if p else ""}"><div class="ib">{ic(icn,28)}</div><div><b>{hi}</b><span class="en">{en}</span><span>{sub}</span></div><div class="arr">{ic("chev",22)}</div></div>'
    body=f"""<div class="top"><div class="logo">{ic('logo',24)}OncoSetu</div><div class="lang"><span>EN</span><span class="on">हिं</span><span>Hinglish</span></div></div>
<div class="pg"><h1>नमस्ते, रहीम जी</h1><div class="sub">यहाँ वे कागज़ हैं जो क्लिनिक को मिले हैं।</div>
{b('camera','कागज़ भेजें','Send papers','फ़ोटो खींचें या WhatsApp से भेजें',True)}
{b('file','मेरे कागज़','My papers','क्लिनिक को 7 कागज़ मिले हैं')}
{b('clip','विज़िट से पहले के सवाल','Questions before your visit','5 छोटे सवाल, बस टैप करें')}
{b('mail','जो कागज़ बाकी हैं','Papers still missing','3 कागज़ अभी फ़ाइल में नहीं हैं')}
<div class="note">{ic('shield',18)}<span>यह कागज़ों की सूची है, डॉक्टरी सारांश नहीं। मदद चाहिए तो क्लिनिक डेस्क से पूछें।</span></div></div>
<div class="tab"><div class="on">{ic('home',24)}होम</div><div>{ic('file',24)}कागज़</div><div>{ic('help',24)}मदद</div></div>"""
    return doc(FONT_MEDICAL,css,body,375,740)

# ---------- E: typography on admin dashboard ----------
def mock_E():
    css="""
body{font-family:'Noto Sans',sans-serif;background:#f6f7f8;color:#1e293b;font-size:16px;line-height:1.6;position:relative}
.top{display:flex;align-items:center;gap:26px;padding:0 44px;height:60px;background:#fff;border-bottom:1px solid #e2e8f0}
.logo{display:flex;align-items:center;gap:8px;font-family:'Figtree';font-size:21px;font-weight:600;color:#0f6e6a}
.nav a{font-family:'Figtree';font-size:15px;font-weight:600;color:#0f172a;border-bottom:2px solid #0f6e6a;padding-bottom:8px}
.sp{flex:1}.av{width:34px;height:34px;border-radius:50%;background:#e2efed;color:#0b5c58;display:grid;place-items:center;font-family:'Figtree';font-weight:600;font-size:13px}
.pg{padding:18px 44px 0}
.eb{font-size:14px;color:#475569}
h1{font-family:'Figtree';font-size:34px;font-weight:600;letter-spacing:-.01em;line-height:1.2;margin:2px 0 4px;color:#0f172a}
.sub{color:#475569;max-width:640px}
.g{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:14px}
.c{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px}
.c h3{font-family:'Figtree';font-size:15px;font-weight:600;color:#475569}
.c .n{font-family:'Figtree';font-size:34px;font-weight:600;line-height:1.1;font-variant-numeric:tabular-nums;color:#0f172a;margin:4px 0}
.c p{font-size:14px;color:#475569;line-height:1.45}
.spec{margin-top:14px;background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:16px 18px;display:grid;grid-template-columns:1fr 1fr;gap:18px}
.spec h4{font-family:'Figtree';font-size:13px;font-weight:700;color:#0f6e6a;margin-bottom:6px}
.old{font-family:'JetBrains Mono',monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6a6862}
.new{font-family:'Figtree';font-size:16px;font-weight:600;color:#0f172a}
.ln{display:flex;justify-content:space-between;align-items:center;border-top:1px solid #eef0f3;padding:5px 0;font-size:14px;color:#475569;gap:10px}
.ln:first-of-type{border-top:0}
.foot{position:absolute;left:44px;right:44px;bottom:16px;font-size:13px;color:#475569;display:flex;gap:7px;align-items:center}
"""
    c=lambda t,n,d:f'<div class="c"><h3>{t}</h3><div class="n">{n}</div><p>{d}</p></div>'
    body=f"""<div class="top"><div class="logo">{ic('logo',22)}OncoSetu</div><div class="nav"><a>Admin</a></div><div class="sp"></div><div class="av">FS</div></div>
<div class="pg"><h1>Administration console</h1>
<div class="sub">Everything here is read from live records and every change is logged.</div>
<div class="g">{c('Blocked and held','3','Blocked or held in 30 days: 1 wrong-patient, 1 hidden-instruction.')}{c('Staff','5','Active accounts, roles and authenticators.')}{c('Rule library','10 of 10','Missing-papers checks in use.')}
{c('Activity log','335','Entries in the tamper-proof log. Filter, export, check.')}{c('Metrics','KPIs','Product health and safety targets.')}{c('Measurement study','0','Consultation forms in the baseline study.')}</div>
<div class="spec"><div><h4>What changes</h4>
<div class="ln"><span class="old">Blocked and held</span><span class="new">Blocked and held</span></div>
<div class="ln"><span>Headings: Instrument Sans</span><span class="new">Figtree 600</span></div>
<div class="ln"><span>Body: Inter Tight</span><span class="new" style="font-family:'Noto Sans';font-weight:400">Noto Sans 400</span></div>
<div class="ln"><span>Labels: JetBrains Mono caps</span><span class="new" style="font-family:'Noto Sans';font-weight:500;font-size:14px">Sentence case</span></div></div>
<div><h4>Hindi and English on one line</h4><div class="new" style="font-weight:600;font-size:20px;line-height:1.5">कागज़ भेजें · Send papers</div><div style="font-size:15px;color:#475569;margin-top:4px">Noto Sans Devanagari matches Noto Sans, so mixed Hindi and English lines keep one rhythm. Body 16px, line-height 1.6.</div></div></div></div>
<div class="foot">{ic('shield',15)}Document index, not a clinical summary. Synthetic demo data.</div>"""
    return doc(FONT_MEDICAL.replace('&display=swap','')+'&family=JetBrains+Mono:wght@400;500&family=Instrument+Sans:wght@400;500&display=swap', css, body, 880, 720)

# ---------- F: navigation ----------
def mock_F():
    css="""
body{font-family:'Instrument Sans',sans-serif;background:#faf9f6;color:#1b1c1a;font-size:15px;line-height:1.5;position:relative}
.top{display:flex;align-items:center;gap:28px;padding:0 44px;height:60px;border-bottom:1px solid #e3e0d8;background:#fff}
.logo{display:flex;align-items:center;gap:8px;font-size:21px;font-weight:500}.logo svg{color:#0f6e6a}
.nav a{font-size:15px;color:#5c5a55;margin-right:22px}.nav a.on{color:#1b1c1a;font-weight:600;border-bottom:2px solid #0f6e6a;padding-bottom:8px}
.sp{flex:1}.av{width:34px;height:34px;border-radius:50%;background:#e2efed;color:#0b5c58;display:grid;place-items:center;font-weight:600;font-size:13px}
.pg{padding:20px 44px 0}
h1{font-size:30px;font-weight:500;letter-spacing:-.015em;line-height:1.2}
.meta{color:#5c5a55;font-size:14.5px;margin-top:2px}
.tabs{display:flex;gap:6px;margin-top:14px;border-bottom:1px solid #e3e0d8;position:relative}
.tabs span{padding:10px 16px;font-size:15px;color:#5c5a55;display:flex;gap:7px;align-items:center}.tabs .on{color:#1b1c1a;font-weight:600;box-shadow:0 2px 0 #0f6e6a}
.tabs em{font-style:normal;font-size:12px;background:#eae8e2;border-radius:10px;padding:0 7px;color:#3a3935}.tabs em.a{background:#f9eed6;color:#875500;font-weight:600}
.menu{position:absolute;right:0;top:44px;width:250px;background:#fff;border:1px solid #d9d6ce;border-radius:8px;box-shadow:0 14px 30px -14px #1b1c1a55;padding:6px;z-index:3}
.menu small{display:block;font-size:12px;color:#6a6862;padding:6px 10px 2px;font-weight:600}.menu div{padding:7px 10px;border-radius:5px;font-size:14.5px}.menu div:hover{background:#f5f4f0}
.next{margin-top:22px;border:1.5px solid #0f6e6a;background:#e2efed66;border-radius:12px;padding:20px 22px;display:flex;align-items:center;gap:22px;width:560px}
.next .l{font-size:12.5px;font-weight:700;color:#0b5c58;margin-bottom:2px}.next h2{font-size:21px;font-weight:600;line-height:1.3}.next p{font-size:14px;color:#5c5a55;margin-top:3px}
.btn{display:inline-flex;gap:8px;align-items:center;background:#0f6e6a;color:#fff;font-weight:600;border-radius:8px;padding:12px 18px;white-space:nowrap}
.q{margin-top:14px;font-size:14.5px;color:#5c5a55;display:flex;gap:22px}.q b{color:#1b1c1a}
.map{position:absolute;left:44px;bottom:52px;width:560px;border-top:1px solid #e3e0d8;padding-top:12px;font-size:13.5px;color:#3a3935}
.map h4{font-size:13px;font-weight:700;color:#0b5c58;margin-bottom:6px}.map div{display:flex;gap:8px;padding:3px 0}.map b{width:132px;font-weight:600;flex:none}
.foot{position:absolute;left:44px;right:44px;bottom:16px;font-size:13px;color:#5c5a55;display:flex;gap:7px;align-items:center}
"""
    body=f"""<div class="top"><div class="logo">{ic('logo',22)}OncoSetu</div><div class="nav"><a class="on">Patients</a><a>Today</a></div><div class="sp"></div><div class="av">MI</div></div>
<div class="pg"><h1>Mohd. Abdul Rahim Khan</h1><div class="meta">64 years, male · OS-9EA40B · diagnosis may be discussed</div>
<div class="tabs"><span class="on">Overview</span><span>Records<em>7</em></span><span>To do<em class="a">3</em></span><span>People &amp; consent</span><span>More {ic('down',14)}</span>
<div class="menu"><small>INSURANCE</small><div>Pre-auth file</div><small>AUDIT</small><div>Activity log</div></div></div>
<div class="next"><div><div class="l">NEXT STEP</div><h2>3 papers are not in the file</h2><p>The discharge summary mentions a lab report as pending. Nothing here says it was not done.</p></div><div class="btn">Make a request letter {ic('arrow',17)}</div></div>
<div class="q"><span><b>0</b> new since last visit</span><span><b>0</b> held</span><span><b>22</b> not yet checked against the page</span></div></div>
<div class="map"><h4>WHERE THE 11 OLD TABS WENT</h4>
<div><b>Records</b>Documents, Timeline</div><div><b>To do</b>What's new, Missing papers, Requests</div><div><b>People &amp; consent</b>Share links, Consent &amp; access, Patient's own answers</div><div><b>More</b>Pre-auth file, Activity log</div></div>
<div class="foot">{ic('shield',15)}Document index, not a clinical summary. Synthetic demo data.</div>"""
    return doc(FONT_CURRENT,css,body,880,720)
