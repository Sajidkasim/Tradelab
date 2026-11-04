import React, { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import modelUrl from "../../assets/hra-brain-female-v1.3.glb?url";
export function anatomicalRegion(name) {
  if (/frontal_pole/.test(name)) return "pfc";
  if (/amygdaloid_complex/.test(name)) return "amygdala";
  if (/(?:head|body|tail)_of_hippocampus/.test(name)) return "hippocampus";
  if (/(?:head|body|tail)_of_caudate/.test(name)) return "caudate";
  return null;
}
const colors = {
  pfc: "#74cfbd",
  amygdala: "#efa77b",
  hippocampus: "#b8a4ec",
  caudate: "#edce7f",
};
export default function AnatomyViewer({
  selected,
  inside,
  onSelect,
  fallback,
}) {
  const host = useRef(null),
    sceneRef = useRef(null),
    [status, setStatus] = useState("Loading anatomy…"),
    [error, setError] = useState(""),
    [opacity, setOpacity] = useState(15),
    [side, setSide] = useState("Both"),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let cancelled = false,
      frame = 0,
      model,
      renderer,
      controls;
    const node = host.current;
    const dispose = (root) =>
      root?.traverse((o) => {
        o.geometry?.dispose();
        if (o.material)
          (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) =>
            m.dispose(),
          );
      });
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(40, 1, 0.001, 100);
    const render = () => {
      frame = 0;
      if (!cancelled && renderer) renderer.render(scene, camera);
    };
    const request = () => {
      if (!frame && !cancelled) frame = requestAnimationFrame(render);
    };
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
      renderer.setClearColor("#162d33", 1);
      node.appendChild(renderer.domElement);
      renderer.domElement.setAttribute(
        "aria-label",
        "Anatomical brain viewer. Drag to rotate, scroll to zoom. Use the view buttons as an alternative.",
      );
      controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.enablePan = false;
      controls.minDistance = 0.05;
      controls.maxDistance = 4;
      controls.addEventListener("change", request);
      scene.add(new THREE.HemisphereLight("#e1f3f6", "#263941", 2));
      const light = new THREE.DirectionalLight("#fff0dc", 3);
      light.position.set(1, 2, 3);
      scene.add(light);
      const size = () => {
        const w = node.clientWidth,
          h = 400;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        request();
      };
      const observer = new ResizeObserver(size);
      observer.observe(node);
      sceneRef.current = { request, controls, camera, meshes: [], home: null };
      new GLTFLoader().load(
        modelUrl,
        (gltf) => {
          if (cancelled) {
            dispose(gltf.scene);
            return;
          }
          model = gltf.scene;
          const box = new THREE.Box3().setFromObject(model),
            center = box.getCenter(new THREE.Vector3()),
            dimensions = box.getSize(new THREE.Vector3()),
            extent = Math.max(dimensions.x, dimensions.y, dimensions.z);
          model.position.sub(center);
          model.traverse((o) => {
            if (!o.isMesh) return;
            const old = o.material;
            o.material = new THREE.MeshStandardMaterial({
              color: "#9bb0b6",
              roughness: 0.85,
              side: THREE.DoubleSide,
            });
            old?.dispose();
            o.userData.region = anatomicalRegion(o.name);
            sceneRef.current.meshes.push(o);
          });
          scene.add(model);
          camera.position.set(extent * 0.95, extent * 0.25, extent * 0.95);
          camera.lookAt(0, 0, 0);
          controls.target.set(0, 0, 0);
          controls.update();
          sceneRef.current.home = camera.position.clone();
          setStatus("Anatomy ready");
          sceneRef.current.apply?.();
          request();
        },
        undefined,
        () => {
          if (!cancelled)
            setError(
              "The anatomical model could not load. Retry or use the lightweight illustration.",
            );
        },
      );
      const point = new THREE.Vector2(),
        ray = new THREE.Raycaster();
      let down;
      const start = (e) => {
        down = [e.clientX, e.clientY];
      };
      const end = (e) => {
        if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5)
          return;
        const rect = renderer.domElement.getBoundingClientRect();
        point.set(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          (-(e.clientY - rect.top) / rect.height) * 2 + 1,
        );
        ray.setFromCamera(point, camera);
        const hit = ray.intersectObjects(
          sceneRef.current.meshes.filter((m) => m.visible && m.userData.region),
        )[0];
        if (hit) onSelect(hit.object.userData.region);
      };
      renderer.domElement.addEventListener("pointerdown", start);
      renderer.domElement.addEventListener("pointerup", end);
      size();
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
        observer.disconnect();
        controls.dispose();
        dispose(model);
        renderer.dispose();
        renderer.domElement.remove();
        sceneRef.current = null;
      };
    } catch {
      setError(
        "3D graphics are unavailable on this device. Use the lightweight illustration.",
      );
      renderer?.dispose();
      return () => {
        cancelled = true;
        cancelAnimationFrame(frame);
        controls?.dispose();
        renderer?.domElement.remove();
        sceneRef.current = null;
      };
    }
  }, [retry]);
  useEffect(() => {
    const current = sceneRef.current;
    if (!current) return;
    const apply = () => {
      for (const mesh of current.meshes) {
        const region = mesh.userData.region;
        mesh.visible =
          side === "Both" || !mesh.name.endsWith(side === "Left" ? "_R" : "_L");
        mesh.material.color.set(
          region === selected ? colors[region] : "#93a9b1",
        );
        mesh.material.transparent = inside && region !== selected;
        mesh.material.opacity =
          inside && region !== selected ? opacity / 100 : 1;
        mesh.material.depthWrite = !(inside && region !== selected);
      }
      current.request();
    };
    current.apply = apply;
    apply();
  }, [selected, inside, opacity, side, status, retry]);
  function zoom(factor) {
    const s = sceneRef.current;
    if (!s) return;
    s.camera.position.multiplyScalar(factor);
    s.controls.update();
    s.request();
  }
  function pose(name) {
    const s = sceneRef.current;
    if (!s?.home) return;
    const d = s.home.length();
    s.camera.position.copy(
      name === "Front"
        ? new THREE.Vector3(0, 0, d)
        : name === "Side"
          ? new THREE.Vector3(d, 0, 0)
          : s.home,
    );
    s.controls.update();
    s.request();
  }
  return (
    <div className="anatomy-view">
      <div className="anatomy-toolbar">
        <button onClick={() => pose("Front")}>Front</button>
        <button onClick={() => pose("Side")}>Side</button>
        <button onClick={() => pose("Reset")}>Reset view</button>
        <button aria-label="Zoom brain in" onClick={() => zoom(0.85)}>
          +
        </button>
        <button aria-label="Zoom brain out" onClick={() => zoom(1.15)}>
          −
        </button>
        <label>
          Hemisphere
          <select
            aria-label="Visible hemisphere"
            value={side}
            onChange={(e) => setSide(e.target.value)}
          >
            {["Both", "Left", "Right"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
      </div>
      <div ref={host} className="anatomy-canvas" />
      <p role="status">{status} · drag to rotate · scroll to zoom</p>
      {inside && (
        <label className="anatomy-opacity">
          Outer anatomy opacity
          <input
            type="range"
            min="0"
            max="60"
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </label>
      )}
      <p className="wp-footnote">
        PFC selection highlights the frontal pole as a landmark, not a complete
        PFC segmentation. Other highlights follow the model’s named structures.
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            className="button"
            onClick={() => {
              setError("");
              setRetry((v) => v + 1);
            }}
          >
            Retry model
          </button>
          {fallback}
        </div>
      )}
      <a
        href="https://3d.nih.gov/entries/3DPX-020959"
        target="_blank"
        rel="noopener noreferrer"
      >
        Human Reference Atlas / Allen & Visible Human · CC BY 4.0 ↗
      </a>
    </div>
  );
}
