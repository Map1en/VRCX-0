import { cva } from 'class-variance-authority';

export type SegmentedControlSize = 'default' | 'lg' | 'sm';

export const segmentedControlItemSizeClassNames: Record<
    SegmentedControlSize,
    string
> = {
    default: 'h-8.5 px-[calc(--spacing(2.5)-1px)] sm:h-7.5',
    lg: 'h-9.5 px-[calc(--spacing(3)-1px)] sm:h-8.5',
    sm: 'h-7.5 px-[calc(--spacing(2)-1px)] sm:h-6.5'
};

export const segmentedControlRootClassName =
    'relative z-0 flex w-fit items-center justify-center gap-0.5 rounded-lg bg-muted p-0.5';

export const segmentedControlItemLayoutClassName =
    "gap-1.5 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:-mx-0.5 [&_svg]:shrink-0";

export const segmentedControlItemVariants = cva(
    [
        'text-muted-foreground/72 hover:text-muted-foreground focus-visible:outline-ring relative inline-flex shrink-0 cursor-pointer items-center justify-center rounded-md border border-transparent text-base font-medium whitespace-nowrap outline-2 outline-transparent transition-[outline-color] select-none hover:bg-transparent disabled:pointer-events-none disabled:opacity-64 data-disabled:pointer-events-none data-disabled:opacity-64 sm:text-sm',
        segmentedControlItemLayoutClassName
    ],
    {
        defaultVariants: {
            size: 'default'
        },
        variants: {
            size: segmentedControlItemSizeClassNames,
            state: {
                checked:
                    'data-checked:bg-background data-checked:text-foreground dark:data-checked:bg-input data-checked:shadow-sm/5',
                current:
                    'aria-[current=page]:bg-background aria-[current=page]:text-foreground dark:aria-[current=page]:bg-input aria-[current=page]:shadow-sm/5',
                pressed:
                    'data-pressed:bg-background data-pressed:text-foreground dark:data-pressed:bg-input data-pressed:shadow-sm/5'
            }
        }
    }
);
