"""Example extension (leading underscore = not loaded). Copy to e.g. extensions/mybroker.py and edit.

Registers an import source that appears as its own tab on the Import page. The function receives
whatever the user uploaded (a file-like object) and must return a DataFrame of raw rows; the app's
column mapper handles the rest.
"""
import pandas as pd

from core.registry import register_import_source


def read_mybroker(uploaded) -> pd.DataFrame:
    df = pd.read_csv(uploaded)
    # any broker-specific clean-up goes here, e.g. dropping summary rows:
    return df[df.iloc[:, 0].notna()]


register_import_source("MyBroker", read_mybroker, source="csv",
                       help="Export from MyBroker → Reports → Trade history (CSV).")
