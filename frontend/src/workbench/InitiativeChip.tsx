import type { CSSProperties, ComponentProps } from "react";
import { Button } from "../components/ui/button";
import { useLegendColors, type ColorInitiative } from "./LegendColors";

type Props = Omit<ComponentProps<typeof Button>, "children"> & {
  item: ColorInitiative;
  name?: string;
};

export function InitiativeChip({ item, name = item.name, className = "", style, ...props }: Props) {
  const { initiativeColor } = useLegendColors();
  return (
    <Button
      variant="outline"
      className={`v20-initiative-chip ${className}`.trim()}
      style={{ "--initiative-color": initiativeColor(item), ...style } as CSSProperties}
      title={name}
      {...props}
    >
      {name}
    </Button>
  );
}
