import { useEffect, useState } from 'react';
import { MoreHorizontalIcon, RefreshCwIcon } from 'lucide-react';

import { cn } from '@/lib/utils.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Button } from '@/ui/shadcn/button';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Textarea } from '@/ui/shadcn/textarea';

function EntityDialogScaffold({ className, children }) {
    return (
        <div className={cn('flex min-h-0 min-w-0 w-full flex-1 flex-col gap-4 md:w-[65rem]', className)}>
            {children}
        </div>
    );
}

function EntityDialogHeader({
    imageUrl,
    imageAlt,
    imagePlaceholder,
    imageClassName,
    onImageClick,
    titlePrefix,
    title,
    onTitleClick,
    titleMeta,
    subtitle,
    onSubtitleClick,
    badges,
    mediaBadges,
    description,
    descriptionAction,
    detail,
    actions
}) {
    return (
        <div className="flex shrink-0 flex-col gap-4 md:flex-row md:items-start">
            <Button
                type="button"
                variant="ghost"
                disabled={!imageUrl || !onImageClick}
                onClick={onImageClick}
                className={cn(
                    'h-auto aspect-[4/3] w-40 shrink-0 overflow-hidden rounded-md border bg-muted p-0 disabled:pointer-events-none',
                    imageUrl && onImageClick ? 'cursor-pointer' : 'cursor-default',
                    imageClassName
                )}>
                {imageUrl ? <img src={imageUrl} alt={imageAlt || ''} className="size-full object-cover" /> : imagePlaceholder}
            </Button>

            <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex flex-col gap-1">
                            <div className="flex min-w-0 items-center gap-1.5 break-words text-lg font-semibold leading-tight">
                                {titlePrefix}
                                {onTitleClick ? (
                                    <Button type="button" variant="link" className="h-auto min-w-0 justify-start break-words p-0 text-left text-lg font-semibold whitespace-normal" onClick={onTitleClick}>
                                        {title}
                                    </Button>
                                ) : (
                                    <span className="min-w-0 break-words">{title}</span>
                                )}
                                {titleMeta}
                            </div>
                            {subtitle ? (
                                onSubtitleClick ? (
                                    <Button type="button" variant="link" className="h-auto justify-start break-all p-0 text-left font-mono text-sm text-muted-foreground whitespace-normal" onClick={onSubtitleClick}>
                                        {subtitle}
                                    </Button>
                                ) : (
                                    <div className="break-all font-mono text-sm text-muted-foreground">
                                        {subtitle}
                                    </div>
                                )
                            ) : null}
                        </div>

                        {badges ? <div className="flex flex-wrap gap-1.5">{badges}</div> : null}

                        {mediaBadges ? <div className="flex flex-wrap items-center gap-1.5">{mediaBadges}</div> : null}

                        {description ? (
                            <div className="flex items-start gap-2">
                                <div className="max-h-24 flex-1 overflow-auto whitespace-pre-wrap text-sm text-muted-foreground">
                                    {description}
                                </div>
                                {descriptionAction ? <div className="shrink-0">{descriptionAction}</div> : null}
                            </div>
                        ) : null}

                        {detail ? <div className="text-xs text-muted-foreground">{detail}</div> : null}
                    </div>

                    {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
                </div>
            </div>
        </div>
    );
}

function EntityDialogTabs({ value, onValueChange, tabs, children }) {
    return (
        <Tabs value={value} onValueChange={onValueChange} className="flex min-h-0 flex-1 flex-col gap-0">
            <TabsList
                variant="line"
                className="relative flex h-10 w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0">
                {tabs.map((tab) => (
                    <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        className="h-10 flex-none rounded-none border-0 bg-transparent px-3 text-muted-foreground shadow-none after:bottom-0 after:bg-primary hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none">
                        {tab.label}
                    </TabsTrigger>
                ))}
            </TabsList>
            {children}
        </Tabs>
    );
}

function EntityDialogTabContent({ value, className, children }) {
    return (
        <TabsContent
            value={value}
            forceMount
            className={cn('m-0 min-h-0 flex-1 overflow-auto pt-4 data-[state=inactive]:hidden', className)}>
            {children}
        </TabsContent>
    );
}

function EntityMemoTextarea({ label = 'Memo', value = '', placeholder = '', onSave }) {
    const normalizedValue = typeof value === 'string' ? value : '';
    const [draft, setDraft] = useState(normalizedValue);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        setDraft(normalizedValue);
    }, [normalizedValue]);

    async function saveDraft() {
        if (!onSave || saving || draft === normalizedValue) {
            return;
        }
        setSaving(true);
        try {
            await onSave(draft);
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="box-border flex w-full cursor-default items-center p-1.5 text-sm">
            <div className="flex-1 overflow-hidden">
                <span className="block truncate font-medium leading-5">{label}</span>
                <Textarea
                    value={draft}
                    rows={2}
                    placeholder={placeholder}
                    disabled={saving}
                    className="mt-1 min-h-0 resize-none text-xs"
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => void saveDraft()}
                />
            </div>
        </div>
    );
}

function EntityActionDropdown({ children, busy = false, dangerous = false, indicator = false }) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-lg"
                    variant={dangerous ? 'destructive' : 'outline'}
                    aria-label="Open entity actions"
                    className="relative">
                    {busy ? <Spinner data-icon="inline-start" /> : <MoreHorizontalIcon data-icon="inline-start" />}
                    {indicator ? (
                        <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary" />
                    ) : null}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuGroup>
                    {children}
                </DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function EntityActionItem({ children, icon: Icon, destructive = false, disabled = false, shortcut = null, onSelect }) {
    return (
        <DropdownMenuItem
            disabled={disabled}
            variant={destructive ? 'destructive' : 'default'}
            onSelect={(event) => {
                if (disabled) {
                    event.preventDefault();
                    return;
                }
                onSelect?.(event);
            }}>
            {Icon ? <Icon /> : null}
            <span className="min-w-0 flex-1">{children}</span>
            {shortcut ? <span className="ml-auto">{shortcut}</span> : null}
        </DropdownMenuItem>
    );
}

function EntityActionSeparator() {
    return <DropdownMenuSeparator />;
}

function EntityRawJson({ value, valueFactory }) {
    const [snapshot, setSnapshot] = useState(() =>
        typeof valueFactory === 'function' ? valueFactory() : value
    );
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        setSnapshot(typeof valueFactory === 'function' ? valueFactory() : value);
    }, [value]);

    async function refreshJson() {
        setRefreshing(true);
        try {
            setSnapshot(typeof valueFactory === 'function' ? valueFactory() : value);
        } finally {
            setRefreshing(false);
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" onClick={() => void refreshJson()} disabled={refreshing}>
                    {refreshing ? <Spinner data-icon="inline-start" /> : <RefreshCwIcon data-icon="inline-start" />}
                    Refresh
                </Button>
            </div>
            <pre className="max-h-[55vh] overflow-auto rounded-md border bg-muted/20 p-3 text-xs">
                {JSON.stringify(snapshot ?? null, null, 2)}
            </pre>
        </div>
    );
}

function EntityBlank({ children = '—' }) {
    return <div className="text-sm text-muted-foreground">{children}</div>;
}

function EntityInfoGrid({ children, className }) {
    return <div className={cn('flex flex-wrap items-start px-2.5', className)}>{children}</div>;
}

function EntityInfoBlock({ label, value, mono = false, full = false, wide = false, onClick, children }) {
    const Component = onClick ? 'button' : 'div';
    return (
        <Component
            type={onClick ? 'button' : undefined}
            onClick={onClick}
            className={cn(
                'flex items-center p-1.5 text-left text-sm',
                full ? 'w-full' : wide ? 'w-80' : 'w-44',
                onClick ? 'cursor-pointer hover:rounded-md hover:bg-muted/50' : 'cursor-default'
            )}>
            <div className="min-w-0 flex-1 overflow-hidden">
                <span className="block truncate font-medium leading-snug">{label}</span>
                {children || (
                    <span className={cn('block truncate text-xs', mono ? 'font-mono' : '')}>
                        {value || '—'}
                    </span>
                )}
            </div>
        </Component>
    );
}

export {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityBlank,
    EntityDialogHeader,
    EntityDialogScaffold,
    EntityDialogTabContent,
    EntityDialogTabs,
    EntityInfoBlock,
    EntityInfoGrid,
    EntityMemoTextarea,
    EntityRawJson
};
