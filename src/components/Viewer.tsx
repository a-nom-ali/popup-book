import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { Maximize, RotateCcw } from 'lucide-react';
import { useStudio } from '../store';
import { evaluateSpread } from '../engine/geometry';
import type { CompiledSpread } from '../engine/geometry';
import { createPaperMesh, disposeObject } from '../engine/scene';
import { loadMedia, setMatrix, updateMedia } from '../engine/media';
import type { MediaAttachment } from '../engine/media';
import { assemblyTabParts } from '../engine/fabrication';
import { digitalBaseMatrix } from '../engine/digital';
import type { DigitalRuntimeInputs } from '../engine/digital';
import type { DigitalObject, Diagnostic, Vec3 } from '../model';
import { useDigitalRuntime } from '../digitalRuntime';
import { updateDigital } from '../digitalCommands';

export interface ViewerPreview {
  angle: number;
  drivers: Record<string, number>;
  runtime: DigitalRuntimeInputs;
  selectedId?: string | null;
  onTrigger: (targetId: string) => void;
  onNotice?: (message: string) => void;
}

export default function Viewer({
  compiled,
  preview,
}: {
  compiled: CompiledSpread;
  preview?: ViewerPreview;
}) {
  const container = useRef<HTMLDivElement>(null),
    latest = useRef(compiled),
    reset = useRef<() => void>(() => {});
  const previewRef = useRef(preview);
  const [error, setError] = useState('');
  latest.current = compiled;
  previewRef.current = preview;
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
    const contextLost = (event: Event) => {
      event.preventDefault();
      setError(
        'The graphics context was lost. Your project is safe; continue in 2D or reload the viewer.',
      );
    };
    const contextRestored = () => setError('');
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    renderer.domElement.addEventListener('webglcontextrestored', contextRestored);
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
    const proxy = new THREE.Object3D();
    scene.add(proxy);
    const gizmo = new TransformControls(camera, renderer.domElement);
    gizmo.setSpace('local');
    gizmo.setSize(0.8);
    scene.add(gizmo.getHelper());
    const selectionBox = new THREE.BoxHelper(new THREE.Object3D(), '#da9459');
    selectionBox.visible = false;
    scene.add(selectionBox);
    let dragObject: DigitalObject | undefined;
    let dragOriginal: DigitalObject | undefined;
    let wasDragging = false;
    gizmo.addEventListener('dragging-changed', (event) => {
      controls.enabled = !event.value;
    });
    gizmo.addEventListener('mouseDown', () => {
      const id = useStudio.getState().selectedId;
      dragOriginal = latest.current.spread.digital.find((d) => d.id === id);
      dragObject = dragOriginal && structuredClone(dragOriginal);
      wasDragging = true;
    });
    gizmo.addEventListener('objectChange', () => {
      if (!dragOriginal) return;
      const state = useStudio.getState(),
        data = latest.current;
      const pose = evaluateSpread(data, state.angle, state.drivers);
      const parent = pose.parts.find((p) => p.id === dragOriginal!.parent);
      if (!parent) return;
      const front = parent.front ?? 1;
      const base = digitalBaseMatrix(
        { ...dragOriginal, position: [0, 0, 0], rotation: [0, 0, 0], scale: 0.001 },
        pose,
        data,
      ).multiply(new THREE.Matrix4().makeRotationX((-front * Math.PI) / 2));
      proxy.updateMatrix();
      const local = base.invert().multiply(proxy.matrix);
      const position = new THREE.Vector3(),
        rotation = new THREE.Quaternion(),
        scale = new THREE.Vector3();
      local.decompose(position, rotation, scale);
      const q = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(1, 0, 0), (-front * Math.PI) / 2)
        .multiply(rotation);
      const euler = new THREE.Euler().setFromQuaternion(q);
      const factors = [scale.x, scale.y, scale.z].map((n) => n / (1000 * dragOriginal!.scale));
      const factor = factors.reduce((a, b) => (Math.abs(b - 1) > Math.abs(a - 1) ? b : a), 1);
      dragObject = {
        ...dragOriginal,
        position: [position.x, position.y, position.z * front],
        rotation: [euler.x, euler.y, euler.z].map((n) => (n * 180) / Math.PI) as Vec3,
        scale: Math.max(0.000001, dragOriginal.scale * Math.abs(factor)),
      };
    });
    gizmo.addEventListener('mouseUp', () => {
      if (
        dragObject &&
        dragOriginal &&
        JSON.stringify(dragObject) !== JSON.stringify(dragOriginal)
      ) {
        try {
          updateDigital(dragObject.id, {
            position: dragObject.position,
            rotation: dragObject.rotation,
            scale: dragObject.scale,
          });
        } catch (error) {
          useStudio.getState().set({ notice: (error as Error).message });
        }
      }
      dragObject = undefined;
      dragOriginal = undefined;
    });
    const meshes = new Map<string, THREE.Group>();
    let previous: CompiledSpread | undefined,
      previousAngle = -1,
      previousDrivers = '',
      frame = 0,
      generation = 0,
      active = true,
      lastTime = performance.now();
    let media: MediaAttachment[] = [];
    let mediaKey = '';
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
      if (!gizmo.dragging) wasDragging = false;
    };
    const pick = (e: PointerEvent) => {
      if (wasDragging || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
      const r = el.getBoundingClientRect();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster.intersectObject(book, true).find((h) => {
        if (!(h.object instanceof THREE.Mesh)) return false;
        let node: THREE.Object3D | null = h.object;
        while (node) {
          if (!node.visible) return false;
          node = node.parent;
        }
        return true;
      });
      const digitalId = hit?.object.userData.digitalId;
      const id = hit?.object.userData.partId as string | undefined;
      const selectedId =
        digitalId ?? (id?.includes(':tab') ? id.slice(0, id.lastIndexOf(':tab')) : id) ?? null;
      const isolated = previewRef.current;
      if (isolated) {
        if (selectedId) isolated.onTrigger(selectedId);
      } else {
        const state = useStudio.getState();
        if (state.testInteractions || state.reader) {
          if (selectedId) useDigitalRuntime.getState().trigger(latest.current.spread, selectedId);
        } else state.set({ selectedId });
      }
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointerup', pick);
    const animate = () => {
      frame = requestAnimationFrame(animate);
      const isolated = previewRef.current;
      const s = isolated
          ? {
              ...isolated,
              diagnostics: [] as Diagnostic[],
              testInteractions: true,
              reader: true,
              gizmo: 'translate' as const,
              snap: false,
            }
          : useStudio.getState(),
        data = latest.current,
        drivers = JSON.stringify(s.drivers),
        now = performance.now(),
        delta = Math.min((now - lastTime) / 1000, 0.1);
      lastTime = now;
      const pose = evaluateSpread(data, s.angle, s.drivers);
      if (data !== previous || s.angle !== previousAngle || drivers !== previousDrivers) {
        if (data !== previous) {
          // Synchronize source revisions before a fast cached load can publish
          // measurements; the app's passive effect can run after this frame.
          if (!isolated) useDigitalRuntime.getState().sync(data.spread, data.project.assets);
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
          const nextKey = JSON.stringify([
            data.spread.id,
            data.spread.artwork,
            data.spread.decorations,
            data.spread.mechanisms,
            data.project.pageWidth,
            data.project.pageHeight,
            data.spread.digital.map((d) => [d.id, d.source, d.assetId, d.clip, d.parent]),
          ]);
          const assetsChanged =
            !previous ||
            Object.keys(data.project.assets).length !==
              Object.keys(previous.project.assets).length ||
            Object.entries(data.project.assets).some(
              ([id, asset]) =>
                asset.data !== previous?.project.assets[id]?.data ||
                asset.mime !== previous?.project.assets[id]?.mime,
            );
          if (nextKey !== mediaKey || assetsChanged) {
            mediaKey = nextKey;
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
              if (!previewRef.current) {
                const measurements = Object.fromEntries(
                  media
                    .filter((a) => a.digital && a.bounds)
                    .map((a) => [
                      a.id,
                      {
                        min: a.bounds!.min.toArray() as Vec3,
                        max: a.bounds!.max.toArray() as Vec3,
                        clips: a.clips ?? [],
                      },
                    ]),
                );
                useDigitalRuntime.setState({ measurements });
              }
              if (result.errors.length) {
                if (previewRef.current) previewRef.current.onNotice?.(result.errors.join(' '));
                else useStudio.getState().set({ notice: result.errors.join(' ') });
              }
            });
          } else media.forEach((a) => book.add(a.group));
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
      for (const attachment of media)
        if (attachment.digital) {
          attachment.digital =
            dragObject?.id === attachment.id
              ? dragObject
              : data.spread.digital.find((d) => d.id === attachment.id);
          if (attachment.digital) attachment.parent = attachment.digital.parent;
        }
      const runtime = isolated?.runtime ?? useDigitalRuntime.getState().getInputs(s.drivers);
      updateMedia(
        media,
        pose,
        delta,
        runtime.time,
        runtime,
        data,
        dragObject ? { [dragObject.id]: dragObject } : undefined,
      );
      const selectedDigital = data.spread.digital.find((d) => d.id === s.selectedId);
      const selectedMedia = media.find((a) => a.id === s.selectedId && a.digital);
      selectionBox.visible = !!selectedMedia && selectedMedia.group.visible;
      if (selectionBox.visible) selectionBox.setFromObject(selectedMedia!.group);
      if (
        !isolated &&
        !s.reader &&
        !s.testInteractions &&
        selectedDigital &&
        pose.parts.some((p) => p.id === selectedDigital.parent)
      ) {
        gizmo.enabled = true;
        if (gizmo.object !== proxy) gizmo.attach(proxy);
        gizmo.setMode(s.gizmo);
        gizmo.setTranslationSnap(s.snap ? 1 : null);
        gizmo.setRotationSnap(s.snap ? Math.PI / 36 : null);
        if (!gizmo.dragging) {
          digitalBaseMatrix(selectedDigital, pose, data).decompose(
            proxy.position,
            proxy.quaternion,
            proxy.scale,
          );
          proxy.updateMatrix();
        }
      } else {
        gizmo.detach();
        gizmo.enabled = false;
      }
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
      gizmo.dispose();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointerup', pick);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', contextRestored);
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
