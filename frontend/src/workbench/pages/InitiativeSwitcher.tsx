import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import type { ColorInitiative } from "../LegendColors";

type Initiative = ColorInitiative & { id: string; sector?: string; department?: string };

export function InitiativeSwitcher({ initiatives, currentId, onSelect }: {
  initiatives: Initiative[];
  currentId: string;
  onSelect: (id: string) => void;
}) {
  if (!initiatives.length) return null;
  return (
    <div className="editor-initiative-switcher">
      <label className="editor-initiative-switcher-label" htmlFor="editor-initiative-select">切换 Initiative</label>
      <NativeSelect id="editor-initiative-select" value={currentId} onChange={(event) => onSelect(event.target.value)}>
        {initiatives.map(item => (
          <NativeSelectOption key={item.id} value={item.id}>
            {[item.name, item.sector, item.department].filter(Boolean).join(" · ")}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </div>
  );
}
