import type { GroupProfileRecord } from '@/domain/entities/profileEntities';
import { Badge } from '@/ui/shadcn/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    languageOptionLabel,
    normalizeProfileLanguageRows
} from '../user-dialog/userProfileFields';
import { firstText } from './groupDialogUtils';

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
    if (!languages.length) {
        return null;
    }

    const visibleLanguages = Number.isFinite(limit)
        ? languages.slice(0, limit)
        : languages;
    const hiddenLanguages = Number.isFinite(limit)
        ? languages.slice(limit)
        : [];
    const hiddenLabel = hiddenLanguages.map(languageOptionLabel).join(', ');

    return (
        <span className="inline-flex max-w-full min-w-0 flex-wrap items-center gap-1">
            {visibleLanguages.map((language) => {
                const key = String(
                    language?.key || language?.value || ''
                ).trim();
                const label = languageOptionLabel(language);
                return (
                    <Tooltip key={`${key}:${language?.value || ''}`}>
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
                        <TooltipContent>{label}</TooltipContent>
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

export function shouldShowGroupBadgeValue(value: unknown) {
    const normalizedValue = firstText(value).toLowerCase();
    return Boolean(normalizedValue && normalizedValue !== 'default');
}
