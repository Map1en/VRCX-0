import { CopyIcon, HistoryIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { DropdownMenuCheckboxItem } from '@/ui/shadcn/dropdown-menu';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';

import {
    formatStatsDate,
    normalizePreviousDisplayNames
} from '../userDialogRows';

export function PreviousDisplayNamesBadge({
    names,
    onCopyName
}: {
    names: ReturnType<typeof normalizePreviousDisplayNames>;
    onCopyName: (name: string) => void;
}) {
    const { t } = useTranslation();

    if (!names.length) {
        return null;
    }

    const label = `${names.length} previous ${
        names.length === 1 ? 'name' : 'names'
    }`;
    const primaryName = names[0]?.displayName || label;

    return (
        <HoverCard>
            <HoverCardTrigger
                delay={150}
                render={
                    <Badge
                        variant="ghost"
                        className="text-muted-foreground max-w-52 cursor-pointer px-1 text-xs font-normal"
                        render={
                            <button
                                type="button"
                                aria-label={`${t('common.actions.copy')}: ${primaryName} (${label})`}
                                title={t('common.actions.copy')}
                                onClick={() => onCopyName(primaryName)}
                            >
                                <HistoryIcon data-icon="inline-start" />
                                <span className="min-w-0 truncate">
                                    {primaryName}
                                </span>
                                {names.length > 1 ? (
                                    <span className="shrink-0 opacity-70">
                                        +{names.length - 1}
                                    </span>
                                ) : null}
                            </button>
                        }
                    />
                }
            />
            <HoverCardContent align="start" className="w-72 p-0">
                <div className="flex flex-col">
                    <div className="border-border flex items-center justify-between gap-3 border-b px-3 py-2">
                        <div className="text-sm font-medium">
                            {t('dialog.user.label.previous_display_names')}
                        </div>
                        <Badge variant="secondary">{names.length}</Badge>
                    </div>
                    <div className="flex max-h-64 flex-col overflow-auto p-1">
                        {names.map((entry, index) => (
                            <Button
                                key={`${entry.displayName}:${entry.updated_at || index}`}
                                type="button"
                                variant="ghost"
                                className="h-auto w-full min-w-0 justify-start gap-3 rounded-md px-2 py-1.5 text-left"
                                aria-label={`${t('common.actions.copy')}: ${entry.displayName}`}
                                title={t('common.actions.copy')}
                                onClick={() => onCopyName(entry.displayName)}
                            >
                                <span className="min-w-0 flex-1 truncate font-medium">
                                    {entry.displayName}
                                </span>
                                {entry.updated_at ? (
                                    <span className="text-muted-foreground shrink-0 text-xs">
                                        {formatStatsDate(entry.updated_at)}
                                    </span>
                                ) : null}
                                <CopyIcon
                                    aria-hidden="true"
                                    className="text-muted-foreground size-3.5 shrink-0"
                                />
                            </Button>
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
}: {
    label: ReactNode;
    checked: boolean;
    disabled?: boolean;
    onToggle?: () => void;
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

export function downloadJsonFile(filename: string, value: unknown) {
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
