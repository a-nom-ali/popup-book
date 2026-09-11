import type { Vec2 } from '../model';
export function area(p: Vec2[]) {
  return (
    p.reduce((sum, a, i) => {
      const b = p[(i + 1) % p.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0) / 2
  );
}
export function segmentDistance(p: Vec2, a: Vec2, b: Vec2) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    l = dx * dx + dy * dy;
  const t = l ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
export function inside(point: Vec2, polygon: Vec2[], boundary = true) {
  if (
    boundary &&
    polygon.some((a, i) => segmentDistance(point, a, polygon[(i + 1) % polygon.length]) < 0.01)
  )
    return true;
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      result = !result;
  }
  return result;
}
export const inMaterial = (point: Vec2, polygon: Vec2[], holes: Vec2[][] = []) =>
  inside(point, polygon) && !holes.some((h) => inside(point, h));
export function segmentInMaterial(a: Vec2, b: Vec2, polygon: Vec2[], holes: Vec2[][] = []) {
  const r: Vec2 = [b[0] - a[0], b[1] - a[1]],
    cross = (u: Vec2, v: Vec2) => u[0] * v[1] - u[1] * v[0],
    length2 = r[0] ** 2 + r[1] ** 2;
  const ts = [0, 1];
  if (length2 < 1e-12) return inMaterial(a, polygon, holes);
  for (const contour of [polygon, ...holes])
    for (let i = 0; i < contour.length; i++) {
      const c = contour[i],
        d = contour[(i + 1) % contour.length],
        s: Vec2 = [d[0] - c[0], d[1] - c[1]],
        ca: Vec2 = [c[0] - a[0], c[1] - a[1]],
        den = cross(r, s);
      if (Math.abs(den) > 1e-10) {
        const t = cross(ca, s) / den,
          u = cross(ca, r) / den;
        if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
      } else if (Math.abs(cross(ca, r)) < 1e-8)
        for (const p of [c, d]) {
          const t = ((p[0] - a[0]) * r[0] + (p[1] - a[1]) * r[1]) / length2;
          if (t > 0 && t < 1) ts.push(t);
        }
    }
  ts.sort((x, y) => x - y);
  return [...ts, ...ts.slice(1).map((t, i) => (t + ts[i]) / 2)].every((t) =>
    inMaterial([a[0] + r[0] * t, a[1] + r[1] * t], polygon, holes),
  );
}
const cross2 = (a: Vec2, b: Vec2, c: Vec2) =>
  (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
export function segmentsCross(a: Vec2, b: Vec2, c: Vec2, d: Vec2) {
  return cross2(a, b, c) * cross2(a, b, d) < -1e-8 && cross2(c, d, a) * cross2(c, d, b) < -1e-8;
}
export function selfIntersects(p: Vec2[]) {
  for (let i = 0; i < p.length; i++)
    for (let j = i + 2; j < p.length; j++) {
      if (i === 0 && j === p.length - 1) continue;
      if (segmentsCross(p[i], p[(i + 1) % p.length], p[j], p[(j + 1) % p.length])) return true;
    }
  return false;
}
export function makeTab(polygon: Vec2[], edge: number, depth: number): Vec2[] {
  const a = polygon[edge % polygon.length],
    b = polygon[(edge + 1) % polygon.length];
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 0.01) return [];
  const ux = (b[0] - a[0]) / length,
    uy = (b[1] - a[1]) / length,
    sign = area(polygon) > 0 ? 1 : -1;
  const nx = uy * sign * depth,
    ny = -ux * sign * depth,
    bevel = Math.min(depth * 1.5, length / 3);
  return [
    a,
    b,
    [b[0] + nx - ux * bevel, b[1] + ny - uy * bevel],
    [a[0] + nx + ux * bevel, a[1] + ny + uy * bevel],
  ];
}
export const svgPath = (p: Vec2[]) =>
  p.length ? `M${p.map((v) => `${v[0]},${v[1]}`).join('L')}Z` : '';
