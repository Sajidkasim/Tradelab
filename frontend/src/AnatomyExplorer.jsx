import React, { lazy, Suspense, useState } from "react";
const Viewer = lazy(() => import("./AnatomyViewer"));
export default function AnatomyExplorer(props) {
  const [load, setLoad] = useState(false);
  return load ? (
    <Suspense
      fallback={
        <div className="anatomy-loading" role="status">
          Opening 3D explorer…
        </div>
      }
    >
      <Viewer {...props} />
    </Suspense>
  ) : (
    <div className="anatomy-loading">
      <span className="pt-overline">HUMAN REFERENCE ATLAS / 3D</span>
      <h3>Explore beneath the surface.</h3>
      <p>
        Rotate real anatomical geometry, reveal internal structures and select a
        region. The model loads only when you choose.
      </p>
      <button className="button" onClick={() => setLoad(true)}>
        Load anatomical brain · 12 MB
      </button>
      <p>Runs on your device. A lightweight preview is available below.</p>
      <details>
        <summary>Open lightweight illustration</summary>
        {props.fallback}
      </details>
    </div>
  );
}
