import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

export function LanguageCodeBadge({
    code,
    tooltip
}: {
    code: string;
    tooltip: string;
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span
                        className="border-border/70 bg-muted/70 text-muted-foreground inline-flex h-5 min-w-8 items-center justify-center rounded border px-1 font-mono text-[10px] leading-none font-semibold"
                        aria-label={tooltip}
                    >
                        {code}
                    </span>
                }
            />
            <TooltipContent side="top" className="whitespace-pre-line">
                {tooltip}
            </TooltipContent>
        </Tooltip>
    );
}
