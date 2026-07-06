import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export function StatusDot({ active, warn = false, className }: any) {
    const color = warn
        ? 'bg-[var(--status-active)]'
        : active
          ? 'bg-[var(--status-online)]'
          : 'bg-muted-foreground/40';
    return (
        <span
            className={cn(
                'inline-block size-2 shrink-0 rounded-full',
                color,
                className
            )}
        />
    );
}

export function StatusSegment({
    visible = true,
    active = false,
    warn = false,
    showDot = true,
    label,
    value,
    children,
    className,
    dotClassName,
    labelClassName,
    onClick,
    tooltip,
    valueClassName
}: any) {
    if (!visible) {
        return null;
    }

    const content = (
        <>
            {showDot ? (
                <StatusDot
                    active={active}
                    className={dotClassName}
                    warn={warn}
                />
            ) : null}
            <span
                className={cn(
                    'text-muted-foreground shrink-0 text-xs',
                    labelClassName
                )}
            >
                {label}
            </span>
            {value ? (
                <span
                    className={cn(
                        'text-foreground min-w-0 truncate text-xs',
                        valueClassName
                    )}
                >
                    {value}
                </span>
            ) : null}
            {children}
        </>
    );

    if (typeof onClick === 'function') {
        const segment = (
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                    'h-6 min-w-0 shrink-0 justify-start gap-1.5 rounded-none border-r px-2 text-left font-normal',
                    className
                )}
                onClick={onClick}
            >
                {content}
            </Button>
        );
        if (!tooltip) {
            return segment;
        }
        return (
            <Tooltip>
                <TooltipTrigger render={segment} />
                <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
            </Tooltip>
        );
    }

    const segment = (
        <div
            className={cn(
                'flex h-6 min-w-0 shrink-0 items-center gap-1.5 border-r px-2',
                className
            )}
        >
            {content}
        </div>
    );
    if (!tooltip) {
        return segment;
    }
    return (
        <Tooltip>
            <TooltipTrigger render={segment} />
            <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
        </Tooltip>
    );
}
