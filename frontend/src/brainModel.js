// Small, original procedural illustration; approximate regions, not an anatomy scan.
export const BRAIN_REGIONS = [
  {
    id: "caudate", short: "Caudate", name: "Caudate nucleus", color: "#edce7f",
    point: [.1,.05,.15], eyebrow: "Habits", title: "Break the repeat click.",
    body: "This region helps you learn repeated actions. After a stop-out, reaching for another entry can become a habit.",
    prompt: "After a stop-out, write one line about the last trade before reopening the order panel.", view: "inside",
  },
  {
    id: "pfc",
    short: "PFC",
    name: "Prefrontal cortex",
    color: "#74cfbd",
    point: [1.05, 0.22, 0.43],
    eyebrow: "Planning & attention",
    title: "Check the setup before you click.",
    body: "This region helps with planning and attention. A fast candle can pull your attention away from the setup you planned.",
    prompt:
      "Before entering, name the level, the confirmation and where the setup is invalidated.",
    view: "surface",
  },
  {
    id: "amygdala",
    short: "Amygdala",
    name: "Amygdala",
    color: "#efa77b",
    point: [0.4, -0.27, 0.34],
    eyebrow: "Emotional significance",
    title: "Catch the urge to chase.",
    body: "This region helps flag events that feel important. A sudden move can feel urgent even after your planned entry has passed.",
    prompt:
      "If the planned entry is gone, mark the miss and wait for the next setup.",
    view: "inside",
  },
  {
    id: "hippocampus",
    short: "Hippocampus",
    name: "Hippocampus",
    color: "#b8a4ec",
    point: [-0.27, -0.32, 0.35],
    eyebrow: "Memory & context",
    title: "Review the setup in front of you.",
    body: "This region helps with memory and context. A vivid loss yesterday can colour how you read a similar setup today.",
    prompt:
      "Write down what the current candles show before comparing the setup with your last trade.",
    view: "inside",
  },
];
export const DEFAULT_BRAIN_VIEW = { yaw: -0.35, pitch: 0.16 };
export function rotatePoint([x, y, z], { yaw, pitch }) {
  const xx = x * Math.cos(yaw) + z * Math.sin(yaw),
    zz = -x * Math.sin(yaw) + z * Math.cos(yaw);
  return [
    xx,
    y * Math.cos(pitch) - zz * Math.sin(pitch),
    y * Math.sin(pitch) + zz * Math.cos(pitch),
  ];
}
export function projectPoint(point, view, width, height) {
  const [x, y, z] = rotatePoint(point, view),
    scale = Math.min(width / 3.7, height / 2.8),
    depth = 4.8 / (4.8 - z);
  return {
    x: width / 2 + x * scale * depth,
    y: height * 0.48 - y * scale * depth,
    z,
  };
}
export function clampBrainView(view) {
  return { yaw: view.yaw, pitch: Math.max(-0.65, Math.min(0.65, view.pitch)) };
}
function surface(u, v, side) {
  const x = Math.cos(u) * Math.sin(v),
    y = Math.cos(v),
    z = Math.sin(u) * Math.sin(v);
  const fold =
    1 +
    0.06 * Math.sin(u * 10 + v * 4) * Math.sin(v * 10) +
    0.018 * Math.sin(u * 23 - v * 8);
  return [
    x * 1.25 * fold,
    y * 0.83 * fold + 0.06,
    side * 0.32 + z * 0.43 * fold,
  ];
}
export function buildBrainMesh() {
  const faces = [],
    cols = 40,
    rows = 20;
  for (const side of [-1, 1])
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        const point = (a, b) =>
          surface((a / cols) * Math.PI * 2, (b / rows) * Math.PI, side);
        const a = point(i, j),
          b = point(i + 1, j),
          c = point(i + 1, j + 1),
          d = point(i, j + 1);
        for (const vertices of [
          [a, b, c],
          [a, c, d],
        ]) {
          const center = vertices[0].map(
            (_, n) => vertices.reduce((sum, p) => sum + p[n], 0) / 3,
          );
          const ab = vertices[1].map((n, k) => n - a[k]),
            ac = vertices[2].map((n, k) => n - a[k]);
          const cross = [
            ab[1] * ac[2] - ab[2] * ac[1],
            ab[2] * ac[0] - ab[0] * ac[2],
            ab[0] * ac[1] - ab[1] * ac[0],
          ];
          const length = Math.hypot(...cross) || 1;
          faces.push({
            vertices,
            center,
            normal: cross.map((n) => n / length),
            front: center[0] > 0.65,
          });
        }
      }
  return faces;
}
export const BRAIN_MESH = buildBrainMesh();
