import { useEffect } from 'react';
import { useStudio } from './store';
import { loadLocal, saveLocal, download, packProject, safeName } from './io/projects';
import { z } from 'zod';
import { SCENERY } from './scenery';
import { insertScenery, insertIllustratedExample } from './sceneryCommands';
import { traceImage } from './io/trace';

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
          activeSpreadId: s.activeSpreadId,
          spreads: s.project.spreads.map((p) => ({
            id: p.id,
            name: p.name,
            mechanisms: p.mechanisms,
            decorations: p.decorations,
            artwork: p.artwork,
          })),
          assets: Object.values(s.project.assets).map(({ id, name, mime }) => ({ id, name, mime })),
          scenery: SCENERY.map(({ id, name }) => ({ id, name })),
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
    return () => controller.abort();
  }, []);
}
