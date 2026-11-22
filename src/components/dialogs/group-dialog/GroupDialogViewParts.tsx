import { GlobeIcon } from 'lucide-react';

import { useLanguageNames } from '@/components/language/useLanguageNames';
import type { GroupProfileRecord } from '@/domain/entities/group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { normalizeProfileLanguageRows } from '../user-dialog/userProfileFields';

export function normalizeGroupLanguages(
    group: GroupProfileRecord,
    languageOptionMap: Parameters<
        typeof normalizeProfileLanguageRows
    >[1] = new Map()
) {
    return normalizeProfileLanguageRows(group, languageOptionMap);
}

type LanguageRow = ReturnType<typeof normalizeProfileLanguageRows>[number];

export function GroupTitleLanguages({
    languages
}: {
    languages: LanguageRow[];
}) {
    const { languageName, languageDetail } = useLanguageNames();
    if (!languages.length) {
        return null;
    }

    return (
        <span className="text-muted-foreground flex min-w-0 items-center gap-2 text-xs">
            <GlobeIcon
                aria-hidden="true"
                className="size-3.5 shrink-0 opacity-70"
            />
            <span className="flex min-w-0 flex-wrap items-center gap-y-0.5">
                {languages.map((language, index) => {
                    const key = language.key || language.value;
                    return (
                        <span
                            key={`${key}:${language.value}`}
                            className="inline-flex shrink-0 items-center"
                        >
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <span className="cursor-default">
                                            {languageName(key)}
                                        </span>
                                    }
                                />
                                <TooltipContent>
                                    {languageDetail(key, language.value)}
                                </TooltipContent>
                            </Tooltip>
                            {index < languages.length - 1 ? (
                                <span className="mx-1 opacity-50">·</span>
                            ) : null}
                        </span>
                    );
                })}
            </span>
        </span>
    );
}
