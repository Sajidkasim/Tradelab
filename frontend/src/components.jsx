import React, { useEffect, useRef, useState, useId } from "react";
import { X, ArrowRight, ChevronDown, Check } from "lucide-react";

export function Button({
  children,
  variant = "",
  className = "",
  busy,
  ...props
}) {
  return (
    <button
      className={`button ${variant} ${className}`}
      {...props}
      disabled={props.disabled || busy}
    >
      {busy && <span className="spinner small" />}
      {children}
    </button>
  );
}
export function Field({ label, hint, children, className = "" }) {
  const id = useId();
  const controls = React.Children.map(children, (child) =>
    React.isValidElement(child) &&
    ["input", "select", "textarea"].includes(child.type)
      ? React.cloneElement(child, {
          "aria-labelledby": `${id}-label`,
          "aria-describedby": hint ? `${id}-hint` : undefined,
        })
      : child,
  );
  return (
    <label className={`field ${className}`}>
      <span id={`${id}-label`}>{label}</span>
      {controls}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </label>
  );
}
export function Select({ label, values, empty, ...props }) {
  return (
    <Field label={label}>
      <select {...props}>
        {empty && <option value="">{empty}</option>}
        {values.map((v) => (
          <option
            key={typeof v === "object" ? v.value : v}
            value={typeof v === "object" ? v.value : v}
          >
            {typeof v === "object" ? v.label : v}
          </option>
        ))}
      </select>
    </Field>
  );
}
export function Segments({ values, value, onChange, label }) {
  return (
    <div className="segments" role="group" aria-label={label}>
      {values.map((v) => {
        const item = typeof v === "object" ? v : { value: v, label: v };
        return (
          <button
            key={item.value}
            className={value === item.value ? "selected" : ""}
            aria-pressed={value === item.value}
            onClick={() => onChange(item.value)}
            type="button"
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
export function Checkboxes({ values, selected, onChange }) {
  return (
    <div className="checks">
      {values.map((v) => (
        <label key={v} className={selected.includes(v) ? "checked" : ""}>
          <input
            type="checkbox"
            checked={selected.includes(v)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, v]
                  : selected.filter((x) => x !== v),
              )
            }
          />
          <span>{v}</span>
          {selected.includes(v) && <Check size={13} />}
        </label>
      ))}
    </div>
  );
}
export function Notice({ children, error = false }) {
  return (
    <div
      className={`notice ${error ? "error" : ""}`}
      role={error ? "alert" : "status"}
    >
      {children}
    </div>
  );
}
export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-mark">
        <ArrowRight size={24} />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Heading({ eyebrow, title, children, action }) {
  return (
    <header className="page-heading">
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      {action}
    </header>
  );
}
export function Stat({ label, value, caption, tone }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <strong className={tone || ""}>{value}</strong>
      <small>{caption}</small>
    </div>
  );
}
export function Disclosure({ title, children, open = false }) {
  return (
    <details open={open || undefined} className="disclosure">
      <summary>
        {title}
        <ChevronDown size={16} />
      </summary>
      <div>{children}</div>
    </details>
  );
}
export function Modal({ title, children, onClose }) {
  const ref = useRef();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-header">
        <h2>{title}</h2>
        <button aria-label="Close" className="icon-button" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

export function Chart({ figure }) {
  const ref = useRef();
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      plotly;
    setError("");
    import("plotly.js-basic-dist-min")
      .then((module) => {
        plotly = module.default;
        if (alive && ref.current)
          plotly
            .react(
              ref.current,
              figure.data,
              {
                ...figure.layout,
                autosize: true,
                height: 380,
                margin: { l: 55, r: 20, t: 28, b: 40 },
              },
              { responsive: true, displayModeBar: false },
            )
            .catch(() =>
              setError("Chart could not be displayed. Refresh to retry."),
            );
      })
      .catch(() => setError("Chart could not be loaded. Refresh to retry."));
    const observer = new ResizeObserver(() => {
      if (plotly && alive && ref.current?.data)
        plotly.Plots.resize(ref.current);
    });
    if (ref.current) observer.observe(ref.current);
    return () => {
      alive = false;
      observer.disconnect();
      if (plotly && ref.current) plotly.purge(ref.current);
    };
  }, [figure]);
  return (
    <>
      {error && <Notice error>{error}</Notice>}
      <div
        ref={ref}
        className="chart"
        role="img"
        aria-label="Equity and drawdown for the selected results sample"
      />
    </>
  );
}
