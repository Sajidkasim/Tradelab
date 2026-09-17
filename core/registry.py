"""Extension points. Register things here from your own modules and the UI picks them up.

    from core.registry import register_import_source
    register_import_source("MyBroker", read_fn=my_reader, source="csv", help="Export from Reports → Trades")

`read_fn(uploaded_file_or_path) -> pandas.DataFrame` returns raw rows; the Import page then runs the normal
column-mapping → preview → confirm flow on them. Put your module in `extensions/` and it is imported
automatically at start-up (any *.py there, alphabetical; a broken one is reported, not fatal).

Also available: register_coach_provider(name, fn) where fn(key, model, system, user) -> str.
"""
from __future__ import annotations

import importlib.util
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

import pandas as pd


@dataclass
class ImportSource:
    name: str
    read_fn: Callable[..., pd.DataFrame]
    source: str = "csv"                 # which Trade.source imported rows get
    help: str = ""
    file_types: list[str] = field(default_factory=lambda: ["csv", "xlsx", "json"])


IMPORT_SOURCES: dict[str, ImportSource] = {}
COACH_PROVIDERS: dict[str, Callable[..., str]] = {}
LOAD_ERRORS: dict[str, str] = {}


def register_import_source(name: str, read_fn: Callable[..., pd.DataFrame], source: str = "csv",
                           help: str = "", file_types: Optional[list[str]] = None) -> None:
    IMPORT_SOURCES[name] = ImportSource(name, read_fn, source, help, file_types or ["csv", "xlsx", "json"])


def register_coach_provider(name: str, fn: Callable[..., str]) -> None:
    COACH_PROVIDERS[name] = fn


_loaded = False


def load_extensions(folder: str | Path = "extensions") -> dict[str, str]:
    """Import every *.py in `folder` once. Returns {module: error} for any that failed."""
    global _loaded
    if _loaded:
        return LOAD_ERRORS
    _loaded = True
    folder = Path(folder)
    if not folder.exists():
        return LOAD_ERRORS
    for f in sorted(folder.glob("*.py")):
        if f.name.startswith("_"):
            continue
        spec = importlib.util.spec_from_file_location(f"extensions.{f.stem}", f)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)  # type: ignore[union-attr]
        except Exception as e:  # noqa: BLE001
            LOAD_ERRORS[f.stem] = str(e)
    return LOAD_ERRORS
