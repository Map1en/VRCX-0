import { cn } from '@/lib/utils';

import { resolveFeedStatusMeta as resolveStatusMeta } from './feedRows';

function FeedStatusBadge({
    status,
    label
}: {
    label?: string;
    status: string | null | undefined;
}) {
    const meta = resolveStatusMeta(status);
    const dotLabel = label ? undefined : meta.label;
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
            {meta.className ? (
                <span
                    role={dotLabel ? 'img' : undefined}
                    aria-hidden={dotLabel ? undefined : true}
                    aria-label={dotLabel}
                    title={dotLabel}
                    className={cn(
                        'size-2.5 shrink-0 rounded-full',
                        meta.className
                    )}
                />
            ) : null}
            {label ? (
                <span className="text-muted-foreground truncate">{label}</span>
            ) : null}
        </span>
    );
}

export { FeedStatusBadge };
