import React, { lazy, Suspense } from "react";

const Viewer = lazy(() => import("./AnatomyViewer"));

export default function AnatomyExplorer(props) {
  return (
    <Suspense
      fallback={
        <div className="anatomy-loading" role="status">
          Opening 3D explorer…
        </div>
      }
    >
      <Viewer {...props} />
    </Suspense>
  );
}
