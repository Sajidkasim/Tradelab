import React, { useState } from "react";
import { Download } from "lucide-react";
import { api } from "./api";
import { Modal, Button, Notice, Field } from "./components";

export default function Backup({ onClose, refresh, toast, count }) {
  const [file, setFile] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  async function restore() {
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.append("file", file);
      const result = await api("/restore", { method: "POST", body });
      await refresh();
      toast(`Backup restored: ${result.trades || 0} trades.`);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Back up your journal" onClose={onClose}>
      <div className="stack">
        <p>
          Keep dated downloads on your computer. You can use the full backup to
          move your journal or recover if the website is unavailable.
        </p>
        <a className="button primary" href="/api/export/backup">
          <Download size={16} /> Download full JSON backup
        </a>
        <a className="button" href="/api/export/csv">
          <Download size={16} /> Download trades as CSV
        </a>
        <small className="muted">
          JSON includes trades, labels, notes, accounts and settings. Team
          invitations and screenshot image files need separate backups.
        </small>
        <details className="disclosure">
          <summary>Restore an empty journal</summary>
          <div className="stack">
            <p>
              Restoring replaces the empty workspace’s default settings and
              account list with your backup. Existing journals cannot be
              replaced here.
            </p>
            {count > 0 ? (
              <Notice>
                Your journal already contains trades. Download a backup before
                arranging a migration.
              </Notice>
            ) : (
              <>
                <Field label="PrimusLab JSON backup">
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => {
                      setFile(e.target.files[0]);
                      setConfirmed(false);
                    }}
                  />
                </Field>
                <label className="review-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  Restore this backup into my empty workspace
                </label>
                <Button
                  variant="primary"
                  busy={busy}
                  disabled={!file || !confirmed}
                  onClick={restore}
                >
                  Restore backup
                </Button>
              </>
            )}
            {error && <Notice error>{error}</Notice>}
          </div>
        </details>
      </div>
    </Modal>
  );
}
