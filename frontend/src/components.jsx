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
export function Heading({ eyebrow, title, children, action, level = 1 }) {
  const Title = level === 2 ? "h2" : "h1";
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <Title>{title}</Title>
        {children && <p>{children}</p>}
      </div>
      {action}
    </header>
  );
}

export function Menu({ label, children, className = "" }) {
  const ref = useRef();
  useEffect(() => {
    const closeOutside = (event) => {
      if (ref.current && !ref.current.contains(event.target))
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, []);
  return (
    <details
      ref={ref}
      className={`action-menu ${className}`}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary").focus();
        }
      }}
      onClick={(event) => {
        if (event.target.closest("button, a")) event.currentTarget.open = false;
      }}
    >
      <summary role="button">
        {label}
        <ChevronDown size={14} />
      </summary>
      <div className="menu-panel">{children}</div>
    </details>
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

export function Chart({ figure, height = 380 }) {
  const ref = useRef();
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true,
      plotly;
    setError("");
    import("plotly.js-basic-dist-min")
      .then((module) => {
        plotly = module.default;
        // A line has no visible segment with one observation. Show its existing
        // point and one readable date tick without changing any financial values.
        const singleDate =
          figure.data[0]?.x?.length === 1 ? figure.data[0].x[0] : null;
        const displayData = figure.data.map((trace) =>
          trace.type === "scatter" && trace.x?.length === 1
            ? {
                ...trace,
                mode: "markers",
                marker: {
                  ...trace.marker,
                  size: trace.marker?.size || 6,
                  color: trace.line?.color || trace.marker?.color,
                },
              }
            : trace,
        );
        const dateAxes = singleDate
          ? Object.fromEntries(
              Object.entries(figure.layout)
                .filter(([name]) => /^xaxis\d*$/.test(name))
                .map(([name, axis]) => [
                  name,
                  {
                    ...axis,
                    tickvals: [singleDate],
                    tickformat: "%d %b<br>%H:%M",
                    tickangle: 0,
                  },
                ]),
            )
          : {};
        if (alive && ref.current)
          plotly
            .react(
              ref.current,
              displayData,
              {
                ...figure.layout,
                ...dateAxes,
                autosize: false,
                width: Math.max(1, ref.current.clientWidth),
                height,
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
        plotly.relayout(ref.current, {
          width: Math.max(1, ref.current.clientWidth),
        });
    });
    if (ref.current) observer.observe(ref.current);
    return () => {
      alive = false;
      observer.disconnect();
      if (plotly && ref.current) plotly.purge(ref.current);
    };
  }, [figure, height]);
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
