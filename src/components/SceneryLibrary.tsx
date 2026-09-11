import { Plus, Scissors, Sparkles } from 'lucide-react';
import { SCENERY } from '../scenery';
import { insertIllustratedExample, insertScenery } from '../sceneryCommands';
import { useStudio } from '../store';

export default function SceneryLibrary({
  parentId,
  onInsert,
}: {
  parentId?: string;
  onInsert: () => void;
}) {
  const run = (fn: () => unknown) => {
    try {
      fn();
      onInsert();
    } catch (e) {
      useStudio.getState().set({ notice: (e as Error).message });
    }
  };
  return (
    <div className="scenery-library">
      <div className="library-heading">
        <div>
          <span className="eyebrow">BRING THE PAGE TO LIFE</span>
          <h2>Scenery</h2>
        </div>
        <Sparkles size={18} />
      </div>
      <div className="scenery-grid">
        {SCENERY.map((item) => (
          <article className="scenery-card" key={item.id}>
            <div className="scenery-art">
              <img src={item.asset.data} alt={item.name} />
            </div>
            <strong>{item.name}</strong>
            <p>{item.description}</p>
            <button
              title="Attach to selected panel"
              disabled={!parentId}
              onClick={() => run(() => insertScenery(item.id, parentId))}
            >
              <Scissors size={13} />
              Attach to selected panel
            </button>
            <button onClick={() => run(() => insertScenery(item.id))}>
              <Plus size={13} />
              Insert with mechanism
            </button>
          </article>
        ))}
      </div>
      <button className="scenery-example" onClick={() => run(insertIllustratedExample)}>
        <Sparkles size={16} />
        Insert illustrated example
      </button>
      <p className="scenery-note">
        Geometrically checked placements.
        <br />
        Physically untested. Print at 100%.
      </p>
    </div>
  );
}
