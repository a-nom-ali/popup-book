/** Original thumbnails projected directly from the demo's paper and digital meshes. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AnimationMixer, Color, Matrix3, Mesh, OrthographicCamera, Vector3 } from 'three';
import { DEMOS } from '../../demos';
import { compileProject, evaluateSpread } from '../../engine/geometry';
import {
  createDigitalRuntime,
  dispatchDigitalEvent,
  evaluateDigitalPresentation,
} from '../../engine/digital';
import { createBuiltinModel } from '../../engine/digitalModels';

export async function generateDemoThumbnails() {
  const output = resolve(process.cwd(), 'src/assets/demos');
  await mkdir(output, { recursive: true });
  for (const demo of DEMOS) {
    const experience = demo.build(),
      spread = experience.project.spreads[0];
    const drivers = Object.fromEntries(
      spread.mechanisms.filter((m) => m.kind === 'slider').map((m) => [m.id, 1]),
    );
    const compiled = compileProject(experience.project, spread.id),
      pose = evaluateSpread(compiled, 150, drivers);
    let runtime = { ...createDigitalRuntime(), time: 0, drivers };
    for (const trigger of experience.triggers)
      runtime = dispatchDigitalEvent(spread, runtime, trigger.targetId);
    runtime.time = 2.1;
    const camera = new OrthographicCamera(-195, 195, 127.5, -127.5, 0.1, 1400);
    const focus = new Vector3(demo.id === 'crystal-portal' ? 80 : 0, 0, 40);
    camera.up.set(0, 0, 1);
    camera.position.copy(focus).add(new Vector3(255, -330, 275));
    camera.lookAt(focus);
    camera.zoom =
      demo.id === 'enchanted-castle' ? 1.12 : demo.id === 'butterfly-garden' ? 1.32 : 1.55;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const point = (v: Vector3) => {
      const p = v.clone().project(camera);
      return new Vector3((p.x + 1) * 260, (1 - p.y) * 170, p.z);
    };
    const f = (value: number) => value.toFixed(2);
    const xy = (v: Vector3) => `${f(v.x)},${f(v.y)}`;
    const layers: { depth: number; svg: string }[] = [],
      defs: string[] = [];
    let serial = 0;
    for (const part of pose.parts) {
      const project = ([x, y]: [number, number]) =>
        point(new Vector3(x, y, 0).applyMatrix4(part.matrix));
      const outline = part.polygon.map(project),
        holes = part.holes.map((h) => h.map(project));
      const path = [outline, ...holes].map((points) => `M${points.map(xy).join('L')}Z`).join('');
      const depth = outline.reduce((sum, v) => sum + v.z, 0) / outline.length;
      const clip = `paper-${serial++}`;
      defs.push(`<clipPath id="${clip}"><path d="${path}" clip-rule="evenodd"/></clipPath>`);
      let svg = `<path d="${path}" fill="${part.color}" fill-rule="evenodd" stroke="#6c705c" stroke-opacity=".24" stroke-width=".6"/>`;
      for (const art of spread.artwork.filter((a) => a.partId === part.id)) {
        const asset = experience.project.assets[art.assetId];
        if (!asset) continue;
        const origin = project([art.x, art.y]),
          x = project([art.x + art.width, art.y]).sub(origin),
          y = project([art.x, art.y + art.height]).sub(origin);
        svg += `<g clip-path="url(#${clip})"><image href="${asset.data}" width="1" height="1" preserveAspectRatio="none" transform="matrix(${f(x.x)} ${f(x.y)} ${f(y.x)} ${f(y.y)} ${f(origin.x)} ${f(origin.y)})"/></g>`;
      }
      layers.push({ depth, svg });
    }
    for (const object of spread.digital) {
      if (object.source?.kind !== 'builtin') continue;
      const model = createBuiltinModel(object.source);
      const presentation = evaluateDigitalPresentation(object, pose, runtime, { compiled });
      if (!presentation.visible) continue;
      if (model.animations.length) {
        const mixer = new AnimationMixer(model.scene);
        mixer.clipAction(model.animations[0]).play();
        mixer.setTime(0.35);
      }
      model.evaluate?.(runtime.time);
      model.scene.matrixAutoUpdate = false;
      model.scene.matrix.copy(presentation.worldMatrix);
      model.scene.updateMatrixWorld(true);
      const light = new Vector3(-0.4, -0.6, 1).normalize();
      model.scene.traverse((node) => {
        if (!(node instanceof Mesh)) return;
        const geometry = node.geometry,
          pos = geometry.getAttribute('position'),
          index = geometry.getIndex();
        const material = Array.isArray(node.material) ? node.material[0] : node.material;
        const base = 'color' in material ? (material.color as Color) : new Color('#d9ddae');
        const normalMatrix = new Matrix3().getNormalMatrix(node.matrixWorld);
        const count = index?.count ?? pos.count;
        for (let i = 0; i < count; i += 3) {
          const ids = [0, 1, 2].map((offset) => (index ? index.getX(i + offset) : i + offset));
          const local = ids.map((id) => new Vector3().fromBufferAttribute(pos, id));
          const normal = local[1]
            .clone()
            .sub(local[0])
            .cross(local[2].clone().sub(local[0]))
            .normalize()
            .applyMatrix3(normalMatrix)
            .normalize();
          const vertices = local.map((v) => point(v.applyMatrix4(node.matrixWorld)));
          const shade = 0.7 + 0.3 * Math.abs(normal.dot(light));
          const color = base.clone().multiplyScalar(shade).getStyle();
          layers.push({
            depth: vertices.reduce((sum, v) => sum + v.z, 0) / 3,
            svg: `<path d="M${vertices.map(xy).join('L')}Z" fill="${color}" fill-opacity="${f(material.opacity)}"/>`,
          });
        }
      });
      model.scene.traverse((node) => {
        if (node instanceof Mesh) {
          node.geometry.dispose();
          for (const m of Array.isArray(node.material) ? node.material : [node.material])
            m.dispose();
        }
      });
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="340" viewBox="0 0 520 340"><title>${demo.title} — actual demo geometry</title><defs><radialGradient id="bg"><stop stop-color="#f3f1e7"/><stop offset="1" stop-color="#d8dfd0"/></radialGradient>${defs.join('')}</defs><rect width="520" height="340" rx="14" fill="url(#bg)"/><ellipse cx="258" cy="256" rx="175" ry="42" fill="#4c6142" opacity=".09"/>${layers
      .sort((a, b) => b.depth - a.depth)
      .map((l) => l.svg)
      .join('')}</svg>`;
    await writeFile(resolve(output, `${demo.id}.svg`), svg);
  }
}
