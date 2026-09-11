import { describe, expect, it } from 'vitest';
import { useStudio } from './store';
import { exampleProject } from './presets';
import { insertIllustratedExample, insertScenery } from './sceneryCommands';
import { packProject, unpackProject } from './io/projects';
import { glueRegionValid } from './engine/cutouts';
import { compileProject, evaluateSpread } from './engine/geometry';

describe('scenery editor workflows', () => {
  it('inserts a complete mechanism or attaches to existing paper with atomic history and portable assets', () => {
    useStudio.getState().replaceProject(exampleProject());
    const before = useStudio.getState().project;
    const [id] = insertScenery('oak');
    let state = useStudio.getState(),
      spread = state.project.spreads.find((s) => s.id === state.activeSpreadId)!;
    const piece = spread.decorations.find((d) => d.id === id)!;
    const parent = evaluateSpread(compileProject(state.project, spread.id), 180).parts.find(
      (p) => p.id === piece.parent,
    )!;
    expect(glueRegionValid(piece, parent)).toBe(true);
    expect(state.past).toHaveLength(1);
    state.undo();
    expect(useStudio.getState().project).toEqual(before);
    state.redo();
    state = useStudio.getState();
    const mechanisms = state.project.spreads.find((s) => s.id === state.activeSpreadId)!.mechanisms
      .length;
    const [attached] = insertScenery('castle', 'page-right');
    state = useStudio.getState();
    spread = state.project.spreads.find((s) => s.id === state.activeSpreadId)!;
    expect(spread.mechanisms).toHaveLength(mechanisms);
    expect(spread.decorations.find((d) => d.id === attached)?.parent).toBe('page-right');
    expect(unpackProject(packProject(state.project))).toEqual(state.project);
    expect(state.past).toHaveLength(2);
  });
  it('appends the scaled example without replacing existing work, then restores it in one undo', () => {
    const project = exampleProject();
    project.pageHeight = 148;
    useStudio.getState().replaceProject(project);
    const id = insertIllustratedExample(),
      state = useStudio.getState();
    expect(state.project.spreads.slice(0, 3)).toEqual(project.spreads);
    expect(state.activeSpreadId).toBe(id);
    expect(state.project.spreads[3].mechanisms[0].width).toBeLessThan(30);
    expect(Object.keys(state.project.assets).length).toBeGreaterThan(
      Object.keys(project.assets).length,
    );
    state.undo();
    expect(useStudio.getState().project).toEqual(project);
  });
});
