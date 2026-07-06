'use client';

import { Progress as ProgressPrimitive } from '@base-ui/react/progress';

import { cn } from '@/lib/utils';

function Progress({
    className,
    value,
    ...props
}: ProgressPrimitive.Root.Props) {
    return (
        <ProgressPrimitive.Root
            data-slot="progress"
            value={value}
            className={cn(
                'bg-muted relative h-1 w-full overflow-x-hidden rounded-full',
                className
            )}
            {...props}
        >
            <ProgressPrimitive.Track className="size-full">
                <ProgressPrimitive.Indicator
                    data-slot="progress-indicator"
                    className="bg-primary size-full transition-all"
                />
            </ProgressPrimitive.Track>
        </ProgressPrimitive.Root>
    );
}

export { Progress };
