from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor
from reportlab.lib.utils import simpleSplit
from pypdf import PdfReader
P='output/pdf/PrimusTrader-Security-Now-and-Next.pdf'
W,H=A4;c=canvas.Canvas(P,pagesize=A4);c.setTitle('PrimusTrader | Security Now & Next');c.setAuthor('PrimusTrader - AI-assisted review')
G='#18352D';M='#5B7067';L='#D3E6AF';BG='#F5F5EF'
def box(x,y,w,h,col,r=0):
 c.setFillColor(HexColor(col));c.roundRect(x,y,w,h,r,fill=1,stroke=0)
def t(x,y,s,n=10,col=G,b=False):
 c.setFillColor(HexColor(col));c.setFont('Helvetica-Bold' if b else 'Helvetica',n);c.drawString(x,y,s)
def p(x,y,s,w,n=9,col=M,leading=12):
 for line in simpleSplit(s,'Helvetica',n,w):t(x,y,line,n,col);y-=leading
 return y
def check(x,y):
 c.setStrokeColor(HexColor('#397756'));c.setLineWidth(1.5);c.line(x,y+2,x+3,y-1);c.line(x+3,y-1,x+9,y+6)
def row(x,y,title,desc,w,num=None):
 if num:
  box(x-2,y-3,15,15,L,7);t(x+2,y+1,str(num),8,G,True)
 else:check(x,y)
 t(x+20,y,title,9.6,G,True)
 p(x+20,y-15,desc,w-20,8.6,M,11.7)
box(0,0,W,H,BG)
box(0,H-199,W,199,G)
t(36,H-36,'PRIMUS / TRADER',13,L,True)
t(36,H-59,'SECURITY OVERVIEW  /  9 NOVEMBER 2026',8.5,'#BDD0C2',True)
t(36,H-98,'Protection today.',30,'#FFFFFF',True)
t(36,H-134,'Confidence for tomorrow.',29,L,True)
p(36,H-158,'Layered safeguards for private trading records, journals and screenshots. A clear roadmap for the next level of protection.',440,10,'#D6E1D7',14)
# Shield emblem.
c.setStrokeColor(HexColor(L));c.setLineWidth(1.4)
s=c.beginPath();s.moveTo(524,H-35);s.lineTo(549,H-45);s.lineTo(547,H-70);s.curveTo(543,H-86,532,H-94,524,H-98);s.curveTo(514,H-94,503,H-86,500,H-70);s.lineTo(498,H-45);s.close();c.drawPath(s)
c.line(512,H-61,521,H-70);c.line(521,H-70,537,H-51)
box(36,H-219,W-72,34,L,5)
t(48,H-206,'REVIEWED & TESTED',9,G,True)
t(200,H-206,'Local fixes verified. Hosted rollout still required.',8.8,G)
# Evidence band.
for i,(value,label) in enumerate([('420','Python checks passed'),('96','frontend checks passed'),('3','browser checks passed'),('0','known dependency advisories*')]):
 x=36+i*(W-72)/4;t(x,H-258,value,22,G,True);t(x,H-276,label,7.5,M)
t(36,H-292,'* Latest recorded npm / Python scans after patching; not a guarantee of zero vulnerabilities.',7.5,M)
# Columns.
top=H-311;bottom=169;cw=(W-86)/2
for x in (36,50+cw):box(x,bottom,cw,top-bottom,'#FFFFFF',7)
x=50;t(x,top-22,'01 / SECURITY IN PLACE',9,G,True);t(x,top-38,'Existing controls + locally verified fixes',8,M)
left=[
('Server-side access control','The backend derives identity and workspace access; browser IDs do not grant ownership.'),
('Protected sessions','Hosted cookies use Secure, HttpOnly and SameSite. Sessions rotate at sign-in.'),
('Private user data','Workspace isolation, CSRF checks and private image keys protect personal records.'),
('Safer screenshots','Format and pixel validation, re-encoding and a patched Pillow image library.'),
('Bounded requests & safe CSVs','Streamed-body limits before parsing; formula-like text escaped on CSV export.'),
('Browser & transport safeguards','CSP restrictions, hosted-only HSTS, nosniff and anti-framing headers.')]
y=top-62
for title,desc in left:row(x,y,title,desc,cw-28);y-=49
x=64+cw;t(x,top-22,'02 / COMING NEXT',9,G,True);t(x,top-38,'Proposed improvements - not yet implemented',7.8,M)
right=[
('Admin MFA & recovery','Strengthen GitHub, hosting, database and Google admin accounts against takeover.'),
('Automated security scans','Run dependency and secret checks in CI before changes reach production.'),
('Rate limits & timeouts','Reduce repeated expensive requests and slow-upload resource exhaustion.'),
('Backups tested for recovery','Confirm that journals and trading records can actually be restored.'),
('Security logs & alerts','Spot login failures, access denials and errors without logging secrets.'),
('Repeat access-isolation tests','Check that new private endpoints cannot expose another user\'s records.'),
('Stricter script-source CSP','Further limit script origins after chart, video and widget compatibility tests.')]
y=top-62
for i,(title,desc) in enumerate(right,1):row(x,y,title,desc,cw-28,i);y-=42
# Priorities and scope.
box(36,104,W-72,51,G,6)
t(49,137,'NEXT RELEASE: DEPLOY, THEN VERIFY',9,L,True)
p(49,122,'Apply local fixes to hosting, rebuild patched dependencies and check production headers and sign-in behavior. Review password protection if Supabase password login is enabled.',W-98,8.4,'#D6E1D7',11)
p(36,85,'Many next steps have free tooling; provider costs vary. Scans run outside page visits. Rate limits and a stricter CSP need careful testing to avoid disrupting normal use.',W-72,8.2,M,11)
p(36,54,'AI-assisted code review, not an independent security certification. Sources: SECURITY_AUDIT.md and recorded test results. Roadmap items are proposals, not delivery commitments.',W-72,7.4,M,10)
c.setStrokeColor(HexColor('#DDE4DA'));c.line(36,25,W-36,25);t(36,14,'PRIVATE WORKSPACES. PRACTICAL PROTECTIONS. CONTINUOUS IMPROVEMENT.',7,M);t(W-67,14,'01 / 01',7,M)
c.showPage();c.save()
r=PdfReader(P);assert len(r.pages)==1
text=r.pages[0].extract_text();assert 'COMING NEXT' in text and '420' in text
print(P)
