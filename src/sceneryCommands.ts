import { SCENERY, createIllustratedSpread, createSceneryAssembly } from './scenery';
import { useStudio } from './store';
import { assertAssetCapacity } from './io/projects';
import type { Asset, Project } from './model';

/** Check the cumulative addition before making the single undoable edit. */
function newSceneryAssets(project: Project, assets: Record<string, Asset>) {
  const pending = { ...project, assets: { ...project.assets } },
    added: Record<string, Asset> = {};
  for (const [id, asset] of Object.entries(assets)) {
    const existing = pending.assets[id];
    if (existing) {
      if (existing.data !== asset.data || existing.mime !== asset.mime)
        throw new Error(`The asset ID for ${asset.name} already belongs to another image.`);
      continue;
    }
    assertAssetCapacity(pending, asset.data);
    pending.assets[id] = asset;
    added[id] = asset;
  }
  return added;
}

export function insertScenery(itemId: string, parentId?: string) {
  const item = SCENERY.find((item) => item.id === itemId);
  if (!item) throw new Error('Choose an existing scenery item.');
  const s = useStudio.getState();
  if (parentId) {
    const ids = s.insertCutout(item.asset, item.trace, parentId, { name: item.name });
    s.set({ view: 'split', tool: 'select' });
    return ids;
  }
  const added = createSceneryAssembly(itemId, 0, s.project.pageHeight);
  const assets = newSceneryAssets(s.project, added.assets);
  s.edit(`${item.name} and support added`, (p) => {
    const spread = p.spreads.find((spread) => spread.id === s.activeSpreadId)!;
    spread.mechanisms.push(...added.mechanisms);
    spread.decorations.push(...added.decorations);
    spread.artwork.push(...added.artwork);
    Object.assign(p.assets, assets);
  });
  s.set({ selectedId: added.decorations[0].id, view: 'split', tool: 'select' });
  return added.decorations.map((d) => d.id);
}

export function insertIllustratedExample() {
  const s = useStudio.getState();
  const { spread, assets: bundledAssets } = createIllustratedSpread(s.project.pageHeight);
  if (s.project.spreads.length >= 100) throw new Error('This book already contains 100 spreads.');
  const assets = newSceneryAssets(s.project, bundledAssets);
  s.edit('Illustrated example added', (p) => {
    p.spreads.push(spread);
    Object.assign(p.assets, assets);
  });
  s.selectSpread(spread.id);
  s.set({
    angle: 145,
    view: '3d',
    notice: 'Illustrated example added · geometrically checked, physically untested',
  });
  return spread.id;
}
