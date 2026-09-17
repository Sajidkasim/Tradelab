"""Screenshot helper: python shoot.py <page-path> <out.png> [width] [--demo]"""
import subprocess, sys, time, os, signal
from playwright.sync_api import sync_playwright
page = sys.argv[1] if len(sys.argv) > 1 else ""
out = sys.argv[2] if len(sys.argv) > 2 else "shot.png"
width = int(sys.argv[3]) if len(sys.argv) > 3 else 1440
env = dict(os.environ, TRADELAB_DB_URL="sqlite:///data/shoot.db")
proc = subprocess.Popen(["python3", "-m", "streamlit", "run", "app.py", "--server.port", "8599", "--server.headless", "true",
                         "--browser.gatherUsageStats", "false"], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
try:
    time.sleep(4)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(locale="en-GB", timezone_id="Europe/London", color_scheme=os.environ.get("SHOOT_SCHEME", "dark"), viewport={"width": width, "height": int(sys.argv[4]) if len(sys.argv) > 4 else 2600})
        pg.goto(f"http://localhost:8599/{page}", wait_until="networkidle", timeout=60000)
        pg.wait_for_timeout(2500)
        # dismiss any 'running' overlays and wait for charts
        pg.wait_for_timeout(1500)
        pg.screenshot(path=out, full_page=True)
        # dump console errors + exceptions shown on page
        errs = pg.locator("div[data-testid='stException']").all_inner_texts()
        if errs: print("PAGE EXCEPTIONS:\n" + "\n".join(errs)[:3000])
        b.close()
finally:
    proc.send_signal(signal.SIGINT); 
    try: out_ = proc.communicate(timeout=5)[0].decode()[-1500:]
    except Exception: proc.kill(); out_ = ""
    if "Error" in out_ or "Traceback" in out_: print("SERVER LOG:\n", out_)
print("wrote", out)
