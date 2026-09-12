import { Sparkles, Plus, Gem, WandSparkles, Orbit, Bug, Flame, Wind } from 'lucide-react';
import { insertDigital } from '../digitalCommands';
import { useStudio } from '../store';

const items = [
  { id: 'dragon', name: 'Winged dragon', hint: 'Articulated wings', Icon: Flame },
  { id: 'butterfly', name: 'Butterfly', hint: 'A little flutter', Icon: Bug },
  { id: 'crystal', name: 'Floating crystal', hint: 'Faceted & luminous', Icon: Gem },
  { id: 'fireflies', name: 'Fireflies', hint: 'Seeded wandering lights', Icon: Wind },
  { id: 'sparkles', name: 'Sparkles', hint: 'Orbiting paper stars', Icon: Sparkles },
  { id: 'portal', name: 'Portal', hint: 'A ring of possibility', Icon: Orbit },
] as const;
export default function DigitalLibrary({
  parentId,
  onInsert,
  onDemos,
}: {
  parentId?: string;
  onInsert: () => void;
  onDemos: () => void;
}) {
  return (
    <section className="digital-library">
      <div className="library-heading">
        <div>
          <span className="eyebrow">ANOTHER LAYER OF WONDER</span>
          <h2>Digital</h2>
        </div>
        <WandSparkles size={18} />
      </div>
      <div className="digital-grid">
        {items.map(({ id, name, hint, Icon }, i) => (
          <button
            key={id}
            className={`digital-card digital-${i}`}
            aria-label={`Add ${name}`}
            onClick={() => {
              try {
                const objectId = insertDigital(
                  { kind: 'builtin', id, seed: 42, count: 16 },
                  parentId,
                );
                useStudio
                  .getState()
                  .set({ selectedId: objectId, view: '3d', testInteractions: false });
                onInsert();
              } catch (e) {
                useStudio.getState().set({ notice: (e as Error).message });
              }
            }}
          >
            <span className="digital-card-art">
              <Icon size={27} strokeWidth={1.3} />
              <Plus size={12} />
            </span>
            <strong>{name}</strong>
            <small>{hint}</small>
          </button>
        ))}
      </div>
      <p className="property-note">
        Attach to the selected paper part, or the right page. Digital objects stay out of printed
        templates.
      </p>
      <button className="scenery-example demos-launch" onClick={onDemos}>
        <Sparkles size={16} />
        <span>
          Explore interactive demos<small>Three scenes. Step inside the settings.</small>
        </span>
      </button>
    </section>
  );
}
