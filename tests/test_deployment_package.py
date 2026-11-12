"""Exercise backend startup using only files copied into the Docker runtime stage."""
from pathlib import Path
import shlex
import shutil
import subprocess
import sys


def test_docker_runtime_backend_starts_without_checkout_on_python_path(tmp_path):
    repo = Path(__file__).resolve().parents[1]
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    copies = []
    for line in (repo / "Dockerfile.web").read_text().splitlines():
        parts = shlex.split(line)
        if not parts:
            continue
        if parts[0].upper() == "FROM":
            copies = []
        elif parts[0].upper() == "COPY" and not parts[1].startswith("--from="):
            copies.append(parts[1:])
    for copy in copies:
        destination = runtime / copy[-1].lstrip("/")
        for source in copy[:-1]:
            source_path = repo / source
            if source_path.is_dir():
                shutil.copytree(source_path, destination, dirs_exist_ok=True,
                                ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
            else:
                destination.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_path, destination / source_path.name)

    # -I excludes the developer checkout/PYTHONPATH. Use an isolated local config;
    # never read deployment secrets or connect to the production database.
    check = """
import sys
from pathlib import Path
sys.path.insert(0, str(Path.cwd()))
sys.modules['streamlit'] = None
from fastapi.testclient import TestClient
from webapp.app import create_app
from webapp.config import Settings
config = Settings(str(Path.cwd() / 'smoke.db'), 'owner@example.com',
                  'isolated-package-smoke-secret-with-enough-characters',
                  'http://127.0.0.1:8100', local=True,
                  lab_path='/lab', site_preview=True)
app = create_app(config)
with TestClient(app, base_url=config.public_url, client=('127.0.0.1', 12345)) as client:
    assert client.get('/health').status_code == 200
    assert client.get('/ready').json() == {'status': 'ready'}
    assert client.get('/api/resources?section=learn').status_code == 200
    assert client.get('/api/market-lab').status_code == 200
    assert client.get('/api/vision-board').status_code == 200
print('Packaged backend startup and new API routes passed')
"""
    result = subprocess.run([sys.executable, "-I", "-c", check], cwd=runtime,
                            capture_output=True, text=True, timeout=60,
                            env={"PYTHONIOENCODING": "utf-8"})
    assert result.returncode == 0, result.stdout + result.stderr
