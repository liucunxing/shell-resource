import type { ComponentProps } from "react";
import { Popover as Primitive } from "radix-ui";
import { cn } from "@/lib/utils";

const Popover = Primitive.Root;
const PopoverTrigger = Primitive.Trigger;

function PopoverContent({
  className,
  align = "start",
  sideOffset = 6,
  collisionPadding = 12,
  ...props
}: ComponentProps<typeof Primitive.Content>) {
  return (
    <Primitive.Portal>
      <Primitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn("z-50 rounded-md border bg-popover text-popover-foreground shadow-md", className)}
        {...props}
      />
    </Primitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
