import type { Mechanism, PresetKind, Project, Spread } from './model';
import { uid } from './model';

export const PRESETS: { kind: PresetKind; name: string; description: string; tag: string }[] = [
  { kind: 'vfold', name: 'V-fold', description: 'Angled wings on a shared vertex', tag: 'FOUNDATION' },
  { kind: 'tent', name: 'Raised tent', description: 'A parallel fold with a floating ridge', tag: 'FOUNDATION' },
  { kind: 'bloom', name: 'Nested bloom', description: 'Three generations of unfolding petals', tag: 'COMPOUND' },
  { kind: 'pavilion', name: 'Tiered pavilion', description: 'A tent carrying a second folded roof', tag: 'COMPOUND' },
  { kind: 'scene', name: 'Layered scene', description: 'A landscape with dimensional depth', tag: 'COMPOUND' },
  { kind: 'slider', name: 'Pull-tab reveal', description: 'A guided strip with independent travel', tag: 'INTERACTIVE' },
];
export function mechanism(kind: Mechanism['kind'], changes: Partial<Mechanism> = {}): Mechanism {
  return { id: uid('m'), name: kind === 'vfold' ? 'V-fold' : kind === 'tent' ? 'Raised tent' : 'Pull-tab reveal',
    kind, host: kind === 'slider' ? 'page-right' : 'spine', offset: 0, width: 70, reach: 90,
    left: 28, right: 28, alpha: 35, beta: 65, branch: 1, color: '#a7c882', stroke: 40,
    outlines: {}, cutouts: {}, ...changes };
}
export function createPreset(kind: PresetKind, host = 'spine', offset = 0): Mechanism[] {
  if (kind === 'vfold' || kind === 'tent' || kind === 'slider') return [mechanism(kind, { host: kind === 'slider' && host === 'spine' ? 'page-right' : host, offset })];
  if (kind === 'bloom') {
    const base = mechanism('vfold', { host, offset, name: 'Calyx', width: 92, reach: 106, alpha: 32, beta: 68, color: '#72955f' });
    const middle = mechanism('vfold', { host: `${base.id}:ridge`, offset: 20, name: 'Outer petals', width: 56, reach: 69, alpha: 31, beta: 62, color: '#ebb3ad' });
    const inner = mechanism('vfold', { host: `${middle.id}:ridge`, offset: 10, name: 'Inner petals', width: 30, reach: 38, alpha: 30, beta: 58, color: '#e9cf94' });
    return [base, middle, inner];
  }
  if (kind === 'pavilion') {
    const base = mechanism('tent', { host, offset, name: 'Pavilion walls', left: 32, right: 32, reach: 88, width: 78, color: '#b9cad1' });
    const roof = mechanism('tent', { host: `${base.id}:ridge`, offset: 0, name: 'Upper roof', left: 12, right: 12, reach: 34, width: 54, color: '#cf8b72' });
    return [base, roof];
  }
  return [
    mechanism('vfold', { host, offset: offset - 54, name: 'Distant hills', width: 42, reach: 60, alpha: 35, beta: 60, color: '#8faeab' }),
    mechanism('vfold', { host, offset: offset + 1, name: 'Woodland', width: 40, reach: 66, alpha: 38, beta: 65, color: '#5f8b76' }),
    mechanism('vfold', { host, offset: offset + 53, name: 'Foreground', width: 28, reach: 43, alpha: 35, beta: 60, color: '#c3bd80' }),
  ];
}
export function blankSpread(name = 'Untitled spread'): Spread {
  return { id: uid('spread'), name, subtitle: 'A new paper experiment', color: '#a7c882', mechanisms: [], decorations: [], tabs: [], artwork: [], digital: [] };
}
export function exampleProject(): Project {
  const botanical = blankSpread('The paper garden');
  botanical.subtitle = 'Nested forms · Botanical study'; botanical.mechanisms = createPreset('bloom');
  const architecture = blankSpread('A small architecture');
  architecture.subtitle = 'Parallel folds · Pavilion study'; architecture.color = '#b9cad1'; architecture.mechanisms = createPreset('pavilion');
  const story = blankSpread('Beyond the treeline');
  story.subtitle = 'Layered scenery · Interactive reveal'; story.color = '#c3bd80'; story.mechanisms = [...createPreset('scene'), mechanism('slider', { name: 'Secret message', offset: -35, left: 70, width: 22, reach: 62, stroke: 25, color: '#dcac7d' })];
  return { version: 1, id: uid('book'), name: 'Studies in paper', pageWidth: 148, pageHeight: 210, spreads: [botanical, architecture, story], assets: {}, updatedAt: new Date().toISOString() };
}
