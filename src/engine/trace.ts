import type { PaperRegion, Vec2 } from '../model';
import { area, inside, segmentDistance, selfIntersects } from './polygon';

export interface TraceOptions {
  /** Width of the original image rectangle, including transparent margins, in mm. */
  width?: number;
  threshold?: number;
  tolerance?: number;
}
export interface TraceResult {
  pieces: PaperRegion[];
  imageWidth: number;
  imageHeight: number;
  width: number;
  height: number;
  threshold: number;
  tolerance: number;
  warnings: string[];
}

function simplifyChain(points: Vec2[], tolerance: number): Vec2[] {
  if (points.length < 3) return points;
  let index = 0,
    distance = tolerance;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], points[0], points.at(-1)!);
    if (d > distance) {
      index = i;
      distance = d;
    }
  }
  return index
    ? [
        ...simplifyChain(points.slice(0, index + 1), tolerance).slice(0, -1),
        ...simplifyChain(points.slice(index), tolerance),
      ]
    : [points[0], points.at(-1)!];
}

export function simplifyContour(points: Vec2[], tolerance: number): Vec2[] {
  // Remove collinear pixel steps before RDP; split a closed loop into two open
  // chains so its identical start/end does not collapse the entire contour.
  const simple = points.filter((p, i) => {
    const a = points[(i + points.length - 1) % points.length],
      b = points[(i + 1) % points.length];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-12;
  });
  if (simple.length < 4 || tolerance <= 0) return simple;
  let split = 1;
  for (let i = 2; i < simple.length; i++)
    if (
      Math.hypot(simple[i][0] - simple[0][0], simple[i][1] - simple[0][1]) >
      Math.hypot(simple[split][0] - simple[0][0], simple[split][1] - simple[0][1])
    )
      split = i;
  const reduced = [
    ...simplifyChain(simple.slice(0, split + 1), tolerance).slice(0, -1),
    ...simplifyChain([...simple.slice(split), simple[0]], tolerance).slice(0, -1),
  ];
  return reduced.length >= 3 && !selfIntersects(reduced) && area(reduced) * area(simple) > 0
    ? reduced
    : simple;
}

/** Trace exact pixel-cell boundaries. Diagonal contacts remain separate pieces. */
export function traceAlpha(
  alpha: Uint8Array,
  imageWidth: number,
  imageHeight: number,
  options: TraceOptions = {},
): TraceResult {
  const width = options.width ?? 60,
    threshold = options.threshold ?? 0.5,
    tolerance = options.tolerance ?? 0.25;
  if (
    !Number.isInteger(imageWidth) ||
    !Number.isInteger(imageHeight) ||
    imageWidth < 1 ||
    imageHeight < 1 ||
    alpha.length !== imageWidth * imageHeight
  )
    throw new Error('The image alpha mask has invalid dimensions.');
  if (alpha.length > 16_777_216)
    throw new Error('Choose an image of 16 megapixels or less for tracing.');
  if (
    !Number.isFinite(width) ||
    width <= 0 ||
    !Number.isFinite(threshold) ||
    threshold < 0 ||
    threshold > 1 ||
    !Number.isFinite(tolerance) ||
    tolerance < 0
  )
    throw new Error('Trace size, opacity threshold, and detail must be valid positive values.');
  const scale = width / imageWidth,
    height = imageHeight * scale,
    stride = imageWidth + 1;
  const opaque = (x: number, y: number) =>
    x >= 0 &&
    y >= 0 &&
    x < imageWidth &&
    y < imageHeight &&
    alpha[y * imageWidth + x] > 0 &&
    alpha[y * imageWidth + x] >= threshold * 255;
  const edges: { a: number; b: number; dir: number }[] = [],
    starts = new Map<number, number[]>();
  const add = (x: number, y: number, xx: number, yy: number, dir: number) => {
    if (edges.length >= 1_000_000)
      throw new Error(
        'This mask is too intricate to trace. Use a smaller image or remove isolated noise.',
      );
    const a = y * stride + x,
      b = yy * stride + xx,
      index = edges.length;
    edges.push({ a, b, dir });
    const outgoing = starts.get(a);
    if (outgoing) outgoing.push(index);
    else starts.set(a, [index]);
  };
  for (let y = 0; y < imageHeight; y++)
    for (let x = 0; x < imageWidth; x++)
      if (opaque(x, y)) {
        if (!opaque(x, y - 1)) add(x, y, x + 1, y, 0);
        if (!opaque(x + 1, y)) add(x + 1, y, x + 1, y + 1, 1);
        if (!opaque(x, y + 1)) add(x + 1, y + 1, x, y + 1, 2);
        if (!opaque(x - 1, y)) add(x, y + 1, x, y, 3);
      }
  if (!edges.length)
    throw new Error(
      'No opaque paper remains at this opacity threshold. Lower the threshold or choose another image.',
    );
  const visited = new Uint8Array(edges.length),
    contours: Vec2[][] = [];
  for (let first = 0; first < edges.length; first++) {
    if (visited[first]) continue;
    const points: Vec2[] = [];
    let current = first;
    while (!visited[current]) {
      const edge = edges[current];
      visited[current] = 1;
      points.push([(edge.a % stride) * scale, Math.floor(edge.a / stride) * scale]);
      if (edge.b === edges[first].a) break;
      const next = (starts.get(edge.b) ?? []).filter((i) => !visited[i]);
      // At a diagonal pixel contact, turn right to follow this island rather
      // than manufacturing a zero-width bridge to an unrelated piece.
      const rank = [1, 0, 3, 2];
      next.sort(
        (a, b) =>
          rank.indexOf((edges[a].dir - edge.dir + 4) % 4) -
          rank.indexOf((edges[b].dir - edge.dir + 4) % 4),
      );
      if (!next.length) throw new Error('The image boundary could not be closed.');
      current = next[0];
    }
    contours.push(simplifyContour(points, tolerance));
  }
  const pieces = contours
    .filter((c) => area(c) > 0)
    .map((outline) => ({ outline, holes: [] as Vec2[][] }));
  for (const hole of contours.filter((c) => area(c) < 0)) {
    const owner = pieces
      .filter((p) => inside(hole[0], p.outline))
      .sort((a, b) => area(a.outline) - area(b.outline))[0];
    if (!owner)
      throw new Error('Detail simplification damaged a hole. Try a smaller detail tolerance.');
    owner.holes.push(hole);
  }
  pieces.sort((a, b) => Math.abs(area(b.outline)) - Math.abs(area(a.outline)));
  const warnings: string[] = [];
  if (pieces.length > 1)
    warnings.push(
      `${pieces.length} disconnected regions will become separate paper pieces, each needing glue.`,
    );
  if (
    pieces.some((p) => area(p.outline) - p.holes.reduce((sum, h) => sum + Math.abs(area(h)), 0) < 4)
  )
    warnings.push(
      'Some pieces have less than 4 mm² of paper. Enlarge the image or remove unwanted islands.',
    );
  return { pieces, imageWidth, imageHeight, width, height, threshold, tolerance, warnings };
}
