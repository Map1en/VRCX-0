import { Badge } from '@/ui/shadcn/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    languageOptionLabel,
    normalizeProfileLanguageRows
} from '../user-dialog/userProfileFields.js';
import { firstText } from './groupDialogUtils.js';

export function normalizeGroupLanguages(group, languageOptionMap = new Map()) {
    return normalizeProfileLanguageRows(group, languageOptionMap);
}

export function GroupTitleLanguages({ languages }) {
    if (!languages.length) {
        return null;
    }

    return (
        <span className="inline-flex shrink-0 flex-wrap items-center gap-1">
            {languages.map((language) => {
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
        </span>
    );
}

export function shouldShowGroupBadgeValue(value) {
    const normalizedValue = firstText(value).toLowerCase();
    return Boolean(normalizedValue && normalizedValue !== 'default');
}
