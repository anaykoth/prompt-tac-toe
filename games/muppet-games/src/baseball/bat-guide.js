import { batPose } from './model.js';

export function drawBatGuide(canvas, state, control) {
  const c = canvas.getContext('2d');
  if (!c) return;
  const w = 260, h = 120;
  c.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
  c.clearRect(0, 0, w, h);
  c.lineCap = 'round'; c.lineJoin = 'round';
  const project = p => ({ x: 76 + p.x * 42, y: 60 + p.z * 32 });
  const line = (a, b, color, width = 1) => {
    c.strokeStyle = color; c.lineWidth = width; c.beginPath();
    c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
  };
  c.strokeStyle = '#b4c1b535'; c.lineWidth = 1;
  c.strokeRect(60, 49, 32, 22);
  c.setLineDash([2, 4]); line({ x: 76, y: 0 }, { x: 76, y: 116 }, '#b4c1b530'); c.setLineDash([]);
  c.fillStyle = '#d9e6d2'; c.font = '7px sans-serif'; c.textAlign = 'center';
  c.fillText('PITCHER ↑', 76, 9);
  const pose = batPose(state), a = project(pose.handle), b = project(pose.tip);
  line(a, b, '#f4ca69', 5);
  c.fillStyle = '#dc9bd0'; c.beginPath(); c.arc(a.x, a.y, 4, 0, Math.PI * 2); c.fill();
  // The small arrow is the bat's forward-facing normal, not a promised hit.
  const center = { x: a.x * .2 + b.x * .8, y: a.y * .2 + b.y * .8 };
  const angle = state.bat.angle;
  const arrow = { x: center.x + Math.sin(angle) * 20, y: center.y - Math.cos(angle) * 20 };
  line(center, arrow, '#9ad8cd', 1.4);
  const heading = Math.atan2(arrow.y - center.y, arrow.x - center.x);
  for (const turn of [-.55, .55]) line(arrow, { x: arrow.x - 5 * Math.cos(heading + turn), y: arrow.y - 5 * Math.sin(heading + turn) }, '#9ad8cd', 1.4);
  line({ x: 144, y: 4 }, { x: 144, y: 115 }, '#b4c1b530');
  const points = control.points;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(94 / Math.max(200, maxX - minX), 80 / Math.max(200, maxY - minY));
  const xy = p => ({ x: 202 + (p.x - (minX + maxX) / 2) * scale, y: 59 + (p.y - (minY + maxY) / 2) * scale });
  for (let i = 1; i < points.length; i++) line(xy(points[i - 1]), xy(points[i]), i < points.length * .6 ? '#9ad8cd88' : '#f4ca69', 1.5);
  for (const [p, color] of [[points[0], '#d9e6d2'], [points.at(-1), '#f4ca69']]) {
    const q = xy(p); c.fillStyle = color; c.beginPath(); c.arc(q.x, q.y, 2.8, 0, Math.PI * 2); c.fill();
  }
  c.fillStyle = '#b4c1b5'; c.fillText('TRAIL FITS TO VIEW', 202, 116);
}
