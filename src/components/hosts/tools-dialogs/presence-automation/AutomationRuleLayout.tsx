import { PlusIcon, Trash2Icon } from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    Empty,
    EmptyContent,
    EmptyDescription,
    EmptyHeader,
    EmptyTitle
} from '@/ui/shadcn/empty';
import { Input } from '@/ui/shadcn/input';
import { ScrollArea } from '@/ui/shadcn/scroll-area';
import { Switch } from '@/ui/shadcn/switch';

import { updateArrayValue } from '../toolsDialogUtils';
import type { PresenceOption } from './presenceAutomationDialogUtils';

export function AutomationSplitLayout({
    list,
    editor
}: {
    list: ReactNode;
    editor: ReactNode;
}) {
    return (
        <div className="grid min-h-0 gap-3 lg:min-h-[26rem] lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
            {list}
            {editor}
        </div>
    );
}

export function RuleSummaryBadge({ children }: { children: ReactNode }) {
    if (!children) {
        return null;
    }

    return (
        <Badge variant="secondary" className="max-w-full truncate">
            {children}
        </Badge>
    );
}

export function RuleList({
    title,
    description,
    addLabel,
    disabled,
    isEmpty,
    emptyTitle,
    emptyDescription,
    onAdd,
    children
}: {
    title: ReactNode;
    description?: ReactNode;
    addLabel: ReactNode;
    disabled?: boolean;
    isEmpty: boolean;
    emptyTitle: ReactNode;
    emptyDescription?: ReactNode;
    onAdd: () => void;
    children: ReactNode;
}) {
    return (
        <section className="bg-card/40 flex min-h-0 flex-col rounded-lg border">
            <div className="flex items-start justify-between gap-3 border-b px-3 py-2.5">
                <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{title}</div>
                    {description ? (
                        <div className="text-muted-foreground line-clamp-2 text-xs leading-snug">
                            {description}
                        </div>
                    ) : null}
                </div>
                <Button
                    type="button"
                    size="sm"
                    disabled={disabled}
                    onClick={onAdd}
                >
                    <PlusIcon data-icon="inline-start" />
                    {addLabel}
                </Button>
            </div>
            <ScrollArea className="min-h-[14rem] flex-1 lg:max-h-[calc(88vh-15rem)]">
                <div className="flex flex-col gap-1.5 p-2">
                    {isEmpty ? (
                        <Empty className="min-h-[12rem] border">
                            <EmptyHeader>
                                <EmptyTitle>{emptyTitle}</EmptyTitle>
                                {emptyDescription ? (
                                    <EmptyDescription>
                                        {emptyDescription}
                                    </EmptyDescription>
                                ) : null}
                            </EmptyHeader>
                            <EmptyContent>
                                <Button
                                    type="button"
                                    size="sm"
                                    disabled={disabled}
                                    onClick={onAdd}
                                >
                                    <PlusIcon data-icon="inline-start" />
                                    {addLabel}
                                </Button>
                            </EmptyContent>
                        </Empty>
                    ) : (
                        children
                    )}
                </div>
            </ScrollArea>
        </section>
    );
}

export function RuleListItem({
    selected,
    title,
    description,
    badges,
    enabled,
    disabled,
    removeLabel,
    onSelect,
    onEnabledChange,
    onRemove
}: {
    selected: boolean;
    title: ReactNode;
    description?: ReactNode;
    badges?: ReactNode;
    enabled: boolean;
    disabled?: boolean;
    removeLabel: string;
    onSelect: () => void;
    onEnabledChange: (enabled: boolean) => void;
    onRemove: () => void;
}) {
    return (
        <div
            className={cn(
                'flex items-start gap-2 rounded-md border p-2 transition-colors',
                selected
                    ? 'border-primary/50 bg-accent/40'
                    : 'bg-background/40 hover:bg-accent/25'
            )}
        >
            <button
                type="button"
                className="min-w-0 flex-1 text-left"
                onClick={onSelect}
            >
                <div className="truncate text-sm font-medium">{title}</div>
                {description ? (
                    <div className="text-muted-foreground mt-0.5 line-clamp-2 text-xs leading-snug">
                        {description}
                    </div>
                ) : null}
                {badges ? (
                    <div className="mt-1.5 flex min-w-0 flex-wrap gap-1">
                        {badges}
                    </div>
                ) : null}
            </button>
            <div className="flex shrink-0 items-center gap-1">
                <Switch
                    checked={enabled}
                    disabled={disabled}
                    aria-label={String(title || '')}
                    onCheckedChange={onEnabledChange}
                />
                <HintTooltip label={removeLabel}>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={disabled}
                        onClick={onRemove}
                    >
                        <Trash2Icon data-icon="inline-start" />
                    </Button>
                </HintTooltip>
            </div>
        </div>
    );
}

export function RuleEditorPanel({
    title,
    description,
    children
}: {
    title: ReactNode;
    description?: ReactNode;
    children: ReactNode;
}) {
    return (
        <section className="bg-card/40 min-w-0 rounded-lg border">
            <div className="border-b px-3 py-2.5">
                <div className="truncate text-sm font-medium">{title}</div>
                {description ? (
                    <div className="text-muted-foreground text-xs leading-snug">
                        {description}
                    </div>
                ) : null}
            </div>
            <div className="p-3">{children}</div>
        </section>
    );
}

const CHECKLIST_FILTER_THRESHOLD = 12;

export function CompactCheckList({
    values,
    options,
    disabled,
    onChange
}: {
    values: string[];
    options: PresenceOption[];
    disabled?: boolean;
    onChange: (next: string[]) => void;
}) {
    const { t } = useTranslation();
    const [filter, setFilter] = useState('');
    const filterable = options.length > CHECKLIST_FILTER_THRESHOLD;
    const query = filter.trim().toLowerCase();
    const visibleOptions =
        filterable && query
            ? options.filter((option) =>
                  option.label.toLowerCase().includes(query)
              )
            : options;

    return (
        <div className="flex min-w-0 flex-col gap-1.5">
            {filterable ? (
                <div className="flex items-center gap-2">
                    <Input
                        value={filter}
                        disabled={disabled}
                        placeholder={t('common.actions.search')}
                        className="h-8 max-w-60"
                        onChange={(event) => setFilter(event.target.value)}
                    />
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {values.length}/{options.length}
                    </span>
                </div>
            ) : null}
            <div
                className={cn(
                    'flex flex-wrap content-start gap-1.5',
                    filterable && 'max-h-28 overflow-y-auto pr-1'
                )}
            >
                {visibleOptions.map((option) => {
                    const selected = values.includes(option.value);
                    return (
                        <button
                            key={option.value}
                            type="button"
                            aria-pressed={selected}
                            disabled={disabled}
                            className={cn(
                                'max-w-full truncate rounded-full border px-2.5 py-1 text-xs transition-[color,background-color,border-color,transform] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
                                selected
                                    ? 'border-primary bg-primary text-primary-foreground'
                                    : 'border-input text-muted-foreground hover:border-foreground/25 hover:text-foreground'
                            )}
                            onClick={() =>
                                onChange(
                                    updateArrayValue(
                                        values,
                                        option.value,
                                        !selected
                                    )
                                )
                            }
                        >
                            {option.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
