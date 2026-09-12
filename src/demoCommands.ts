import type { Asset, Project, Spread, Vec2, Vec3 } from './model';
import { uid } from './model';
import { assertAssetCapacity } from './io/projects';

export interface DemoInsertion {
  spread: Spread;
  assets: Record<string, Asset>;
  scale: number;
  idMap: Record<string, string>;
}

/** Clone only structured IDs, never names, image bytes or arbitrary user text. */
export function prepareDemoInsertion(target: Project, demo: Project): DemoInsertion {
  if (target.spreads.length >= 100) throw new Error('This book already contains 100 spreads.');
  if (demo.spreads.length !== 1) throw new Error('A demo must contain exactly one spread.');
  const scale = Math.min(1, target.pageWidth / demo.pageWidth, target.pageHeight / demo.pageHeight);
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error('Demo and book page dimensions must be positive.');
  const spread = structuredClone(demo.spreads[0]),
    idMap: Record<string, string> = {};
  const claim = (id: string, prefix: string) => (idMap[id] ??= uid(prefix));
  claim(spread.id, 'spread');
  for (const m of spread.mechanisms) claim(m.id, 'm');
  for (const d of spread.decorations) {
    claim(d.id, 'cutout');
    if (d.cutout?.traceGroup) claim(d.cutout.traceGroup, 'trace');
  }
  for (const d of spread.digital) {
    claim(d.id, 'digital');
    for (const t of d.triggers ?? []) claim(t.id, 'trigger');
  }
  for (const a of spread.artwork) claim(a.id, 'art');
  for (const t of spread.tabs) claim(t.id, 'tab');
  for (const id of Object.keys(demo.assets)) claim(id, 'asset');
  const remap = (id: string): string => {
    if (idMap[id]) return idMap[id];
    const owner = Object.keys(idMap).find((key) => id.startsWith(`${key}:`));
    return owner ? idMap[owner] + id.slice(owner.length) : id;
  };
  const point = ([x, y]: Vec2): Vec2 => [x * scale, y * scale];
  const vector = ([x, y, z]: Vec3): Vec3 => [x * scale, y * scale, z * scale];
  spread.id = remap(spread.id);
  for (const m of spread.mechanisms) {
    m.id = remap(m.id);
    m.host = remap(m.host);
    for (const key of ['width', 'reach', 'left', 'right', 'offset', 'stroke'] as const)
      m[key] *= scale;
    for (const key of Object.keys(m.outlines)) m.outlines[key] = m.outlines[key].map(point);
    for (const key of Object.keys(m.cutouts))
      m.cutouts[key] = m.cutouts[key].map((hole) => hole.map(point));
  }
  for (const d of spread.decorations) {
    d.id = remap(d.id);
    d.parent = remap(d.parent);
    d.position = point(d.position);
    d.outline = d.outline.map(point);
    d.holes = d.holes.map((hole) => hole.map(point));
    d.glueRegion = d.glueRegion?.map((region) => ({
      outline: region.outline.map(point),
      holes: region.holes.map((h) => h.map(point)),
    }));
    if (d.cutout) {
      d.cutout.assetId = remap(d.cutout.assetId);
      if (d.cutout.traceGroup) d.cutout.traceGroup = remap(d.cutout.traceGroup);
      for (const key of ['width', 'height', 'imageX', 'imageY', 'tolerance'] as const)
        d.cutout[key] *= scale;
    }
  }
  for (const t of spread.tabs) {
    t.id = remap(t.id);
    t.partId = remap(t.partId);
    t.depth *= scale;
  }
  for (const a of spread.artwork) {
    a.id = remap(a.id);
    a.partId = remap(a.partId);
    a.assetId = remap(a.assetId);
    for (const key of ['x', 'y', 'width', 'height'] as const) a[key] *= scale;
  }
  for (const d of spread.digital) {
    d.id = remap(d.id);
    d.parent = remap(d.parent);
    d.assetId = remap(d.assetId);
    if (d.source?.kind === 'glb') d.source.assetId = remap(d.source.assetId);
    d.position = vector(d.position);
    d.scale *= scale;
    if (d.sliderId) d.sliderId = remap(d.sliderId);
    if (d.entrance) {
      d.entrance.distance *= scale;
      if (d.entrance.driver.target) d.entrance.driver.target = remap(d.entrance.driver.target);
    }
    if (d.motion) d.motion.hover *= scale;
    for (const t of d.triggers ?? []) {
      t.id = remap(t.id);
      t.target = remap(t.target);
    }
  }
  const assets: Record<string, Asset> = {},
    pending = { ...target, assets: { ...target.assets } };
  for (const asset of Object.values(demo.assets)) {
    const copy = { ...asset, id: remap(asset.id) };
    assertAssetCapacity(pending, copy.data);
    pending.assets[copy.id] = copy;
    assets[copy.id] = copy;
  }
  return { spread, assets, scale, idMap };
}

/** Intended for one store.edit callback: no changes happen until preparation succeeds. */
export function appendDemo(project: Project, demo: Project): DemoInsertion {
  const insertion = prepareDemoInsertion(project, demo);
  project.spreads.push(insertion.spread);
  Object.assign(project.assets, insertion.assets);
  return insertion;
}
