import React, { useEffect, useState } from "react";
import { api } from "./api";
import { Modal, Button, Field, Notice } from "./components";

export default function DeleteAllTrades({
  onClose,
  refresh,
  toast,
  onDeleted,
}) {
  const [snapshot, setSnapshot] = useState(null),
    [step, setStep] = useState(1),
    [typedCount, setTypedCount] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [reload, setReload] = useState(0),
    [stale, setStale] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setSnapshot(null);
    setError("");
    setStep(1);
    setTypedCount("");
    setStale(false);
    api("/trades/deletion-preview", {
      method: "POST",
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setSnapshot(data);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reload]);
  async function removeAll() {
    if (!snapshot?.count || typedCount !== String(snapshot.count) || stale)
      return;
    setBusy(true);
    setError("");
    let result;
    try {
      result = await api("/trades", {
        method: "DELETE",
        body: {
          confirmation_count: snapshot.count,
          preview_token: snapshot.preview_token,
        },
      });
    } catch (e) {
      setError(e.message);
      if (e.status === 409) setStale(true);
      setBusy(false);
      return;
    }
    onDeleted();
    try {
      await refresh();
      toast(
        `${result.deleted} trades deleted. Your results have been refreshed.`,
      );
    } catch {
      toast(
        `${result.deleted} trades deleted. Reload the page to update your lab.`,
      );
    } finally {
      setBusy(false);
      onClose();
    }
  }
  return (
    <Modal
      title={step === 1 ? "Delete all trades?" : "Confirm the trade count"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="stack">
        {loading && <p>Checking the total number of trades…</p>}
        {snapshot && snapshot.count === 0 && (
          <p>Your lab has no trades to delete.</p>
        )}
        {snapshot?.count > 0 && (
          <>
            <div className="delete-total">
              <strong>{snapshot.count}</strong>
              <span>trades in your whole lab</span>
            </div>
            {step === 1 ? (
              <>
                <p>
                  This deletes all {snapshot.count} backtesting and live trades,
                  including trades hidden by filters or on other pages. Their
                  notes and setup labels are deleted too.
                </p>
                <Notice error>
                  This cannot be undone. Your lab settings are
                  kept.
                </Notice>
                <a className="button" href="/api/export/backup">
                  Download a backup first
                </a>
                <div className="actions">
                  <Button onClick={onClose}>Keep my trades</Button>
                  <Button onClick={() => setStep(2)}>
                    Continue to confirmation
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p>
                  To permanently delete all trades, type the exact number shown
                  above.
                </p>
                <Field label={`Type ${snapshot.count} to confirm`}>
                  <input
                    autoFocus
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={12}
                    value={typedCount}
                    onChange={(e) => setTypedCount(e.target.value)}
                    disabled={busy}
                  />
                </Field>
                <div className="actions">
                  <Button disabled={busy} onClick={onClose}>
                    Keep my trades
                  </Button>
                  <Button
                    variant="danger"
                    busy={busy}
                    disabled={typedCount !== String(snapshot.count) || stale}
                    onClick={removeAll}
                  >
                    Delete all {snapshot.count} trades
                  </Button>
                </div>
              </>
            )}
          </>
        )}
        {error && <Notice error>{error}</Notice>}
        {(error || stale) && !busy && (
          <Button onClick={() => setReload((v) => v + 1)}>
            Get the latest trade count
          </Button>
        )}
      </div>
    </Modal>
  );
}
