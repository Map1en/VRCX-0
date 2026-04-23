import { Badge } from '@/ui/shadcn/badge';

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
                    <Badge
                        key={`${key}:${language?.value || ''}`}
                        variant="outline"
                        className="shrink-0 text-xs"
                        title={label}
                    >
                        {label}
                    </Badge>
                );
            })}
        </span>
    );
}

export function shouldShowGroupBadgeValue(value) {
    const normalizedValue = firstText(value).toLowerCase();
    return Boolean(normalizedValue && normalizedValue !== 'default');
}
