import type {
  Asset,
  Artwork,
  Mechanism,
  PaperDecoration,
  PaperRegion,
  Spread,
  Vec2,
} from './model';
import { blankSpread, mechanism } from './presets';
import type { TraceResult } from './engine/trace';
import { createCutoutParts, mapRegions, scaleTrace } from './engine/cutouts';
import illustrations from './assets/scenery/library.json';

export interface SceneryItem {
  id: string;
  name: string;
  description: string;
  asset: Asset;
  trace: TraceResult;
  glueRegion: PaperRegion[];
  supportWidth: number;
  color: string;
  physicallyTested: false;
}

const points = (values: number[][]): Vec2[] => values.map(([x, y]) => [x, y]);

/** Original, locally bundled art. PNG alpha and these editable contours share one image frame. */
export const SCENERY: SceneryItem[] = illustrations.map((item) => ({
  id: item.id,
  name: item.name,
  description: item.description,
  asset: {
    id: `scenery-${item.id}-v1`,
    name: `${item.name}.png`,
    mime: 'image/png',
    data: item.data,
  },
  trace: {
    pieces: [{ outline: points(item.outline), holes: item.holes.map(points) }],
    width: item.width,
    height: item.height,
    imageWidth: item.imageWidth,
    imageHeight: item.imageHeight,
    threshold: 0.5,
    tolerance: 0.1,
    warnings: [],
  },
  glueRegion: item.glueRegion.map((region) => ({
    outline: points(region.outline),
    holes: region.holes.map(points),
  })),
  supportWidth: item.supportWidth,
  color: item.color,
  physicallyTested: false,
}));

export interface SceneryAssembly {
  mechanisms: Mechanism[];
  decorations: PaperDecoration[];
  artwork: Artwork[];
  assets: Record<string, Asset>;
}

export function sceneryById(id: string): SceneryItem {
  const item = SCENERY.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Unknown scenery item: ${id}`);
  return item;
}

function assembly(item: SceneryItem, offset: number, scale: number): SceneryAssembly {
  const trace = scaleTrace(item.trace, item.trace.width * scale);
  const support = mechanism('tent', {
    name: `${item.name} support`,
    host: 'spine',
    offset,
    width: item.supportWidth * scale,
    reach: 60 * scale,
    left: 18 * scale,
    right: 18 * scale,
    color: item.color,
  });
  const panelLength = support.reach - support.left;
  const pieces = createCutoutParts(item.asset, trace, `${support.id}:right`, {
    name: item.name,
    rotation: 90,
    // Image up maps toward the moving ridge; the base overlaps its support.
    position: [panelLength + trace.height - 16 * scale, -trace.width / 2],
  });
  pieces.decorations[0].glueRegion = mapRegions(item.glueRegion, ([x, y]) => [
    x * scale,
    y * scale,
  ]);
  return {
    mechanisms: [support],
    ...pieces,
    assets: { [item.asset.id]: { ...item.asset } },
  };
}

/** Additions only: callers decide which existing spread receives this editable assembly. */
export function createSceneryAssembly(
  itemId: string,
  offset = 0,
  pageHeight = 210,
): SceneryAssembly {
  if (!Number.isFinite(offset) || !Number.isFinite(pageHeight) || pageHeight <= 0)
    throw new Error('Scenery needs a finite position and positive page height.');
  return assembly(sceneryById(itemId), offset, Math.min(1, pageHeight / 210));
}

/** A new example spread; never replaces or mutates an existing book. */
export function createIllustratedSpread(pageHeight = 210): {
  spread: Spread;
  assets: Record<string, Asset>;
} {
  if (!Number.isFinite(pageHeight) || pageHeight <= 0)
    throw new Error('The page height must be positive.');
  const spread = blankSpread('Castle in the forest');
  spread.subtitle = 'Illustrated paper scenery · Physical prototype required';
  spread.color = '#809373';
  const assets: Record<string, Asset> = {};
  const heightScale = Math.min(1, pageHeight / 210);
  for (const [id, offset] of [
    ['pine', -69],
    ['castle', 0],
    ['oak', 69],
  ] as const) {
    const parts = assembly(sceneryById(id), offset * heightScale, 0.76 * heightScale);
    spread.mechanisms.push(...parts.mechanisms);
    spread.decorations.push(...parts.decorations);
    spread.artwork.push(...parts.artwork);
    Object.assign(assets, parts.assets);
  }
  return { spread, assets };
}
