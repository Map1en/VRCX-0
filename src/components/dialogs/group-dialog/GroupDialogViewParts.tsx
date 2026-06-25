import { Badge } from '@/ui/shadcn/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    languageOptionLabel,
    normalizeProfileLanguageRows
} from '../user-dialog/userProfileFields';
import { firstText } from './groupDialogUtils';

export function normalizeGroupLanguages(
    group: any,
    languageOptionMap: any = new Map()
) {
    return normalizeProfileLanguageRows(group, languageOptionMap);
}

export function GroupTitleLanguages({ languages, limit = Infinity }: any) {
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
            {visibleLanguages.map((language: any) => {
                const key = String(
                    language?.key || language?.value || ''
                ).trim();
                const label = languageOptionLabel(language);
                return (
                    <Tooltip key={`${key}:${language?.value || ''}`}>
                        <TooltipTrigger asChild>
                            <Badge
                                variant="outline"
                                className="shrink-0 text-xs"
                            >
                                {label}
                            </Badge>
                        </TooltipTrigger>
                        <TooltipContent>{label}</TooltipContent>
                    </Tooltip>
                );
            })}
            {hiddenLanguages.length ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <Badge variant="outline" className="shrink-0 text-xs">
                            +{hiddenLanguages.length}
                        </Badge>
                    </TooltipTrigger>
                    <TooltipContent>{hiddenLabel}</TooltipContent>
                </Tooltip>
            ) : null}
        </span>
    );
}

export function shouldShowGroupBadgeValue(value: any) {
    const normalizedValue = firstText(value).toLowerCase();
    return Boolean(normalizedValue && normalizedValue !== 'default');
}
