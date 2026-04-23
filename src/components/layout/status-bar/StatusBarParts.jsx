import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';
import { Button } from '@/ui/shadcn/button';
import { cn } from '@/lib/utils.js';

export function StatusDot({ active, warn = false }) {
    const color = warn
        ? 'bg-[var(--status-active)]'
        : active
          ? 'bg-[var(--status-online)]'
          : 'bg-muted-foreground/40';
    return (
        <span
            className={cn('inline-block size-2 shrink-0 rounded-full', color)}
        />
    );
}

export function StatusSegment({
    visible = true,
    active = false,
    warn = false,
    label,
    value,
    children,
    onClick,
    tooltip
}) {
    if (!visible) {
        return null;
    }

    const content = (
        <>
            <StatusDot active={active} warn={warn} />
            <span className="text-muted-foreground text-xs">{label}</span>
            {value ? (
                <span className="text-foreground truncate text-xs">{value}</span>
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
                className="h-6 min-w-0 justify-start gap-1.5 rounded-none border-r px-2 text-left font-normal"
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
                <TooltipTrigger asChild>{segment}</TooltipTrigger>
                <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
            </Tooltip>
        );
    }

    const segment = (
        <div className="flex h-6 min-w-0 items-center gap-1.5 border-r px-2">
            {content}
        </div>
    );
    if (!tooltip) {
        return segment;
    }
    return (
        <Tooltip>
            <TooltipTrigger asChild>{segment}</TooltipTrigger>
            <TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
        </Tooltip>
    );
}
