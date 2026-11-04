// Small, original procedural illustration; approximate regions, not an anatomy scan.
export const BRAIN_REGIONS = [
 {id:"caudate",short:"Caudate",name:"Caudate nucleus",color:"#edce7f",point:[.1,.05,.15],eyebrow:"Learning & action selection",title:"Notice the repeated response.",body:"The caudate is part of the striatum within the basal ganglia. These connected circuits contribute to learning and selecting actions, alongside cortical and other brain regions.",prompt:"What familiar cue led to the action, and what alternative could you plan?",view:"inside"},
  {
    id: "pfc",
    short: "PFC",
    name: "Prefrontal cortex",
    color: "#74cfbd",
    point: [1.05, 0.22, 0.43],
    eyebrow: "Planning & attention",
    title: "Make room for the plan.",
    body: "The prefrontal cortex contributes to planning, attention and decision-making. It works with other brain regions, including those involved in emotion and memory.",
    prompt:
      "Before the next decision: what does your written plan actually require?",
    view: "surface",
  },
  {
    id: "amygdala",
    short: "Amygdala",
    name: "Amygdala",
    color: "#efa77b",
    point: [0.4, -0.27, 0.34],
    eyebrow: "Emotional significance",
    title: "Notice what feels urgent.",
    body: "The amygdala participates in learning about emotionally significant events, including threats. It is part of connected circuits, rather than a single fear switch.",
    prompt:
      "A missed move can feel urgent. Name the feeling, then check whether the setup is still valid.",
    view: "inside",
  },
  {
    id: "hippocampus",
    short: "Hippocampus",
    name: "Hippocampus",
    color: "#b8a4ec",
    point: [-0.27, -0.32, 0.35],
    eyebrow: "Memory & context",
    title: "Put this moment in context.",
    body: "The hippocampus contributes to forming memories and representing context. A vivid recent result can be a useful reflection prompt, but does not establish what the next trade will do.",
    prompt:
      "Are you responding to this setup, or remembering the last outcome? Write down the difference.",
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
