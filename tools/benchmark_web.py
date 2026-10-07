"""Reproducible local timings using 1,000 synthetic trades in a temporary database."""
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
import statistics
import sys
from tempfile import TemporaryDirectory
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from core import edge
from core.models import Trade, Direction, Source
from webapp.app import create_app
from webapp.config import Settings


def main():
    with TemporaryDirectory(prefix="primus-benchmark-") as folder:
        config = Settings(str(Path(folder) / "test.db"), "benchmark@primuslab.invalid", "local-benchmark-only", "http://127.0.0.1:8100", local=True)
        app = create_app(config)
        with TestClient(app, base_url=config.public_url, client=("127.0.0.1", 1)) as client:
            rows = []
            for index in range(1000):
                clock = datetime(2026, 1, 1, 15, tzinfo=timezone.utc) + timedelta(days=index // 10, minutes=index % 10)
                rows.append(Trade("NQ", Direction.LONG, 1, clock, 18000,
                                  exit_time=clock + timedelta(minutes=10), exit_price=18010 if index % 3 else 17995,
                                  stop_price=17995, multiplier=20, source=Source.BACKTEST,
                                  external_id=f"synthetic-{index}", account_id=1, setup_name="Synthetic setup",
                                  tags=edge.write_labels(level="FVG", timeframe="4H", confirmations=["SMT", "CISD"])))
            app.state.workspaces.root.insert_trades(rows)
            headers = {"X-Primus-CSRF": client.get('/api/session').json()['csrf'], "Origin": config.public_url}
            payload = {"strategy": "Synthetic setup", "confirmations": ["SMT", "CISD"]}
            durations = []
            for iteration in range(16):
                start = perf_counter()
                result = client.post('/api/results', json=payload, headers=headers)
                elapsed = (perf_counter() - start) * 1000
                assert result.status_code == 200, result.text
                assert result.json()['stats']['trades'] == 1000
                if iteration:
                    durations.append(elapsed)
            print(f"Synthetic sample: 1,000 trades; 15 warm HTTP requests")
            print(f"Setup results API: median {statistics.median(durations):.1f} ms; max {max(durations):.1f} ms")
            print("Includes access check, filtering, core metrics and chart JSON. Local SQLite only; not a hosted latency prediction.")


if __name__ == '__main__':
    main()
