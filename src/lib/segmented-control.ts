export type SegmentedControlSize = 'default' | 'lg' | 'sm';

export const segmentedControlItemSizeClassNames: Record<
    SegmentedControlSize,
    string
> = {
    default: 'h-8.5 px-[calc(--spacing(2.5)-1px)] sm:h-7.5',
    lg: 'h-9.5 px-[calc(--spacing(3)-1px)] sm:h-8.5',
    sm: 'h-7.5 px-[calc(--spacing(2)-1px)] sm:h-6.5'
};

export const segmentedControlItemLayoutClassName =
    "gap-1.5 [&_svg:not(.lucide):not([class*='opacity-'])]:opacity-80 [&_.lucide]:text-muted-foreground [&_.lucide:not([class*='opacity-'])]:opacity-[0.576] hover:[&_.lucide:not([class*='opacity-'])]:opacity-80 data-active:[&_.lucide]:text-foreground data-active:[&_.lucide:not([class*='opacity-'])]:opacity-80 data-checked:[&_.lucide]:text-foreground data-checked:[&_.lucide:not([class*='opacity-'])]:opacity-80 aria-[current=page]:[&_.lucide]:text-foreground aria-[current=page]:[&_.lucide:not([class*='opacity-'])]:opacity-80 data-pressed:[&_.lucide]:text-foreground data-pressed:[&_.lucide:not([class*='opacity-'])]:opacity-80 [&_.lucide:not([class*='transition-'])]:transition-[color,opacity] [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:-mx-0.5 [&_svg]:shrink-0";
