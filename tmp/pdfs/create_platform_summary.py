from reportlab.pdfgen import canvas
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.utils import simpleSplit
from reportlab.lib.pagesizes import A4
from pypdf import PdfReader

OUT='output/pdf/PrimusTrader-Platform-Review.pdf'
W,H=A4
c=canvas.Canvas(OUT,pagesize=A4)
c.setTitle('PrimusTrader | Platform & Security Review')
c.setAuthor('PrimusTrader - AI-assisted code review')
ink='#18352D'; muted='#5B7067'; lime='#D3E6AF'; paper='#F5F5EF'; line='#DDE4DA'
def rect(x,y,w,h,color,r=0):
 c.setFillColor(HexColor(color));c.setStrokeColor(HexColor(color))
 if r:c.roundRect(x,y,w,h,r,fill=1,stroke=0)
 else:c.rect(x,y,w,h,fill=1,stroke=0)
def text(x,y,s,size=10,color=ink,bold=False):
 c.setFillColor(HexColor(color));c.setFont('Helvetica-Bold' if bold else 'Helvetica',size);c.drawString(x,y,s)
def para(x,y,s,width,size=9.3,color=muted,leading=13):
 for row in simpleSplit(s,'Helvetica',size,width):text(x,y,row,size,color);y-=leading
 return y

def tick(x,y):
 c.setStrokeColor(HexColor('#397756'));c.setLineWidth(1.5)
 c.line(x,y+2,x+3,y-1);c.line(x+3,y-1,x+9,y+6)
def item(x,y,title,detail,width):
 tick(x,y);text(x+17,y,title,9.5,ink,True)
 return para(x+17,y-15,detail,width-17,8.7,muted,12)-15
rect(0,0,W,H,paper)
rect(0,H-213,W,213,ink)
text(36,H-38,'PRIMUS / TRADER',13,lime,True)
text(36,H-63,'PLATFORM & SECURITY REVIEW',8.5,'#BDD0C2',True)
text(36,H-102,'One workspace.',30,'#FFFFFF',True)
text(36,H-137,'A stronger foundation.',30,lime,True)
para(36,H-161,'Historical replay, trading journals and strategy analytics - supported by a private Python backend.',440,10,'#D6E1D7',14)
# Shield, drawn as vectors.
c.setStrokeColor(HexColor(lime));c.setLineWidth(1.5)
p=c.beginPath();p.moveTo(520,H-42);p.lineTo(548,H-52);p.lineTo(546,H-78);p.curveTo(542,H-94,530,H-101,520,H-106);p.curveTo(510,H-101,498,H-94,494,H-78);p.lineTo(492,H-52);p.close();c.drawPath(p)
c.line(507,H-70,517,H-80);c.line(517,H-80,535,H-60)
rect(36,H-231,W-72,34,lime,5)
text(48,H-218,'SECURITY REVIEWED',9,ink,True)
text(194,H-218,'Local fixes verified  /  9 November 2026',9,ink)
# Proof strip.
nums=[('11.3M','source candles'),('420','Python tests passed'),('96','frontend tests passed'),('3','security browser checks')]
col=(W-72)/4
for i,(value,label) in enumerate(nums):
 x=36+i*col
 text(x,H-274,value,23,ink,True);text(x,H-292,label,8,muted)
 if i<3:
  c.setStrokeColor(HexColor(line));c.line(x+col-14,H-260,x+col-14,H-296)
# Two cards.
ytop=H-319;cw=(W-86)/2
rect(36,244,cw,ytop-244,'#FFFFFF',7)
rect(50+cw,244,cw,ytop-244,'#FFFFFF',7)
text(50,ytop-23,'01 / WHAT THE PLATFORM DOES',8.3,muted,True)
y=ytop-48
for title,detail in [
 ('Historical NQ / ES replay','Saved sessions, chart tools and simulated orders with risk controls.'),
 ('Journal & strategy review','Account-based results, personal plans, screenshots and trading rules.'),
 ('Server-side financial engine','FastAPI handles execution and P&L. React presents the results.'),
 ('Bounded chart history','A 3,000-candle active window with historical paging on demand.')]:y=item(50,y,title,detail,cw-28)
x=64+cw;text(x,ytop-23,'02 / PROTECTIONS STRENGTHENED',8.3,muted,True);y=ytop-48
for title,detail in [
 ('Private workspace boundaries','Server-derived identity, write CSRF checks and private image keys.'),
 ('Safer uploads & downloads','Actual-byte request limits, CSV formula escaping and upload cleanup.'),
 ('Patched image processing','Pillow security update; npm and Python advisory scans clean afterward.'),
 ('Browser protections','Added CSP restrictions and hosted-only HSTS. Private responses stay uncached.')]:y=item(x,y,title,detail,cw-28)
# Performance callout.
rect(36,151,W-72,77,ink,7)
text(50,208,'LEANER STARTUP. MORE RELIABLE RECOVERY.',9,lime,True)
text(50,179,'22%',21,'#FFFFFF',True);text(112,181,'smaller main JavaScript',9,'#D6E1D7')
text(310,179,'45%',21,'#FFFFFF',True);text(372,181,'less Journal startup data',9,'#D6E1D7')
text(50,162,'Local samples; replay opening stayed around 1.8-1.9 seconds.',8,'#D6E1D7')
text(36,130,'VERIFIED LOCALLY. CLEAR ABOUT THE LIMITS.',8.5,ink,True)
para(36,115,'A two-minute replay/save/resume soak passed. Read-only Supabase checks found no direct browser-role access to private journal/auth tables.',W-72,8.5,muted,11)
para(36,87,'Fixes await deployment. This AI-assisted code review is not an independent security certification or a guarantee of zero vulnerabilities. A hosted password-protection advisory remains documented.',W-72,8,muted,10.5)
c.setStrokeColor(HexColor(line));c.line(36,43,W-36,43)
text(36,29,'Evidence: SECURITY_AUDIT.md and PERFORMANCE.md',7.5,muted)
text(W-105,29,'REVIEW / 01',7.5,muted,True)
c.showPage();c.save()
r=PdfReader(OUT);assert len(r.pages)==1
assert '420' in r.pages[0].extract_text()
print(OUT)
