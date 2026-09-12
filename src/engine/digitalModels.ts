import * as THREE from 'three';

export type BuiltinModelId =
  'dragon' | 'butterfly' | 'crystal' | 'fireflies' | 'sparkles' | 'portal';
export type BuiltinSource = { kind: 'builtin'; id: BuiltinModelId; seed?: number; count?: number };
export const BUILTIN_MODELS: {
  id: BuiltinModelId;
  name: string;
  category: 'prop' | 'effect';
  description: string;
  height: number;
}[] = [
  {
    id: 'dragon',
    name: 'Paperwood dragon',
    category: 'prop',
    description: 'A little forest dragon with animated wings',
    height: 0.05,
  },
  {
    id: 'butterfly',
    name: 'Painted butterfly',
    category: 'prop',
    description: 'Four jewel-coloured wings with a flutter clip',
    height: 0.07,
  },
  {
    id: 'crystal',
    name: 'Moon crystal',
    category: 'prop',
    description: 'A faceted crystal with a ring of small shards',
    height: 0.07,
  },
  {
    id: 'fireflies',
    name: 'Fireflies',
    category: 'effect',
    description: 'Seeded warm lights following gentle looping paths',
    height: 0.065,
  },
  {
    id: 'sparkles',
    name: 'Starlight',
    category: 'effect',
    description: 'A constellation of slowly rising mesh stars',
    height: 0.065,
  },
  {
    id: 'portal',
    name: 'Moon gate',
    category: 'effect',
    description: 'An emissive ring with orbiting motes',
    height: 0.07,
  },
];
export interface BuiltinModel {
  scene: THREE.Group;
  animations: THREE.AnimationClip[];
  /** Local bounds in metres, with the origin at the ground beneath the prop. */
  bounds: THREE.Box3;
  evaluate?: (time: number) => void;
}
const material = (color: string, emission?: string) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.65,
    metalness: 0.08,
    ...(emission ? { emissive: emission, emissiveIntensity: 1.1 } : {}),
  });
const mint = '#86a987',
  forest = '#3c7165',
  rose = '#d28f90',
  gold = '#eec88b';
function mesh(
  parent: THREE.Object3D,
  name: string,
  geometry: THREE.BufferGeometry,
  mat: THREE.Material,
  position: number[] = [0, 0, 0],
  scale: number[] = [1, 1, 1],
) {
  const node = new THREE.Mesh(geometry, mat);
  node.name = name;
  node.position.set(position[0], position[1], position[2]);
  node.scale.set(scale[0], scale[1], scale[2]);
  parent.add(node);
  return node;
}
function oval(
  parent: THREE.Object3D,
  name: string,
  position: number[],
  scale: number[],
  mat: THREE.Material,
) {
  return mesh(parent, name, new THREE.IcosahedronGeometry(1, 1), mat, position, scale);
}
function wing(
  parent: THREE.Group,
  name: string,
  side: number,
  points: number[][],
  mat: THREE.MeshStandardMaterial,
) {
  const group = new THREE.Group();
  group.name = name;
  parent.add(group);
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0] * side, points[0][1]);
  for (const point of points.slice(1)) shape.lineTo(point[0] * side, point[1]);
  shape.closePath();
  mat.side = THREE.DoubleSide;
  mesh(group, `${name}_membrane`, new THREE.ShapeGeometry(shape), mat);
  return group;
}
function wingClip(
  name: string,
  left: string,
  right: string,
  axis: 'y' | 'z',
  amplitude: number,
  duration: number,
) {
  const times = [0, duration / 4, duration / 2, (duration * 3) / 4, duration],
    values = [0, amplitude, 0, -amplitude, 0];
  return new THREE.AnimationClip(
    name,
    duration,
    [left, right].map(
      (target, index) =>
        new THREE.QuaternionKeyframeTrack(
          `${target}.quaternion`,
          times,
          values.flatMap((value) =>
            new THREE.Quaternion()
              .setFromAxisAngle(
                axis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1),
                value * (index ? -1 : 1),
              )
              .toArray(),
          ),
        ),
    ),
  );
}
function dragon(): BuiltinModel {
  const scene = new THREE.Group(),
    body = material(mint),
    dark = material(forest),
    accent = material(gold),
    eye = material('#fff8dc'),
    pupil = material('#263f41');
  scene.name = 'Paperwood_dragon';
  oval(scene, 'Body', [0, 0.019, 0.004], [0.013, 0.018, 0.019], body);
  oval(scene, 'Head', [0, 0.032, -0.018], [0.014, 0.014, 0.015], body);
  oval(scene, 'Muzzle', [0, 0.027, -0.031], [0.011, 0.007, 0.01], body);
  for (const side of [-1, 1]) {
    oval(scene, `Foot_${side}`, [side * 0.01, 0.004, -0.007], [0.007, 0.004, 0.011], dark);
    oval(scene, `Eye_${side}`, [side * 0.0115, 0.034, -0.026], [0.0037, 0.0047, 0.0024], eye);
    oval(scene, `Pupil_${side}`, [side * 0.0122, 0.034, -0.028], [0.0018, 0.0028, 0.0013], pupil);
    const horn = mesh(scene, `Horn_${side}`, new THREE.ConeGeometry(0.0034, 0.011, 5), accent, [
      side * 0.008,
      0.046,
      -0.015,
    ]);
    horn.rotation.z = -side * 0.3;
    const pivot = wing(
      scene,
      side < 0 ? 'Wing_left' : 'Wing_right',
      side,
      [
        [0, 0],
        [0.018, 0.026],
        [0.04, 0.018],
        [0.033, 0.006],
        [0.021, 0.009],
        [0.008, -0.002],
      ],
      material(rose),
    );
    pivot.position.set(side * 0.009, 0.024, 0.009);
    pivot.rotation.x = -Math.PI / 2;
    // Animate a child hinge so the authored plane orientation remains fixed.
    const membrane = pivot.children[0];
    pivot.remove(membrane);
    const hinge = new THREE.Group();
    hinge.name = `${pivot.name}_flap`;
    hinge.add(membrane);
    pivot.add(hinge);
  }
  for (let i = 0; i < 4; i++) {
    const tail = mesh(
      scene,
      `Tail_${i}`,
      new THREE.ConeGeometry(0.007 - i * 0.0014, 0.018, 6),
      body,
      [0, 0.012 - i * 0.0015, 0.025 + i * 0.011],
    );
    tail.rotation.x = Math.PI / 2;
  }
  for (let i = 0; i < 4; i++)
    mesh(scene, `Spine_${i}`, new THREE.ConeGeometry(0.003, 0.008, 3), accent, [
      0,
      0.036 - i * 0.004,
      i * 0.009,
    ]);
  return {
    scene,
    animations: [wingClip('Wing beat', 'Wing_left_flap', 'Wing_right_flap', 'y', 0.65, 1.2)],
    bounds: new THREE.Box3().setFromObject(scene),
  };
}
function butterfly(): BuiltinModel {
  const scene = new THREE.Group();
  scene.name = 'Painted_butterfly';
  oval(scene, 'Body', [0, 0.034, 0], [0.0025, 0.017, 0.003], material('#4b495b'));
  oval(scene, 'Head', [0, 0.052, 0], [0.004, 0.004, 0.004], material('#4b495b'));
  for (const side of [-1, 1]) {
    const pivot = wing(
      scene,
      side < 0 ? 'Wing_left' : 'Wing_right',
      side,
      [
        [0, 0],
        [0.013, 0.023],
        [0.027, 0.031],
        [0.037, 0.022],
        [0.032, 0.007],
        [0.014, -0.001],
        [0.028, -0.014],
        [0.022, -0.026],
        [0.009, -0.025],
      ],
      material(side < 0 ? '#a69bd0' : '#d6a0be'),
    );
    pivot.position.y = 0.032;
    for (const [x, y, size] of [
      [0.025, 0.019, 0.006],
      [0.015, -0.015, 0.004],
    ])
      oval(pivot, `Spot_${side}_${y}`, [x * side, y, 0.0004], [size, size, 0.0006], material(gold));
    const antenna = mesh(
      scene,
      `Antenna_${side}`,
      new THREE.CylinderGeometry(0.0005, 0.0005, 0.011, 4),
      material('#4b495b'),
      [side * 0.004, 0.061, 0],
    );
    antenna.rotation.z = -side * 0.4;
  }
  return {
    scene,
    animations: [wingClip('Flutter', 'Wing_left', 'Wing_right', 'y', 0.9, 0.8)],
    bounds: new THREE.Box3().setFromObject(scene),
  };
}
function crystal(): BuiltinModel {
  const scene = new THREE.Group();
  scene.name = 'Moon_crystal';
  mesh(
    scene,
    'Crystal',
    new THREE.OctahedronGeometry(1),
    material('#a9dcdf', '#3b747c'),
    [0, 0.037, 0],
    [0.018, 0.034, 0.018],
  );
  mesh(
    scene,
    'Base',
    new THREE.CylinderGeometry(0.027, 0.029, 0.005, 8),
    material('#536573'),
    [0, 0.0025, 0],
  );
  for (let i = 0; i < 5; i++) {
    const angle = (i * Math.PI * 2) / 5,
      shard = mesh(
        scene,
        `Shard_${i}`,
        new THREE.OctahedronGeometry(1),
        material('#b6a4df', '#655480'),
        [Math.cos(angle) * 0.018, 0.012, Math.sin(angle) * 0.018],
        [0.005, 0.013, 0.005],
      );
    shard.rotation.z = Math.sin(angle) * 0.3;
    shard.rotation.x = Math.cos(angle) * 0.3;
  }
  return { scene, animations: [], bounds: new THREE.Box3().setFromObject(scene) };
}
export function seededRandom(seed: number) {
  let state = (Number.isFinite(seed) ? seed : 1) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
function effect(source: BuiltinSource): BuiltinModel {
  const scene = new THREE.Group(),
    random = seededRandom(source.seed ?? 1),
    count = Math.min(
      64,
      Math.max(1, Math.floor(Number.isFinite(source.count) ? source.count! : 16)),
    ),
    particles: {
      node: THREE.Mesh;
      phase: number;
      radius: number;
      speed: number;
      height: number;
      size: number;
    }[] = [];
  scene.name = `${source.id}_effect`;
  if (source.id === 'portal') {
    mesh(
      scene,
      'Gate_outer',
      new THREE.TorusGeometry(0.03, 0.002, 6, 40),
      material('#b6b0ed', '#8075bf'),
      [0, 0.035, 0],
    );
    mesh(
      scene,
      'Gate_inner',
      new THREE.TorusGeometry(0.025, 0.0008, 5, 40),
      material('#d3ebdc', '#79b9a0'),
      [0, 0.035, 0],
    );
    for (const side of [-1, 1])
      mesh(
        scene,
        `Gate_foot_${side}`,
        new THREE.ConeGeometry(0.006, 0.014, 5),
        material('#5d7172'),
        [side * 0.021, 0.007, 0],
      );
  }
  const mat =
    source.id === 'fireflies'
      ? material('#ffe7a6', '#efc765')
      : source.id === 'portal'
        ? material('#dfd8ff', '#a594db')
        : material('#ffe5cf', '#d9a6d7');
  for (let i = 0; i < count; i++) {
    const node = mesh(
        scene,
        `Mote_${i}`,
        source.id === 'fireflies'
          ? new THREE.IcosahedronGeometry(1, 0)
          : new THREE.OctahedronGeometry(1, 0),
        mat,
      ),
      size = 0.0012 + random() * 0.001;
    particles.push({
      node,
      phase: random() * Math.PI * 2,
      radius: 0.012 + random() * 0.024,
      speed: 0.5 + random() * 0.6,
      height: 0.009 + random() * 0.047,
      size,
    });
  }
  const evaluate = (seconds: number) => {
    const time = Number.isFinite(seconds) ? seconds : 0;
    for (const p of particles) {
      const phase = p.phase + time * p.speed;
      if (source.id === 'portal')
        p.node.position.set(
          Math.cos(phase) * 0.028,
          0.035 + Math.sin(phase) * 0.028,
          Math.sin(phase * 2 + p.phase) * 0.004,
        );
      else if (source.id === 'fireflies')
        p.node.position.set(
          Math.cos(phase) * p.radius,
          p.height + Math.sin(phase * 1.7) * 0.007,
          Math.sin(phase * 0.83) * p.radius,
        );
      else
        p.node.position.set(
          Math.cos(p.phase) * p.radius + Math.sin(phase) * 0.004,
          p.height + Math.sin(phase * 0.6) * 0.008,
          Math.sin(p.phase) * p.radius,
        );
      const scale = p.size * (0.65 + 0.35 * (0.5 + Math.sin(phase * 2) * 0.5));
      p.node.scale.set(scale, source.id === 'sparkles' ? scale * 1.7 : scale, scale);
      p.node.rotation.set(phase * 0.3, phase, phase * 0.5);
    }
  };
  evaluate(0);
  return {
    scene,
    animations: [],
    evaluate,
    bounds: new THREE.Box3(new THREE.Vector3(-0.04, 0, -0.04), new THREE.Vector3(0.04, 0.07, 0.04)),
  };
}
export function createBuiltinModel(source: BuiltinSource): BuiltinModel {
  if (source.id === 'dragon') return dragon();
  if (source.id === 'butterfly') return butterfly();
  if (source.id === 'crystal') return crystal();
  if (['fireflies', 'sparkles', 'portal'].includes(source.id)) return effect(source);
  throw new Error(`Unknown built-in digital model: ${source.id}`);
}
