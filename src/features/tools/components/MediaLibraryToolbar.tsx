// @ts-nocheck
import { cn } from '@/lib/utils.js';

export function MediaLibraryToolbar({
    title,
    description,
    leading,
    actions,
    children,
    className
}) {
    const hasTitle = Boolean(title || description);

    return (
        <div className={cn('flex shrink-0 flex-col gap-2 py-2', className)}>
            <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                    {hasTitle ? (
                        <div className="min-w-0">
                            {title ? (
                                <div className="font-heading text-base font-medium">
                                    {title}
                                </div>
                            ) : null}
                            {description ? (
                                <div className="text-muted-foreground text-sm">
                                    {description}
                                </div>
                            ) : null}
                        </div>
                    ) : null}
                    {leading ? (
                        <div className="min-w-0 flex-1">{leading}</div>
                    ) : null}
                </div>
                {actions ? (
                    <div className="flex flex-wrap items-center gap-2">
                        {actions}
                    </div>
                ) : null}
            </div>
            {children}
        </div>
    );
}
