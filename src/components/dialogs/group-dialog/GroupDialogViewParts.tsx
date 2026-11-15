import { useLanguageNames } from '@/components/language/useLanguageNames';
import type { GroupProfileRecord } from '@/domain/entities/group';
import { Badge } from '@/ui/shadcn/badge';
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
    languages,
    limit = Infinity
}: {
    languages: LanguageRow[];
    limit?: number;
}) {
    const { languageName, languageDetail } = useLanguageNames();
    if (!languages.length) {
        return null;
    }

    const visibleLanguages = Number.isFinite(limit)
        ? languages.slice(0, limit)
        : languages;
    const hiddenLanguages = Number.isFinite(limit)
        ? languages.slice(limit)
        : [];
    const hiddenLabel = hiddenLanguages
        .map((language) => languageDetail(language.key, language.value))
        .join(', ');

    return (
        <span className="inline-flex max-w-full min-w-0 flex-wrap items-center gap-1">
            {visibleLanguages.map((language) => {
                const key = language.key || language.value;
                const label = languageName(key);
                return (
                    <Tooltip key={`${key}:${language.value}`}>
                        <TooltipTrigger
                            render={
                                <Badge
                                    variant="outline"
                                    className="shrink-0 text-xs"
                                >
                                    {label}
                                </Badge>
                            }
                        />
                        <TooltipContent>
                            {languageDetail(key, language.value)}
                        </TooltipContent>
                    </Tooltip>
                );
            })}
            {hiddenLanguages.length ? (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <Badge
                                variant="outline"
                                className="shrink-0 text-xs"
                            >
                                +{hiddenLanguages.length}
                            </Badge>
                        }
                    />
                    <TooltipContent>{hiddenLabel}</TooltipContent>
                </Tooltip>
            ) : null}
        </span>
    );
}

export function shouldShowGroupBadgeValue(value: string) {
    const normalizedValue = value.trim().toLowerCase();
    return Boolean(normalizedValue && normalizedValue !== 'default');
}
