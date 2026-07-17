import { Progress as ProgressPrimitive } from '@base-ui/react/progress';

import { cn } from '@/lib/utils';

function Progress({
    className,
    children,
    value,
    ...props
}: ProgressPrimitive.Root.Props) {
    return (
        <ProgressPrimitive.Root
            data-slot="progress"
            value={value}
            className={cn('flex flex-wrap gap-3', className)}
            {...props}
        >
            {children}
            <ProgressTrack>
                <ProgressIndicator />
            </ProgressTrack>
        </ProgressPrimitive.Root>
    );
}

function ProgressTrack({ className, ...props }: ProgressPrimitive.Track.Props) {
    return (
        <ProgressPrimitive.Track
            data-slot="progress-track"
            className={cn(
                'bg-muted relative flex h-1 w-full items-center overflow-x-hidden rounded-full',
                className
            )}
            {...props}
        />
    );
}

function ProgressIndicator({
    className,
    ...props
}: ProgressPrimitive.Indicator.Props) {
    return (
        <ProgressPrimitive.Indicator
            data-slot="progress-indicator"
            className={cn(
                'bg-primary h-full transition-[width] ease-out motion-reduce:transition-none',
                className
            )}
            {...props}
        />
    );
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
    return (
        <ProgressPrimitive.Label
            data-slot="progress-label"
            className={cn('text-sm font-medium', className)}
            {...props}
        />
    );
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
    return (
        <ProgressPrimitive.Value
            data-slot="progress-value"
            className={cn(
                'text-muted-foreground ml-auto text-sm tabular-nums',
                className
            )}
            {...props}
        />
    );
}

export {
    Progress,
    ProgressIndicator,
    ProgressLabel,
    ProgressTrack,
    ProgressValue
};
