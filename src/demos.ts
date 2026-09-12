import type { DigitalObject, Project, Spread } from './model';
import { uid } from './model';
import { blankSpread, createPreset, mechanism } from './presets';
import { createIllustratedSpread } from './scenery';

export type DemoId = 'enchanted-castle' | 'butterfly-garden' | 'crystal-portal';
export type DemoControl = 'opening' | 'slider' | 'trigger' | 'settings';
export interface DemoStep {
  title: string;
  try: string;
  built: string;
  control: DemoControl;
  targetId: string;
  settings: { label: string; value: string }[];
  angle?: number;
  driver?: { id: string; value: number };
  triggerTarget?: string;
}
export interface DemoExperience {
  project: Project;
  angle: number;
  drivers: Record<string, number>;
  steps: DemoStep[];
  triggers: { targetId: string; label: string }[];
}
export interface DemoDefinition {
  id: DemoId;
  title: string;
  category: string;
  description: string;
  accent: string;
  build: () => DemoExperience;
}

type Builtin = 'dragon' | 'butterfly' | 'crystal' | 'fireflies' | 'sparkles' | 'portal';
function prop(model: Builtin, parent: string, changes: Partial<DigitalObject> = {}): DigitalObject {
  return {
    id: uid('digital'),
    name: model,
    assetId: '',
    parent,
    source: { kind: 'builtin', id: model },
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 1,
    behavior: 'loop',
    clip: 0,
    angleStart: 0,
    angleEnd: 180,
    motion: { hover: 0, spin: 0 },
    triggers: [],
    ...changes,
  };
}
const entrance = (
  kind: 'rise' | 'grow' | 'reveal',
  driver: NonNullable<DigitalObject['entrance']>['driver'],
  start = 35,
  end = 145,
  distance = 35,
): NonNullable<DigitalObject['entrance']> => ({
  kind,
  driver,
  start,
  end,
  distance,
  easing: 'smooth',
  duration: 1.25,
});
function project(spread: Spread, assets: Project['assets'] = {}): Project {
  return {
    version: 3,
    id: uid('demo'),
    name: spread.name,
    pageWidth: 148,
    pageHeight: 210,
    spreads: [spread],
    assets,
    updatedAt: '2026-09-12T00:00:00.000Z',
  };
}

function castleDemo(): DemoExperience {
  const { spread, assets } = createIllustratedSpread();
  spread.name = 'The enchanted castle';
  spread.subtitle = 'Illustrated paper + a digital dragon · Physical prototype required';
  const castle = spread.decorations.find((d) => d.name.includes('castle'))!;
  const tree = spread.decorations.find((d) => d.name.includes('oak'))!;
  const dragon = prop('dragon', 'page-left', {
    name: 'Castle dragon',
    position: [18, -4, 61],
    scale: 0.92,
    rotation: [0, 25, 0],
    behavior: 'click',
    entrance: entrance('rise', { kind: 'opening' }, 65, 150, 55),
    motion: { hover: 1.5, spin: 0 },
  });
  dragon.triggers = [
    { id: uid('trigger'), target: castle.id, action: 'clip' },
    { id: uid('trigger'), target: dragon.id, action: 'clip' },
  ];
  const fireflies = prop('fireflies', tree.id, {
    name: 'Orchard fireflies',
    position: [22.8, 28, 9],
    scale: 0.8,
    source: { kind: 'builtin', id: 'fireflies', seed: 17, count: 26 },
    triggers: [{ id: uid('trigger'), target: tree.id, action: 'toggle' }],
  });
  spread.digital.push(dragon, fireflies);
  return {
    project: project(spread, assets),
    angle: 150,
    drivers: {},
    triggers: [
      { targetId: castle.id, label: 'Wake the dragon' },
      { targetId: tree.id, label: 'Toggle fireflies' },
    ],
    steps: [
      {
        title: 'Explore the paper stage',
        try: 'Orbit the open scene to see the illustrated castle and trees attached to their folding paper supports.',
        built:
          'Three printable cut-outs ride on separate tent supports. Each silhouette has one rigid paper parent and a printable glue region.',
        control: 'settings',
        targetId: castle.id,
        angle: 150,
        settings: [
          { label: 'Paper structure', value: '3 tents + illustrated cut-outs' },
          { label: 'Castle attachment', value: 'Right support panel · Glue region' },
        ],
      },
      {
        title: 'Raise the dragon',
        try: 'Close the book with Opening, then slowly reopen past 65°. The dragon rises above the castle.',
        built:
          'The dragon is attached to the left page. A smooth rise reads the book opening from 65° to 150°, independently of its wing animation.',
        control: 'opening',
        targetId: dragon.id,
        angle: 150,
        settings: [
          { label: 'Entrance', value: 'Rise · Opening 65–150°' },
          { label: 'Travel', value: '55 mm · Smooth' },
        ],
      },
      {
        title: 'Wake wings & fireflies',
        try: 'At an open pose, click the castle to flap the dragon’s wings, then click the oak tree to toggle fireflies on or off. Both buttons below also work.',
        built:
          'The castle click plays the dragon’s wing clip. A separate tree click toggles a seeded firefly effect on its moving tree attachment.',
        control: 'trigger',
        targetId: castle.id,
        angle: 150,
        settings: [
          { label: 'Castle click', value: 'Dragon → Play wing clip' },
          { label: 'Oak click', value: '26 fireflies → Toggle visibility' },
        ],
      },
      {
        title: 'Make it your story',
        try: 'Orbit the scene, then add an editable copy to change the art, supports, dragon and interactions.',
        built:
          'Paper geometry and printable artwork are separate from the digital layer. Adding this demo copies both into a new spread, ready for the normal editor.',
        control: 'settings',
        targetId: dragon.id,
        angle: 150,
        settings: [
          { label: 'Attachment', value: 'Left page · 61 mm above paper' },
          { label: 'Idle motion', value: 'Hover 1.5 mm' },
        ],
      },
    ],
  };
}

function butterflyDemo(): DemoExperience {
  const spread = blankSpread('The butterfly garden');
  spread.subtitle = 'Nested petals + a digital butterfly · Physical prototype required';
  spread.color = '#dcb2a1';
  spread.mechanisms = createPreset('bloom');
  const petal = spread.mechanisms[2],
    hinge = `${spread.mechanisms[1].id}:ridge`;
  const butterfly = prop('butterfly', `${petal.id}:right`, {
    name: 'Petal butterfly',
    position: [11, 8, -3],
    scale: 0.9,
    rotation: [180, 0, -25],
    behavior: 'click',
    entrance: entrance('grow', { kind: 'hinge', target: hinge }, 5, 35, 0),
    motion: { hover: 1, spin: 0 },
  });
  butterfly.triggers = [{ id: uid('trigger'), target: butterfly.id, action: 'clip' }];
  const sparkles = prop('sparkles', `${petal.id}:right`, {
    name: 'Butterfly pollen',
    position: [11, 8, -9],
    scale: 0.8,
    rotation: [180, 0, 0],
    source: { kind: 'builtin', id: 'sparkles', seed: 31, count: 22 },
    entrance: entrance('grow', { kind: 'click' }, 0, 1, 0),
    triggers: [{ id: uid('trigger'), target: butterfly.id, action: 'entrance' }],
  });
  const companion = prop('butterfly', `${spread.mechanisms[1].id}:right`, {
    name: 'Outer-petal butterfly',
    position: [35, 7, -30],
    scale: 0.62,
    rotation: [180, 0, 35],
    behavior: 'click',
    entrance: entrance(
      'grow',
      { kind: 'hinge', target: `${spread.mechanisms[0].id}:ridge` },
      10,
      62,
      0,
    ),
    motion: { hover: 0.7, spin: 0 },
  });
  companion.triggers = [{ id: uid('trigger'), target: companion.id, action: 'clip' }];
  const companionPollen = prop('sparkles', companion.parent, {
    name: 'Outer-petal pollen',
    position: [35, 7, -36],
    scale: 0.57,
    rotation: [180, 0, 0],
    source: { kind: 'builtin', id: 'sparkles', seed: 39, count: 16 },
    entrance: entrance('grow', { kind: 'click' }, 0, 1, 0),
    triggers: [{ id: uid('trigger'), target: companion.id, action: 'entrance' }],
  });
  spread.digital.push(butterfly, sparkles, companion, companionPollen);
  return {
    project: project(spread),
    angle: 150,
    drivers: {},
    triggers: [
      { targetId: butterfly.id, label: 'Inner butterfly' },
      { targetId: companion.id, label: 'Outer butterfly' },
    ],
    steps: [
      {
        title: 'Unfold the garden',
        try: 'Inspect the open flower, then close and reopen the book to follow three generations of petals unfolding from one another.',
        built:
          'The calyx carries outer petals on its ridge. Those petals carry a third V-fold, so each child follows an actual moving paper hinge.',
        control: 'opening',
        targetId: `${spread.mechanisms[1].id}:right`,
        angle: 45,
        settings: [
          { label: 'Paper structure', value: '3 nested V-folds' },
          { label: 'Attachment', value: 'Ridge → ridge → inner petals' },
        ],
      },
      {
        title: 'Follow the petal hinges',
        try: 'Scrub Opening and watch two butterflies grow at different rates as their local petal hinges change angle.',
        built:
          'Each butterfly reads its own solved parent hinge in degrees: the inner butterfly follows the outer-petal ridge, and its companion follows the calyx ridge.',
        control: 'opening',
        targetId: butterfly.id,
        angle: 90,
        settings: [
          { label: 'Entrance', value: 'Grow · Outer-petal ridge' },
          { label: 'Hinge range', value: '5–35° · Smooth' },
        ],
      },
      {
        title: 'Flutter & sparkle',
        try: 'Click either visible butterfly. Its wing clip plays while pollen sparkles appear around its petal.',
        built:
          'Each butterfly click is shared by two objects: the butterfly plays a clip, and its own pollen effect starts a grow entrance.',
        control: 'trigger',
        targetId: butterfly.id,
        angle: 165,
        settings: [
          { label: 'Action 1', value: 'Butterfly → Play clip' },
          { label: 'Action 2', value: 'Pollen → Start entrance' },
        ],
      },
      {
        title: 'Inspect the attachment',
        try: 'Orbit the open flower. Add a copy to change which paper panel carries the butterfly.',
        built:
          'The butterfly has a rigid attachment on the reverse side of the inner right petal. Its entrance and hover are evaluated relative to that moving attachment frame.',
        control: 'settings',
        targetId: butterfly.id,
        angle: 165,
        settings: [
          { label: 'Parent', value: 'Inner petals · right, reverse side' },
          { label: 'Idle motion', value: 'Hover 1 mm' },
        ],
      },
    ],
  };
}

function portalDemo(): DemoExperience {
  const spread = blankSpread('The crystal portal');
  spread.subtitle = 'Guided paper slider + a digital reveal · Physical prototype required';
  spread.color = '#aebed1';
  const slider = mechanism('slider', {
    name: 'Portal pull-tab',
    host: 'page-right',
    left: 52,
    offset: -18,
    width: 34,
    reach: 60,
    stroke: 24,
    color: '#b7c9cc',
  });
  spread.mechanisms.push(slider);
  const portal = prop('portal', `${slider.id}:cover`, {
    name: 'Portal arch',
    position: [30, 27, 1],
    scale: 1.05,
    entrance: entrance('grow', { kind: 'slider', target: slider.id }, 0.05, 0.75, 0),
  });
  const crystal = prop('crystal', `${slider.id}:strip`, {
    name: 'Traveller’s crystal',
    position: [25, 17, 3],
    scale: 0.63,
    entrance: entrance('rise', { kind: 'slider', target: slider.id }, 0.25, 1, 24),
    motion: { hover: 1.5, spin: 16 },
  });
  const sparkles = prop('sparkles', `${slider.id}:strip`, {
    name: 'Crystal sparks',
    position: [25, 17, 13],
    scale: 0.8,
    source: { kind: 'builtin', id: 'sparkles', seed: 53, count: 28 },
    entrance: entrance('grow', { kind: 'slider', target: slider.id }, 0.25, 1, 0),
    triggers: [{ id: uid('trigger'), target: crystal.id, action: 'toggle' }],
  });
  spread.digital.push(portal, crystal, sparkles);
  return {
    project: project(spread),
    angle: 150,
    drivers: { [slider.id]: 0.65 },
    triggers: [{ targetId: crystal.id, label: 'Toggle crystal sparks' }],
    steps: [
      {
        title: 'Pull the paper tab',
        try: 'Move Portal pull-tab from 0% to 100%. The strip slides beneath its folded guide.',
        built:
          'This is an independent paper slider. Its normalized travel drives the digital entrance without needing to change the book opening.',
        control: 'slider',
        targetId: `${slider.id}:strip`,
        angle: 160,
        driver: { id: slider.id, value: 0 },
        settings: [
          { label: 'Paper travel', value: '24 mm' },
          { label: 'Digital input', value: 'Slider · 0–100%' },
        ],
      },
      {
        title: 'Reveal the portal',
        try: 'Scrub the pull-tab through the middle of its travel. The arch grows and the crystal rises.',
        built:
          'The arch is attached to the stationary cover. The crystal is attached to the moving strip and has a separate slider-driven rise.',
        control: 'slider',
        targetId: crystal.id,
        driver: { id: slider.id, value: 0.5 },
        settings: [
          { label: 'Portal entrance', value: 'Grow · 5–75% travel' },
          { label: 'Crystal entrance', value: 'Rise 24 mm · 25–100%' },
        ],
      },
      {
        title: 'Spark the crystal',
        try: 'Click the revealed crystal or the button below to toggle orbiting sparkles on and off. Retract the slider to hide them with the crystal.',
        built:
          'The sparkles share the crystal’s strip attachment. A click toggles their visibility, while slider travel still gates their entrance.',
        control: 'trigger',
        targetId: crystal.id,
        triggerTarget: crystal.id,
        driver: { id: slider.id, value: 1 },
        settings: [
          { label: 'Trigger', value: 'Crystal click → Toggle sparks' },
          { label: 'Effect', value: '28 orbiting sparkles · Slider gated' },
        ],
      },
      {
        title: 'Separate the layers',
        try: 'Change Opening while keeping the slider extended, then add a copy to explore the editable setup.',
        built:
          'Opening moves the supporting page. Slider travel moves the strip. The digital crystal adds hover and spin on top of those paper movements.',
        control: 'settings',
        targetId: crystal.id,
        angle: 130,
        driver: { id: slider.id, value: 1 },
        settings: [
          { label: 'Parent', value: 'Portal pull-tab · strip' },
          { label: 'Idle motion', value: 'Hover 1.5 mm · Spin 16°/s' },
        ],
      },
    ],
  };
}

export const DEMOS: DemoDefinition[] = [
  {
    id: 'enchanted-castle',
    title: 'The enchanted castle',
    category: 'PAPER + STORY',
    description: 'Raise a dragon, wake its wings, and light a tiny orchard.',
    accent: '#deb388',
    build: castleDemo,
  },
  {
    id: 'butterfly-garden',
    title: 'The butterfly garden',
    category: 'NESTED MECHANISMS',
    description: 'Follow a petal hinge into a garden of wings and sparkles.',
    accent: '#dda4ad',
    build: butterflyDemo,
  },
  {
    id: 'crystal-portal',
    title: 'The crystal portal',
    category: 'PULL-TAB MAGIC',
    description: 'Pull a paper slider to reveal a turning, sparkling crystal.',
    accent: '#a5c6dc',
    build: portalDemo,
  },
];
export function buildDemo(id: DemoId): DemoExperience {
  const demo = DEMOS.find((d) => d.id === id);
  if (!demo) throw new Error('Choose an available demo.');
  return demo.build();
}
