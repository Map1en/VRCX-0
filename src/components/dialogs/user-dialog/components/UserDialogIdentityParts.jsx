import { HistoryIcon } from 'lucide-react';

import { useTranslation } from 'react-i18next';
import { Badge } from '@/ui/shadcn/badge';
import { DropdownMenuCheckboxItem } from '@/ui/shadcn/dropdown-menu';

import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';
import { languageOptionLabel } from '../userProfileFields.js';
import { formatStatsDate } from '../userDialogRows.js';

export function UserTitleLanguages({ languages }) {
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

export function PreviousDisplayNamesBadge({ names }) {
    const { t } = useTranslation();

    if (!names.length) {
        return null;
    }

    const label = `${names.length} previous ${
        names.length === 1 ? 'name' : 'names'
    }`;
    const primaryName = names[0]?.displayName || label;

    return (
        <HoverCard openDelay={150}>
            <HoverCardTrigger asChild>
                <Badge
                    asChild
                    variant="outline"
                    className="bg-background max-w-52 cursor-default text-xs"
                >
                    <button type="button" aria-label={label}>
                        <HistoryIcon data-icon="inline-start" />
                        <span className="min-w-0 truncate">{primaryName}</span>
                        {names.length > 1 ? (
                            <span className="text-muted-foreground shrink-0">
                                +{names.length - 1}
                            </span>
                        ) : null}
                    </button>
                </Badge>
            </HoverCardTrigger>
            <HoverCardContent align="start" className="w-72 p-0">
                <div className="flex flex-col">
                    <div className="border-border flex items-center justify-between gap-3 border-b px-3 py-2">
                        <div className="text-sm font-medium">
                            {t('dialog.user.generated.previous_display_names')}
                        </div>
                        <Badge variant="secondary">{names.length}</Badge>
                    </div>
                    <div className="flex max-h-64 flex-col overflow-auto p-1">
                        {names.map((entry, index) => (
                            <div
                                key={`${entry.displayName}:${entry.updated_at || index}`}
                                className="flex min-w-0 items-center justify-between gap-3 rounded-md px-2 py-1.5"
                            >
                                <span className="min-w-0 truncate font-medium">
                                    {entry.displayName}
                                </span>
                                {entry.updated_at ? (
                                    <span className="text-muted-foreground shrink-0 text-xs">
                                        {formatStatsDate(entry.updated_at)}
                                    </span>
                                ) : null}
                            </div>
                        ))}
                    </div>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}

export function SelfPreferenceCheckboxItem({
    label,
    checked,
    disabled = false,
    onToggle
}) {
    return (
        <DropdownMenuCheckboxItem
            checked={checked}
            disabled={disabled || !onToggle}
            onCheckedChange={() => onToggle?.()}
        >
            <span className="min-w-0 flex-1">{label}</span>
            <span className="text-muted-foreground mr-4 shrink-0 text-xs">
                {checked ? 'Allow' : 'Deny'}
            </span>
        </DropdownMenuCheckboxItem>
    );
}

export function downloadJsonFile(filename, value) {
    const blob = new Blob([JSON.stringify(value, null, 2)], {
        type: 'application/json;charset=utf-8'
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
