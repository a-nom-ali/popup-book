import * as clipping from 'polygon-clipping';
import type { Asset, Artwork, PaperDecoration, PaperRegion, Vec2 } from '../model';
import { uid } from '../model';
import type { TraceResult } from './trace';
import { area, inside, selfIntersects, segmentsCross } from './polygon';

export interface CutoutOptions {
  position?: Vec2;
  rotation?: number;
  name?: string;
}
export interface CutoutTransform {
  position?: Vec2;
  rotation?: number;
  scale?: number;
  parent?: string;
}
type Support = { polygon: Vec2[]; holes: Vec2[][] };

export function cutoutToParent(d: Pick<PaperDecoration, 'position' | 'rotation'>, p: Vec2): Vec2 {
  const a = ((d.rotation ?? 0) * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return [d.position[0] + c * p[0] - s * p[1], d.position[1] + s * p[0] + c * p[1]];
}
export function parentToCutout(d: Pick<PaperDecoration, 'position' | 'rotation'>, p: Vec2): Vec2 {
  const a = ((d.rotation ?? 0) * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a),
    x = p[0] - d.position[0],
    y = p[1] - d.position[1];
  return [c * x + s * y, -s * x + c * y];
}
export function mapRegions(regions: PaperRegion[], map: (p: Vec2) => Vec2): PaperRegion[] {
  return regions.map((r) => ({
    outline: r.outline.map(map),
    holes: r.holes.map((h) => h.map(map)),
  }));
}
const toPolygons = (regions: PaperRegion[]): clipping.MultiPolygon =>
  regions.map((r) => [r.outline, ...r.holes]);
const openRing = (r: Vec2[]): Vec2[] =>
  r.length > 1 && r[0][0] === r.at(-1)![0] && r[0][1] === r.at(-1)![1] ? r.slice(0, -1) : r;
const fromPolygons = (regions: clipping.MultiPolygon): PaperRegion[] =>
  regions.map(([outline, ...holes]) => ({
    outline: openRing(outline),
    holes: holes.map(openRing),
  }));
export const regionArea = (regions: PaperRegion[]) =>
  regions.reduce(
    (sum, r) =>
      sum + Math.abs(area(r.outline)) - r.holes.reduce((n, h) => n + Math.abs(area(h)), 0),
    0,
  );

function validRegion(region: PaperRegion) {
  const rings = [region.outline, ...region.holes];
  if (
    rings.some(
      (r) =>
        r.length < 3 ||
        r.some((p) => p.length !== 2 || !p.every(Number.isFinite)) ||
        Math.abs(area(r)) < 1e-8 ||
        selfIntersects(r),
    )
  )
    return false;
  for (const hole of region.holes) {
    if (!hole.every((p) => inside(p, region.outline, false))) return false;
    for (let i = 0; i < hole.length; i++)
      for (let j = 0; j < region.outline.length; j++)
        if (
          segmentsCross(
            hole[i],
            hole[(i + 1) % hole.length],
            region.outline[j],
            region.outline[(j + 1) % region.outline.length],
          )
        )
          return false;
  }
  for (let i = 0; i < region.holes.length; i++)
    for (let j = i + 1; j < region.holes.length; j++)
      if (
        regionArea(fromPolygons(clipping.intersection([region.holes[i]], [region.holes[j]]))) > 1e-8
      )
        return false;
  return true;
}

/** True only for nonempty valid regions entirely contained in actual material. */
export function regionContained(regions: PaperRegion[], material: PaperRegion): boolean {
  try {
    return (
      regions.length > 0 &&
      regions.every(validRegion) &&
      validRegion(material) &&
      regionArea(regions) > 1e-6 &&
      regionArea(fromPolygons(clipping.difference(toPolygons(regions), toPolygons([material])))) <=
        1e-6
    );
  } catch {
    return false;
  }
}
export function cutoutOverlap(d: PaperDecoration, parent: Support): PaperRegion[] {
  try {
    const support = { outline: parent.polygon, holes: parent.holes },
      piece = { outline: d.outline, holes: d.holes };
    if (!validRegion(piece) || !validRegion(support)) return [];
    return fromPolygons(
      clipping.intersection(
        toPolygons([piece]),
        toPolygons(mapRegions([support], (p) => parentToCutout(d, p))),
      ),
    );
  } catch {
    return [];
  }
}
export function suggestGlue(d: PaperDecoration, parent: Support): PaperRegion[] {
  return cutoutOverlap(d, parent);
}
export function glueRegionValid(d: PaperDecoration, parent: Support): boolean {
  const glue = d.glueRegion ?? [];
  return (
    regionContained(glue, { outline: d.outline, holes: d.holes }) &&
    regionContained(
      mapRegions(glue, (p) => cutoutToParent(d, p)),
      { outline: parent.polygon, holes: parent.holes },
    )
  );
}

export function scaleTrace(trace: TraceResult, width: number): TraceResult {
  if (!Number.isFinite(width) || width <= 0) throw new Error('Cut-out width must be positive.');
  const scale = width / trace.width;
  return {
    ...trace,
    width,
    height: trace.height * scale,
    tolerance: trace.tolerance * scale,
    pieces: mapRegions(trace.pieces, ([x, y]) => [x * scale, y * scale]),
  };
}
export function createCutoutParts(
  asset: Asset,
  trace: TraceResult,
  parentId: string,
  options: CutoutOptions = {},
): { decorations: PaperDecoration[]; artwork: Artwork[] } {
  if (asset.mime !== 'image/png' || !asset.data.startsWith('data:image/png'))
    throw new Error('Paper cut-outs require a PNG asset.');
  if (!trace.pieces.length || !trace.pieces.every(validRegion))
    throw new Error('The trace contains no valid paper pieces.');
  if (
    ![trace.width, trace.height, trace.imageWidth, trace.imageHeight].every(
      (x) => Number.isFinite(x) && x > 0,
    )
  )
    throw new Error('The traced image dimensions are invalid.');
  const name = options.name ?? asset.name.replace(/\.[^.]+$/, ''),
    traceGroup = uid('trace');
  const decorations = trace.pieces.map((piece, i): PaperDecoration => ({
    id: uid('cutout'),
    name: trace.pieces.length > 1 ? `${name} · piece ${i + 1}` : name,
    parent: parentId,
    outline: structuredClone(piece.outline),
    holes: structuredClone(piece.holes),
    position: [...(options.position ?? [0, 0])],
    rotation: options.rotation ?? 0,
    color: '#fffdf7',
    glueRegion: [],
    cutout: {
      assetId: asset.id,
      threshold: trace.threshold,
      tolerance: trace.tolerance,
      imageWidth: trace.imageWidth,
      imageHeight: trace.imageHeight,
      width: trace.width,
      height: trace.height,
      imageX: 0,
      imageY: 0,
      traceGroup,
    },
  }));
  return {
    decorations,
    artwork: decorations.map((d) => ({
      id: uid('art'),
      partId: d.id,
      assetId: asset.id,
      x: 0,
      y: 0,
      width: trace.width,
      height: trace.height,
    })),
  };
}

/** Bake proportional scale into millimetre geometry and image registration. */
export function resizeCutout(d: PaperDecoration, artwork: Artwork[], scale: number) {
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('Cut-out scale must be positive.');
  const point = ([x, y]: Vec2): Vec2 => [x * scale, y * scale];
  d.outline = d.outline.map(point);
  d.holes = d.holes.map((h) => h.map(point));
  if (d.glueRegion) d.glueRegion = mapRegions(d.glueRegion, point);
  if (d.cutout) {
    d.cutout.width *= scale;
    d.cutout.height *= scale;
    d.cutout.imageX *= scale;
    d.cutout.imageY *= scale;
    d.cutout.tolerance *= scale;
  }
  for (const art of artwork.filter((a) => a.partId === d.id)) {
    art.x *= scale;
    art.y *= scale;
    art.width *= scale;
    art.height *= scale;
  }
}
