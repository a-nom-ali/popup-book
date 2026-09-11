import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Maximize, RotateCcw } from 'lucide-react';
import { useStudio } from '../store';
import { evaluateSpread } from '../engine/geometry';
import type { CompiledSpread } from '../engine/geometry';
import { createPaperMesh, disposeObject } from '../engine/scene';
import { loadMedia, setMatrix, updateMedia } from '../engine/media';
import type { MediaAttachment } from '../engine/media';
import { assemblyTabParts } from '../engine/fabrication';

export default function Viewer({ compiled }: { compiled: CompiledSpread }) {
  const container = useRef<HTMLDivElement>(null),
    latest = useRef(compiled),
    reset = useRef<() => void>(() => {});
  const [error, setError] = useState('');
  latest.current = compiled;
  useEffect(() => {
    const el = container.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setError(
        'The 3D viewer needs WebGL. Enable hardware acceleration or continue in the 2D editor.',
      );
      return;
    }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.setClearColor('#eeeee7');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene(),
      camera = new THREE.PerspectiveCamera(34, 1, 0.1, 5000);
    camera.up.set(0, 0, 1);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.09;
    controls.minDistance = 55;
    controls.maxDistance = 1600;
    controls.maxPolarAngle = Math.PI * 0.89;
    reset.current = () => {
      camera.position.set(275, -350, 300);
      controls.target.set(0, 0, 28);
      controls.update();
    };
    reset.current();
    scene.add(new THREE.HemisphereLight('#ffffff', '#928c75', 2.5));
    const key = new THREE.DirectionalLight('#fff8e5', 3.4);
    key.position.set(-130, -110, 450);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -260;
    key.shadow.camera.right = 260;
    key.shadow.camera.top = 260;
    key.shadow.camera.bottom = -260;
    key.shadow.normalBias = 0.5;
    key.shadow.bias = -0.0001;
    scene.add(key);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(3000, 3000),
      new THREE.ShadowMaterial({ opacity: 0.13 }),
    );
    floor.position.z = -1.4;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(800, 40, '#ced2c6', '#dcdfd4');
    grid.rotateX(Math.PI / 2);
    grid.position.z = -1.5;
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.4;
    scene.add(grid);
    const book = new THREE.Group();
    scene.add(book);
    const meshes = new Map<string, THREE.Group>();
    let previous: CompiledSpread | undefined,
      previousAngle = -1,
      previousDrivers = '',
      frame = 0,
      generation = 0,
      active = true,
      lastTime = performance.now();
    let media: MediaAttachment[] = [];
    const resize = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    const raycaster = new THREE.Raycaster();
    let down = [0, 0];
    const pointerDown = (e: PointerEvent) => {
      down = [e.clientX, e.clientY];
    };
    const pick = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const r = el.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster.intersectObject(book, true).find((h) => h.object instanceof THREE.Mesh);
      const digitalId = hit?.object.userData.digitalId;
      if (digitalId) {
        const a = media.find((a) => a.id === digitalId);
        if (a) {
          a.clicked = true;
          a.elapsed = 0;
          a.action?.reset().play();
        }
      }
      const id = hit?.object.userData.partId as string | undefined;
      useStudio
        .getState()
        .set({
          selectedId:
            digitalId ?? (id?.includes(':tab') ? id.slice(0, id.lastIndexOf(':tab')) : id) ?? null,
        });
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pick);
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const s = useStudio.getState(),
        data = latest.current,
        drivers = JSON.stringify(s.drivers),
        now = performance.now(),
        delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      const pose = evaluateSpread(data, s.angle, s.drivers);
      if (data !== previous || s.angle !== previousAngle || drivers !== previousDrivers) {
        if (data !== previous) {
          // Keep the last valid geometry of failed mechanisms while the document remains editable.
          const previousMeshes = new Map(meshes);
          book.clear();
          meshes.clear();
          for (const [id, mesh] of previousMeshes) {
            const failed = data.spread.mechanisms.some(
              (m) =>
                id.startsWith(`${m.id}:`) &&
                pose.diagnostics.some((d) => d.code === 'unsolved' && d.partIds.includes(m.id)),
            );
            if (failed && previous?.spread.id === data.spread.id) {
              meshes.set(id, mesh);
              book.add(mesh);
            } else disposeObject(mesh);
          }
          media.forEach((a) => disposeObject(a.group));
          media = [];
          const current = ++generation;
          loadMedia(data, pose).then((result) => {
            if (!active || current !== generation) {
              result.attachments.forEach((a) => disposeObject(a.group));
              return;
            }
            media = result.attachments;
            media.forEach((a) => book.add(a.group));
            if (result.errors.length) useStudio.getState().set({ notice: result.errors.join(' ') });
          });
        }
        for (const part of [...pose.parts, ...assemblyTabParts(data, pose)]) {
          let mesh = meshes.get(part.id);
          if (!mesh) {
            mesh = createPaperMesh(part);
            meshes.set(part.id, mesh);
            book.add(mesh);
          }
          setMatrix(mesh, part.matrix);
        }
        previous = data;
        previousAngle = s.angle;
        previousDrivers = drivers;
      }
      updateMedia(media, pose, delta);
      for (const [id, group] of meshes)
        group.traverse((child) => {
          if (child.userData.outline) {
            const m = (child as THREE.Line).material as THREE.LineBasicMaterial;
            const issue = s.diagnostics.some((d) =>
              d.partIds.some((partId) => partId === id || id.startsWith(`${partId}:`)),
            );
            m.color.set(id === s.selectedId ? '#e38654' : issue ? '#c64e37' : '#4f5b4f');
            m.opacity = id === s.selectedId || issue ? 1 : 0.32;
          }
        });
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pick);
      disposeObject(scene);
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);
  return (
    <div className="viewer-wrap">
      <div
        className="viewer-canvas"
        ref={container}
        aria-label="Interactive 3D pop-up book viewer"
      />
      {error && <div className="viewer-error">{error}</div>}
      <div className="viewer-top">
        <span className="surface-label">
          <span className="live-dot" /> LIVE PAPER MODEL
        </span>
        <div className="viewer-actions">
          <button
            className="canvas-button"
            onClick={() => reset.current()}
            title="Reset camera"
            aria-label="Reset camera"
          >
            <RotateCcw size={16} />
          </button>
          <button
            className="canvas-button"
            onClick={() => container.current?.parentElement?.requestFullscreen()}
            title="Fullscreen"
            aria-label="Fullscreen"
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>
      <div className="viewer-hint">
        Drag to orbit <span>·</span> Scroll to zoom <span>·</span> Right-drag to pan
      </div>
      <div className="axis-gizmo">
        <i>X</i>
        <i>Y</i>
        <i>Z</i>
      </div>
    </div>
  );
}
