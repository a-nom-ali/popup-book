import type { Mechanism, PresetKind, Project, Spread } from './model';
import { uid } from './model';
import revealArt from './reveal-art.json';

export const PRESETS: { kind: PresetKind; name: string; description: string; tag: string }[] = [
  {
    kind: 'vfold',
    name: 'V-fold',
    description: 'Angled wings on a shared vertex',
    tag: 'FOUNDATION',
  },
  {
    kind: 'tent',
    name: 'Raised tent',
    description: 'A parallel fold with a floating ridge',
    tag: 'FOUNDATION',
  },
  {
    kind: 'bloom',
    name: 'Nested bloom',
    description: 'Three generations of unfolding petals',
    tag: 'COMPOUND',
  },
  {
    kind: 'pavilion',
    name: 'Tiered pavilion',
    description: 'A tent carrying a second folded roof',
    tag: 'COMPOUND',
  },
  {
    kind: 'scene',
    name: 'Layered scene',
    description: 'A landscape with dimensional depth',
    tag: 'COMPOUND',
  },
  {
    kind: 'slider',
    name: 'Pull-tab reveal',
    description: 'A guided strip with independent travel',
    tag: 'INTERACTIVE',
  },
];
export function mechanism(kind: Mechanism['kind'], changes: Partial<Mechanism> = {}): Mechanism {
  return {
    id: uid('m'),
    name: kind === 'vfold' ? 'V-fold' : kind === 'tent' ? 'Raised tent' : 'Pull-tab reveal',
    kind,
    host: kind === 'slider' ? 'page-right' : 'spine',
    offset: 0,
    width: 70,
    reach: 90,
    left: 28,
    right: 28,
    alpha: 35,
    beta: 65,
    branch: 1,
    color: '#a7c882',
    stroke: 40,
    outlines: {},
    cutouts: {},
    ...changes,
  };
}
export function createPreset(kind: PresetKind, host = 'spine', offset = 0): Mechanism[] {
  if (kind === 'vfold' || kind === 'tent' || kind === 'slider')
    return [
      mechanism(kind, {
        ...(kind === 'slider' ? { reach: 75, stroke: 30 } : {}),
        host: kind === 'slider' && host === 'spine' ? 'page-right' : host,
        offset,
      }),
    ];
  if (kind === 'bloom') {
    const base = mechanism('vfold', {
      host,
      offset,
      name: 'Calyx',
      width: 92,
      reach: 106,
      alpha: 32,
      beta: 68,
      color: '#72955f',
    });
    const middle = mechanism('vfold', {
      host: `${base.id}:ridge`,
      offset: 20,
      name: 'Outer petals',
      width: 45,
      reach: 57,
      alpha: 31,
      beta: 62,
      branch: -1,
      color: '#ebb3ad',
    });
    const inner = mechanism('vfold', {
      host: `${middle.id}:ridge`,
      offset: 9,
      name: 'Inner petals',
      width: 24,
      reach: 32,
      alpha: 30,
      beta: 58,
      branch: -1,
      color: '#e9cf94',
    });
    for (const m of [base, middle, inner]) {
      const b = (m.beta * Math.PI) / 180,
        end = [m.reach * Math.cos(b), m.reach * Math.sin(b)],
        B = [m.width, 0],
        dx = end[0] - B[0],
        dy = end[1],
        length = Math.hypot(dx, dy);
      const outline: [number, number][] = [
        [0, 0],
        [m.width, 0],
      ];
      for (let i = 1; i < 10; i++) {
        const t = i / 10,
          bulge = Math.sin(t * Math.PI) * m.width * 0.19;
        outline.push([B[0] + dx * t + (dy / length) * bulge, dy * t - (dx / length) * bulge]);
      }
      outline.push(end as [number, number]);
      m.outlines = { left: outline, right: structuredClone(outline) };
    }
    return [base, middle, inner];
  }
  if (kind === 'pavilion') {
    const base = mechanism('tent', {
      host,
      offset,
      name: 'Pavilion walls',
      left: 32,
      right: 32,
      reach: 88,
      width: 78,
      color: '#b9cad1',
    });
    const roof = mechanism('tent', {
      host: `${base.id}:ridge`,
      offset: 0,
      name: 'Upper roof',
      left: 12,
      right: 12,
      reach: 34,
      width: 54,
      branch: -1,
      color: '#cf8b72',
    });
    const windows: [number, number][][] = [-23, 10].map((y) => [
      [12, y],
      [27, y],
      [31, y + 6],
      [27, y + 12],
      [12, y + 12],
    ]);
    base.cutouts = { left: windows, right: structuredClone(windows) };
    return [base, roof];
  }
  return [
    mechanism('vfold', {
      host,
      offset: offset - 54,
      name: 'Distant hills',
      width: 42,
      reach: 60,
      alpha: 35,
      beta: 60,
      color: '#8faeab',
    }),
    mechanism('vfold', {
      host,
      offset: offset + 1,
      name: 'Woodland',
      width: 40,
      reach: 66,
      alpha: 38,
      beta: 65,
      color: '#5f8b76',
    }),
    mechanism('vfold', {
      host,
      offset: offset + 53,
      name: 'Foreground',
      width: 28,
      reach: 43,
      alpha: 35,
      beta: 60,
      color: '#c3bd80',
    }),
  ];
}
export function blankSpread(name = 'Untitled spread'): Spread {
  return {
    id: uid('spread'),
    name,
    subtitle: 'A new paper experiment',
    color: '#a7c882',
    mechanisms: [],
    decorations: [],
    tabs: [],
    artwork: [],
    digital: [],
  };
}
export function exampleProject(): Project {
  const botanical = blankSpread('The paper garden');
  botanical.subtitle = 'Nested forms · Botanical study';
  botanical.mechanisms = createPreset('bloom');
  const architecture = blankSpread('A small architecture');
  architecture.subtitle = 'Parallel folds · Pavilion study';
  architecture.color = '#b9cad1';
  architecture.mechanisms = createPreset('pavilion');
  const story = blankSpread('Beyond the treeline');
  story.subtitle = 'Layered scenery · Interactive reveal';
  story.color = '#c3bd80';
  story.mechanisms = [
    ...createPreset('scene'),
    mechanism('slider', {
      name: 'Secret message',
      offset: -35,
      left: 75,
      width: 22,
      reach: 45,
      stroke: 18,
      color: '#dcac7d',
    }),
  ];
  story.artwork.push({
    id: uid('art'),
    assetId: 'reveal-message',
    partId: `${story.mechanisms.at(-1)!.id}:strip`,
    x: 0,
    y: 0,
    width: 45,
    height: 22,
  });
  return {
    version: 3,
    id: uid('book'),
    name: 'Studies in paper',
    pageWidth: 148,
    pageHeight: 210,
    spreads: [botanical, architecture, story],
    assets: {
      'reveal-message': {
        id: 'reveal-message',
        name: 'Reveal message.png',
        mime: 'image/png',
        data: revealArt.data,
      },
    },
    updatedAt: new Date().toISOString(),
  };
}
