import { languageShortCode } from '@/shared/utils/userLanguage';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { useLanguageNames } from './useLanguageNames';

export function LanguageCodeBadge({
    languageKey,
    nativeName
}: {
    languageKey: string;
    nativeName?: string;
}) {
    const { languageDetail } = useLanguageNames();
    const code = languageShortCode(languageKey);
    if (!code) {
        return null;
    }
    const tooltip = languageDetail(languageKey, nativeName);
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
