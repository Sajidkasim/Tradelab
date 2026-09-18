@echo off
REM One-click start for Windows. First run installs; later runs just start.
cd /d "%~dp0"
if not exist .venv (
  echo Creating environment...
  python -m venv .venv || (echo Python 3.10+ is required: https://www.python.org/downloads/ & pause & exit /b 1)
  call .venv\Scripts\activate.bat
  python -m pip install --upgrade pip >nul
  pip install -r requirements.txt
  python -m pytest -q || (echo Tests failed - see above. & pause & exit /b 1)
) else (
  call .venv\Scripts\activate.bat
)
if not exist .env copy .env.example .env >nul
set PRIMUSLAB_LOCAL_ONLY=1
python -m streamlit run app.py --server.address 127.0.0.1
