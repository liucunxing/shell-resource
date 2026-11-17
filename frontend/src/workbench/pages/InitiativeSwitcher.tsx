import { InitiativeChip } from "../InitiativeChip";
import type { ColorInitiative } from "../LegendColors";

type Initiative = ColorInitiative & { id: string; sector?: string; department?: string };

export function InitiativeSwitcher({ initiatives, currentId, onSelect }: {
  initiatives: Initiative[];
  currentId: string;
  onSelect: (id: string) => void;
}) {
  if (!initiatives.length) return null;
  return (
    <section className="editor-initiative-switcher" aria-label="切换 Initiative">
      <span className="editor-initiative-switcher-label">切换 Initiative · 颜色与组合图例一致</span>
      <div className="editor-initiative-switcher-viewport">
        <div
          className="editor-initiative-switcher-grid"
          role="group"
          aria-label="当前版本 Initiative"
          style={{ gridTemplateColumns: `repeat(${Math.ceil(initiatives.length / 2)}, max-content)` }}
        >
          {initiatives.map(item => (
            <InitiativeChip
              key={item.id}
              item={item}
              aria-pressed={item.id === currentId}
              title={[item.name, item.sector, item.department, item.id].filter(Boolean).join(" · ")}
              onClick={() => { if (item.id !== currentId) onSelect(item.id); }}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
