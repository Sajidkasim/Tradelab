import React, { useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { api } from "./api";
import { Heading, Button, Field, Select, Stat, Notice } from "./components";
import { money, number } from "./format";

export default function Tools({ meta, onResults }) {
  const [symbol, setSymbol] = useState(
    meta.instruments.NQ ? "NQ" : Object.keys(meta.instruments)[0],
  );
  const [account, setAccount] = useState(meta.accounts[0]?.id);
  const [entry, setEntry] = useState(""),
    [stop, setStop] = useState(""),
    [risk, setRisk] = useState("250");
  const [data, setData] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  function change(setter, value) {
    setter(value);
    setData(null);
  }
  async function calculate(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      setData(
        await api("/tools/position-size", {
          method: "POST",
          body: {
            symbol,
            account_id: Number(account),
            entry: Number(entry),
            stop: Number(stop),
            risk_dollars: Number(risk),
          },
        }),
      );
    } catch (error) {
      setError(error.message);
      setData(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="Tools" />
      <section className="card tool-card">
        <h2>Position size</h2>
        <p className="muted">
          Plan contracts from your entry, original stop and dollar risk.
        </p>
        <form onSubmit={calculate} className="stack">
          <div className="form-grid two">
            <Select
              label="Market"
              values={Object.keys(meta.instruments)}
              value={symbol}
              onChange={(event) => change(setSymbol, event.target.value)}
            />
            <Select
              label="Account"
              values={meta.accounts.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              value={account}
              onChange={(event) => change(setAccount, event.target.value)}
            />
          </div>
          <div className="form-grid">
            <Field label="Entry price">
              <input
                type="number"
                step="any"
                min="0.000001"
                required
                value={entry}
                onChange={(event) => change(setEntry, event.target.value)}
              />
            </Field>
            <Field label="Original stop">
              <input
                type="number"
                step="any"
                min="0.000001"
                required
                value={stop}
                onChange={(event) => change(setStop, event.target.value)}
              />
            </Field>
            <Field label="Risk budget ($)">
              <input
                type="number"
                step="any"
                min="0.01"
                required
                value={risk}
                onChange={(event) => change(setRisk, event.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" variant="primary" busy={busy}>
            Calculate size
          </Button>
        </form>
        {error && <Notice error>{error}</Notice>}
        {data && (
          <>
            <div className="stats compact">
              <Stat label="Contracts" value={number(data.contracts)} />
              <Stat label="Planned risk" value={money(data.total_risk)} />
              <Stat
                label="Risk per contract"
                value={money(data.risk_per_contract)}
              />
            </div>
            {data.capped_by_max_contracts && (
              <Notice>
                Your account's maximum contract limit caps this size.
              </Notice>
            )}
            <small className="muted">
              Uses your saved instrument fees and account limits. Check these
              against your broker before using the size.
            </small>
          </>
        )}
      </section>
      <section className="card tool-card">
        <h2>Strategy research</h2>
        <p className="muted">
          Explore setups beside the graph. More detail compares strategies,
          levels and confirmations within each testing sample.
        </p>
        <Button onClick={onResults}>
          Open Results <ArrowUpRight size={15} />
        </Button>
      </section>
    </>
  );
}
