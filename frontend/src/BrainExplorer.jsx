import React, { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, RotateCcw, Move, Eye } from "lucide-react";
import {
  BRAIN_REGIONS,
  BRAIN_MESH,
  DEFAULT_BRAIN_VIEW,
  clampBrainView,
  projectPoint,
  rotatePoint,
} from "./brainModel";
import "./brain-explorer.css";
import AnatomyExplorer from "./AnatomyExplorer";

function BrainScene({ selected, inside, onSelect }) {
  const canvas = useRef(null),
    pins = useRef({}),
    view = useRef({ ...DEFAULT_BRAIN_VIEW }),
    redraw = useRef(() => {}),
    drag = useRef(null);
  useEffect(() => {
    const el = canvas.current,
      ctx = el.getContext("2d");
    if (!ctx) return;
    let frame = 0,
      disposed = false;
    function draw() {
      frame = 0;
      if (disposed) return;
      const { width, height } = el.getBoundingClientRect(),
        ratio = Math.min(devicePixelRatio || 1, 1.75);
      if (!width || !height) return;
      if (
        el.width !== Math.round(width * ratio) ||
        el.height !== Math.round(height * ratio)
      ) {
        el.width = Math.round(width * ratio);
        el.height = Math.round(height * ratio);
      }
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const v = view.current,
        project = (p) => projectPoint(p, v, width, height);
      const faces = BRAIN_MESH.map((face) => ({
        ...face,
        z: rotatePoint(face.center, v)[2],
      })).sort((a, b) => a.z - b.z);
      ctx.globalAlpha = inside ? 0.16 : 1;
      for (const face of faces) {
        const p = face.vertices.map(project),
          normal = rotatePoint(face.normal, v),
          shade = Math.max(
            0.15,
            Math.min(
              1,
              0.45 + normal[1] * 0.23 + normal[2] * 0.38 - normal[0] * 0.13,
            ),
          );
        const highlight = selected === "pfc" && face.front;
        ctx.fillStyle = highlight
          ? `rgb(${Math.round(52 + shade * 53)},${Math.round(117 + shade * 80)},${Math.round(108 + shade * 70)})`
          : `rgb(${Math.round(58 + shade * 71)},${Math.round(82 + shade * 84)},${Math.round(85 + shade * 87)})`;
        ctx.beginPath();
        ctx.moveTo(p[0].x, p[0].y);
        ctx.lineTo(p[1].x, p[1].y);
        ctx.lineTo(p[2].x, p[2].y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (inside) {
        for (const side of [-1, 1]) {
          const points = Array.from({ length: 24 }, (_, i) => {
            const t = (i / 23) * Math.PI * 1.25;
            return project([
              0.05 - 0.55 * Math.sin(t),
              -0.27 - 0.15 * Math.sin(t * 0.8),
              side * 0.34,
            ]);
          });
          ctx.strokeStyle = selected === "hippocampus" ? "#b8a4ec" : "#746a95";
          ctx.lineWidth = selected === "hippocampus" ? 12 : 8;
          ctx.lineCap = "round";
          ctx.beginPath();
          points.forEach((p, i) =>
            i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
          );
          ctx.stroke();
          const p = project([0.4, -0.27, side * 0.34]);
          ctx.fillStyle = selected === "amygdala" ? "#efa77b" : "#ad816b";
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, 14, 10, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      for (const region of BRAIN_REGIONS) {
        const p = project(region.point),
          pin = pins.current[region.id];
        if (pin) {
          pin.style.left = `${(p.x / width) * 100}%`;
          pin.style.top = `${(p.y / height) * 100}%`;
          pin.hidden = region.id !== "pfc" && !inside;
        }
      }
    }
    const schedule = () => {
      if (!frame && !disposed) frame = requestAnimationFrame(draw);
    };
    redraw.current = schedule;
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    schedule();
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
      redraw.current = () => {};
    };
  }, [selected, inside]);
  const turn = (yaw, pitch = 0) => {
    view.current = clampBrainView({
      yaw: view.current.yaw + yaw,
      pitch: view.current.pitch + pitch,
    });
    redraw.current();
  };
  return (
    <div className="brain-stage">
      <div className="brain-stage-caption">
        <span>INTERACTIVE / 3D STUDY</span>
        <span>{inside ? "Internal structures" : "Cortical surface"}</span>
      </div>
      <div className="brain-model">
        <canvas
          ref={canvas}
          tabIndex={0}
          role="img"
          aria-label="Rotatable schematic brain. Drag to rotate, or use arrow keys. Select a labelled region to read about it."
          onKeyDown={(e) => {
            if (
              ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              turn(
                e.key === "ArrowLeft"
                  ? -0.15
                  : e.key === "ArrowRight"
                    ? 0.15
                    : 0,
                e.key === "ArrowUp" ? 0.1 : e.key === "ArrowDown" ? -0.1 : 0,
              );
            }
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            elCapture(e);
            drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d || d.id !== e.pointerId) return;
            turn((e.clientX - d.x) * 0.008, (e.clientY - d.y) * 0.006);
            drag.current = { ...d, x: e.clientX, y: e.clientY };
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
          onLostPointerCapture={() => {
            drag.current = null;
          }}
        />
        {BRAIN_REGIONS.map((r) => (
          <button
            key={r.id}
            ref={(el) => (pins.current[r.id] = el)}
            className={`brain-pin ${selected === r.id ? "is-active" : ""}`}
            style={{ "--region-color": r.color }}
            aria-label={`Locate ${r.name}`}
            aria-pressed={selected === r.id}
            onClick={() => onSelect(r.id)}
          >
            <span />
            <span>{r.short}</span>
          </button>
        ))}
      </div>
      <div className="brain-stage-tools">
        <span>
          <Move size={13} /> Drag to explore
        </span>
        <div>
          <button aria-label="Rotate brain left" onClick={() => turn(-0.3)}>
            <ArrowLeft size={17} />
          </button>
          <button aria-label="Rotate brain right" onClick={() => turn(0.3)}>
            <ArrowRight size={17} />
          </button>
          <button
            aria-label="Reset brain view"
            onClick={() => {
              view.current = { ...DEFAULT_BRAIN_VIEW };
              redraw.current();
            }}
          >
            <RotateCcw size={17} />
          </button>
        </div>
      </div>
      <p className="brain-model-note">
        Schematic model. Shapes and locations are approximate; internal
        structures are shown through the surface.
      </p>
    </div>
  );
}
function elCapture(e) {
  e.currentTarget.setPointerCapture(e.pointerId);
}
export default function BrainExplorer() {
  const [selected, setSelected] = useState("pfc"),
    [inside, setInside] = useState(false);
  const region = BRAIN_REGIONS.find((r) => r.id === selected);
  const select = (id) => {
    setSelected(id);
    setInside(id !== "pfc");
  };
  return (
    <section className="mind-story" aria-labelledby="mind-story-title">
      <header className="mind-story-heading">
        <h2 id="mind-story-title">Brain Explorer</h2>
        <p>Pick a region to see a familiar trading moment and one action to practise.</p>
      </header>
      <div className="brain-explorer">
        <AnatomyExplorer
          selected={selected}
          inside={inside}
          onSelect={select}
          fallback={
            <BrainScene selected={selected} inside={inside} onSelect={select} />
          }
        />
        <div className="brain-reading">
          <div className="brain-tabs" role="group" aria-label="Brain regions">
            {BRAIN_REGIONS.map((r) => (
              <button
                key={r.id}
                style={{ "--region-color": r.color }}
                aria-pressed={selected === r.id}
                onClick={() => select(r.id)}
              >
                {r.short}
              </button>
            ))}
          </div>
          <div
            className="brain-region-copy"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="pt-overline" style={{ color: region.color }}>
              {region.eyebrow}
            </span>
            <h3>{region.title}</h3>
            <strong>{region.name}</strong>
            <p>{region.body}</p>
            <div className="brain-prompt">
              <span>TRY THIS AT THE CHART</span>
              <p>{region.prompt}</p>
            </div>
          </div>
          <button
            className="brain-inside"
            aria-pressed={inside}
            onClick={() => setInside((v) => !v)}
          >
            <Eye size={16} />
            {inside ? "Show outer surface" : "Look inside"}
          </button>
        </div>
      </div>
    </section>
  );
}
