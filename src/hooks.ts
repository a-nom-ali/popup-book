import { useEffect } from 'react';
import { useStudio } from './store';
import { loadLocal, saveLocal, download, packProject, safeName } from './io/projects';
import { z } from 'zod';
import { SCENERY } from './scenery';
import { insertScenery, insertIllustratedExample } from './sceneryCommands';
import { traceImage } from './io/trace';
import { DIGITAL_BUILTINS, digitalObjectSchema } from './model';
import {
  insertDigital,
  updateDigital,
  duplicateDigital,
  removeDigital,
  placeDigitalBase,
} from './digitalCommands';
import { useDigitalRuntime } from './digitalRuntime';
import { DEMOS, buildDemo } from './demos';
import { appendDemo } from './demoCommands';
import { compileProject, evaluateSpread } from './engine/geometry';
import { evaluateDigitalPresentation } from './engine/digital';

export function usePersistence() {
  useEffect(() => {
    let alive = true,
      timer: ReturnType<typeof setTimeout>,
      unsubscribe = () => {};
    const initial = useStudio.getState().project;
    let queue = Promise.resolve();
    const save = () => {
      const project = useStudio.getState().project;
      queue = queue
        .then(() => saveLocal(project))
        .then(() => {
          if (alive && useStudio.getState().project === project)
            useStudio.getState().set({ saveStatus: 'Saved on this device' });
        })
        .catch((error) => {
          if (alive)
            useStudio.getState().set({
              saveStatus: 'Save failed',
              notice: `Local save failed: ${error.message}. Download a project file to keep your work.`,
            });
        });
    };
    loadLocal()
      .then((project) => {
        if (!alive) return;
        if (project && useStudio.getState().project === initial)
          useStudio.getState().replaceProject(project);
        useStudio.getState().set({ saveStatus: project ? 'Saved on this device' : 'Saving…' });
        save();
      })
      .catch((error) => {
        if (alive)
          useStudio.getState().set({
            saveStatus: 'Storage unavailable',
            notice: `Local recovery failed: ${error.message}. You can still open or download project files.`,
          });
      })
      .finally(() => {
        if (!alive) return;
        unsubscribe = useStudio.subscribe((state, previous) => {
          if (state.project !== previous.project) {
            clearTimeout(timer);
            timer = setTimeout(save, 500);
          }
        });
      });
    return () => {
      alive = false;
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);
}
export function useKeyboard() {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const s = useStudio.getState(),
        target = e.target as HTMLElement;
      // Modal demo controls have their own state. Studio shortcuts must not edit
      // the book behind an isolated preview (or any other modal dialog).
      if (document.querySelector('[role="dialog"], dialog[open]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        try {
          download(packProject(s.project), `${safeName(s.project.name)}.popupbook`);
          s.set({ notice: 'Project file downloaded' });
        } catch (error) {
          s.set({ notice: `Save failed: ${(error as Error).message}` });
        }
        return;
      }
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? s.redo() : s.undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        s.redo();
      } else if (e.code === 'Space') {
        e.preventDefault();
        s.set({ playing: !s.playing });
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.deleteSelected();
      } else if (e.key === 'Escape') s.set({ selectedId: null, tool: 'select', reader: false });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
export function useAgentTools() {
  useEffect(() => {
    type Tool = {
      name: string;
      description: string;
      inputSchema: unknown;
      annotations?: { readOnlyHint?: boolean };
      execute: (input: unknown) => unknown;
    };
    const context = (
      document as Document & {
        modelContext?: {
          registerTool: (tool: Tool, options: { signal: AbortSignal }) => Promise<void> | void;
        };
      }
    ).modelContext;
    if (!context) return;
    const controller = new AbortController();
    const register = (tool: Tool) => {
      try {
        Promise.resolve(context.registerTool(tool, { signal: controller.signal })).catch(() => {});
      } catch {
        /* Browser does not support this proposed API. */
      }
    };
    register({
      name: 'inspect_book',
      description: 'Read the current book spreads, mechanism IDs, opening angle, and diagnostics.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: () => {
        const s = useStudio.getState();
        return {
          name: s.project.name,
          version: s.project.version,
          saveStatus: s.saveStatus,
          undoSteps: s.past.length,
          activeSpreadId: s.activeSpreadId,
          spreads: s.project.spreads.map((p) => ({
            id: p.id,
            name: p.name,
            mechanisms: p.mechanisms,
            decorations: p.decorations,
            artwork: p.artwork,
            digital: p.digital,
          })),
          assets: Object.values(s.project.assets).map(({ id, name, mime }) => ({ id, name, mime })),
          scenery: SCENERY.map(({ id, name }) => ({ id, name })),
          digitalLibrary: DIGITAL_BUILTINS,
          demos: DEMOS.map(({ id, title }) => ({ id, title })),
          digitalRuntime: useDigitalRuntime.getState().getInputs(s.drivers),
          angle: s.angle,
          drivers: s.drivers,
          diagnostics: s.diagnostics,
        };
      },
    });
    register({
      name: 'add_mechanisms',
      description:
        'Insert supported presets into the active spread. These are real editable paper mechanisms.',
      inputSchema: {
        type: 'object',
        properties: {
          presets: {
            type: 'array',
            items: { enum: ['vfold', 'tent', 'bloom', 'pavilion', 'scene', 'slider'] },
            maxItems: 20,
          },
          host: { type: 'string' },
        },
        required: ['presets'],
      },
      execute: (input) => {
        const data = input as { presets?: string[]; host?: string };
        if (
          !Array.isArray(data.presets) ||
          data.presets.length > 20 ||
          data.presets.some(
            (k) => !['vfold', 'tent', 'bloom', 'pavilion', 'scene', 'slider'].includes(k),
          )
        )
          throw new Error('Use up to 20 supported presets.');
        for (const kind of data.presets) useStudio.getState().addPreset(kind as 'vfold', data.host);
        return { count: data.presets.length };
      },
    });
    register({
      name: 'set_book_drivers',
      description:
        'Set the book opening angle and normalized pull-tab positions in the visible editor.',
      inputSchema: {
        type: 'object',
        properties: {
          angle: { type: 'number', minimum: 0, maximum: 180 },
          sliders: {
            type: 'object',
            additionalProperties: { type: 'number', minimum: 0, maximum: 1 },
          },
        },
      },
      execute: (input) => {
        const data = input as { angle?: number; sliders?: Record<string, number> };
        if (
          data.angle !== undefined &&
          (!Number.isFinite(data.angle) || data.angle < 0 || data.angle > 180)
        )
          throw new Error('Angle must be between 0 and 180.');
        const sliders = data.sliders ?? {};
        const ids = useStudio
          .getState()
          .project.spreads.flatMap((s) =>
            s.mechanisms.filter((m) => m.kind === 'slider').map((m) => m.id),
          );
        if (
          Object.entries(sliders).some(
            ([id, n]) => !ids.includes(id) || !Number.isFinite(n) || n < 0 || n > 1,
          )
        )
          throw new Error('Provide existing slider IDs with positions from 0 to 1.');
        const s = useStudio.getState();
        s.set({
          angle: data.angle ?? s.angle,
          drivers: { ...s.drivers, ...sliders },
          playing: false,
        });
        return { angle: useStudio.getState().angle, drivers: useStudio.getState().drivers };
      },
    });
    register({
      name: 'insert_scenery',
      description:
        'Insert illustrated paper scenery with a tuned tent support, attach it to a selected parent ID, or append the worked example spread. Uses the same undoable editor commands as the scenery library.',
      inputSchema: {
        type: 'object',
        properties: {
          itemId: { type: 'string' },
          parentId: { type: 'string' },
          example: { type: 'boolean' },
        },
      },
      execute: (input) => {
        const data = z
          .object({
            itemId: z.string().optional(),
            parentId: z.string().optional(),
            example: z.boolean().optional(),
          })
          .parse(input);
        if (data.example) return { spreadId: insertIllustratedExample() };
        if (!data.itemId) throw new Error('Provide a scenery item ID or example:true.');
        return { partIds: insertScenery(data.itemId, data.parentId) };
      },
    });
    register({
      name: 'glue_image_cutout',
      description:
        'Trace an existing PNG asset into physical paper pieces and glue them onto one existing panel. Returns every disconnected piece ID. No external files are fetched.',
      inputSchema: {
        type: 'object',
        properties: {
          assetId: { type: 'string' },
          parentId: { type: 'string' },
          width: { type: 'number', exclusiveMinimum: 0 },
          threshold: { type: 'number', minimum: 0.01, maximum: 1 },
          tolerance: { type: 'number', minimum: 0, maximum: 5 },
        },
        required: ['assetId', 'parentId'],
      },
      execute: async (input) => {
        const data = z
          .object({
            assetId: z.string(),
            parentId: z.string(),
            width: z.number().positive().max(2000).optional(),
            threshold: z.number().min(0.01).max(1).optional(),
            tolerance: z.number().min(0).max(5).optional(),
          })
          .parse(input);
        const s = useStudio.getState(),
          asset = s.project.assets[data.assetId];
        if (!asset) throw new Error('Choose an existing PNG asset ID.');
        const trace = await traceImage(asset, data),
          current = useStudio.getState();
        if (current.project.id !== s.project.id || current.activeSpreadId !== s.activeSpreadId)
          throw new Error('The destination changed while tracing.');
        return {
          partIds: current.insertCutout(asset, trace, data.parentId),
          warnings: trace.warnings,
        };
      },
    });
    register({
      name: 'transform_cutout',
      description:
        'Move, rotate in degrees, proportionally resize, or reattach a paper cut-out in millimetres. One atomic undo step; use edit_cutout_glue afterward to recalculate its glue area.',
      inputSchema: {
        type: 'object',
        properties: {
          partId: { type: 'string' },
          position: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
          rotation: { type: 'number' },
          scale: { type: 'number', exclusiveMinimum: 0 },
          parent: { type: 'string' },
        },
        required: ['partId'],
      },
      execute: (input) => {
        const { partId, ...transform } = z
          .object({
            partId: z.string(),
            position: z.tuple([z.number().finite(), z.number().finite()]).optional(),
            rotation: z.number().finite().optional(),
            scale: z.number().positive().max(100).optional(),
            parent: z.string().optional(),
          })
          .parse(input);
        useStudio.getState().transformCutout(partId, transform);
        return { partId };
      },
    });
    register({
      name: 'edit_cutout_glue',
      description:
        'Suggest the cut-out glue region from actual overlap, or set explicitly drawn local millimetre regions. Invalid physical placements remain editable and are diagnosed.',
      inputSchema: {
        type: 'object',
        properties: {
          partId: { type: 'string' },
          regions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                outline: {
                  type: 'array',
                  items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                  minItems: 3,
                },
                holes: {
                  type: 'array',
                  items: {
                    type: 'array',
                    items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
                  },
                },
              },
              required: ['outline', 'holes'],
            },
          },
        },
        required: ['partId'],
      },
      execute: (input) => {
        const point = z.tuple([z.number().finite(), z.number().finite()]),
          data = z
            .object({
              partId: z.string(),
              regions: z
                .array(
                  z.object({
                    outline: z.array(point).min(3),
                    holes: z.array(z.array(point).min(3)),
                  }),
                )
                .optional(),
            })
            .parse(input);
        const s = useStudio.getState();
        if (data.regions) s.setCutoutGlue(data.partId, data.regions);
        else s.suggestCutoutGlue(data.partId);
        return { partId: data.partId };
      },
    });
    register({
      name: 'insert_digital',
      description:
        'Attach a bundled digital prop/effect or existing GLB asset to a paper panel or cut-out. One undo step.',
      inputSchema: {
        type: 'object',
        properties: {
          builtin: { enum: DIGITAL_BUILTINS },
          assetId: { type: 'string' },
          parentId: { type: 'string' },
        },
      },
      execute: (input) => {
        const data = z
          .object({
            builtin: z.enum(DIGITAL_BUILTINS).optional(),
            assetId: z.string().optional(),
            parentId: z.string().optional(),
          })
          .parse(input);
        if (!!data.builtin === !!data.assetId)
          throw new Error('Choose exactly one builtin or assetId.');
        return {
          id: insertDigital(
            data.builtin
              ? { kind: 'builtin', id: data.builtin, seed: 42, count: 16 }
              : { kind: 'glb', assetId: data.assetId! },
            data.parentId,
          ),
        };
      },
    });
    register({
      name: 'edit_digital',
      description:
        'Update digital placement and behaviors, duplicate, remove, or place its measured base on the panel. Changes use the same validated commands as the inspector.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          action: { enum: ['update', 'duplicate', 'remove', 'place-base'] },
          patch: {
            type: 'object',
            description:
              'DigitalObject fields: position/rotation triples, scale, parent, source, entrance, motion, triggers, behavior, clip, sliderId, angleStart/End.',
          },
        },
        required: ['id', 'action'],
      },
      execute: (input) => {
        const data = z
          .object({
            id: z.string(),
            action: z.enum(['update', 'duplicate', 'remove', 'place-base']),
            patch: digitalObjectSchema.partial().optional(),
          })
          .parse(input);
        if (data.action === 'duplicate') return { id: duplicateDigital(data.id) };
        if (data.action === 'remove') removeDigital(data.id);
        if (data.action === 'update') updateDigital(data.id, data.patch ?? {});
        if (data.action === 'place-base') {
          const bounds = useDigitalRuntime.getState().measurements[data.id];
          if (!bounds)
            throw new Error(
              'Open the 3D viewer and wait for the model to load before placing its base.',
            );
          placeDigitalBase(data.id, bounds);
        }
        return { id: data.id };
      },
    });
    register({
      name: 'test_digital',
      description:
        'Control session-only digital playback. Trigger a visible paper/digital target in Test interactions, preview an individual action, pause, seek, or restart. Does not edit the project.',
      inputSchema: {
        type: 'object',
        properties: {
          targetId: { type: 'string' },
          objectId: { type: 'string' },
          action: { enum: ['entrance', 'clip', 'toggle'] },
          time: { type: 'number', minimum: 0 },
          paused: { type: 'boolean' },
          restart: { type: 'boolean' },
        },
      },
      execute: (input) => {
        const data = z
          .object({
            targetId: z.string().optional(),
            objectId: z.string().optional(),
            action: z.enum(['entrance', 'clip', 'toggle']).optional(),
            time: z.number().nonnegative().finite().optional(),
            paused: z.boolean().optional(),
            restart: z.boolean().optional(),
          })
          .parse(input);
        const state = useStudio.getState(),
          spread = state.project.spreads.find((sp) => sp.id === state.activeSpreadId)!;
        if (data.restart) useDigitalRuntime.getState().reset();
        if (data.paused !== undefined) useDigitalRuntime.setState({ paused: data.paused });
        if (data.time !== undefined) useDigitalRuntime.setState({ time: data.time });
        if (data.targetId) {
          const compiled = compileProject(state.project, spread.id),
            pose = evaluateSpread(compiled, state.angle, state.drivers);
          const target = spread.digital.find((d) => d.id === data.targetId);
          if (
            !pose.parts.some((p) => p.id === data.targetId) &&
            (!target ||
              !evaluateDigitalPresentation(
                target,
                pose,
                useDigitalRuntime.getState().getInputs(state.drivers),
                { compiled },
              ).visible)
          )
            throw new Error(
              'Choose a visible paper or digital trigger target, or preview an individual object action.',
            );
          state.set({ testInteractions: true, view: '3d' });
          useDigitalRuntime.getState().trigger(spread, data.targetId);
        }
        if (data.objectId && data.action) {
          if (!spread.digital.some((d) => d.id === data.objectId))
            throw new Error('Choose an existing digital object.');
          useDigitalRuntime.getState().preview(data.objectId, data.action);
        }
        return useDigitalRuntime.getState().getInputs(state.drivers);
      },
    });
    register({
      name: 'insert_demo',
      description:
        'Append a fresh editable digital demo and its assets, scaled to the current book. One undo step. Never replaces existing spreads.',
      inputSchema: {
        type: 'object',
        properties: { demoId: { type: 'string' } },
        required: ['demoId'],
      },
      execute: (input) => {
        const { demoId } = z.object({ demoId: z.string() }).parse(input),
          definition = DEMOS.find((d) => d.id === demoId);
        if (!definition) throw new Error('Choose a demo from inspect_book.');
        const demo = buildDemo(definition.id),
          state = useStudio.getState();
        let id = '';
        state.edit('Interactive demo added', (project) => {
          id = appendDemo(project, demo.project).spread.id;
        });
        state.selectSpread(id);
        state.set({ view: '3d', angle: demo.angle });
        return { spreadId: id };
      },
    });
    return () => controller.abort();
  }, []);
}
