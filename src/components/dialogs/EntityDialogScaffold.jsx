import {
    ChevronRightIcon,
    MoreHorizontalIcon,
    RefreshCwIcon
} from 'lucide-react';
import { useEffect, useState } from 'react';

import { useTranslation } from 'react-i18next';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { cn } from '@/lib/utils.js';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Spinner } from '@/ui/shadcn/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import { Textarea } from '@/ui/shadcn/textarea';

function EntityDialogScaffold({ className, children }) {
    return (
        <div
            className={cn(
                'flex min-h-0 w-full min-w-0 flex-1 flex-col gap-4',
                className
            )}
        >
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
                    'bg-muted aspect-[4/3] h-auto w-40 shrink-0 overflow-hidden rounded-md border p-0 disabled:pointer-events-none',
                    imageUrl && onImageClick
                        ? 'cursor-pointer'
                        : 'cursor-default',
                    imageClassName
                )}
            >
                {imageUrl ? (
                    <img
                        src={imageUrl}
                        alt={imageAlt || ''}
                        className="size-full object-cover"
                    />
                ) : (
                    imagePlaceholder
                )}
            </Button>

            <div className="min-w-0 flex-1">
                <div className="flex items-start gap-3">
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <div className="flex flex-col gap-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-lg leading-tight font-semibold break-words">
                                {titlePrefix}
                                {onTitleClick ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="h-auto min-w-0 justify-start p-0 text-left text-lg font-semibold break-words whitespace-normal hover:text-primary"
                                        onClick={onTitleClick}
                                    >
                                        {title}
                                    </Button>
                                ) : (
                                    <span className="min-w-0 break-words">
                                        {title}
                                    </span>
                                )}
                                {titleMeta}
                            </div>
                            {subtitle ? (
                                onSubtitleClick ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        className="text-muted-foreground h-auto justify-start p-0 text-left font-mono text-sm break-all whitespace-normal hover:text-primary"
                                        onClick={onSubtitleClick}
                                    >
                                        {subtitle}
                                    </Button>
                                ) : (
                                    <div className="text-muted-foreground font-mono text-sm break-all">
                                        {subtitle}
                                    </div>
                                )
                            ) : null}
                        </div>

                        {badges ? (
                            <div className="flex flex-wrap gap-1.5">
                                {badges}
                            </div>
                        ) : null}

                        {mediaBadges ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                                {mediaBadges}
                            </div>
                        ) : null}

                        {description ? (
                            <div className="flex items-start gap-2">
                                <div className="text-muted-foreground max-h-24 flex-1 overflow-auto text-sm whitespace-pre-wrap">
                                    {description}
                                </div>
                                {descriptionAction ? (
                                    <div className="shrink-0">
                                        {descriptionAction}
                                    </div>
                                ) : null}
                            </div>
                        ) : null}

                        {detail ? (
                            <div className="text-muted-foreground text-xs">
                                {userFacingErrorMessage(
                                    detail,
                                    'The requested data could not be loaded.'
                                )}
                            </div>
                        ) : null}
                    </div>

                    {actions ? (
                        <div className="flex shrink-0 items-center gap-2">
                            {actions}
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
}

function EntityDialogTabs({ value, onValueChange, tabs, children }) {
    return (
        <Tabs
            value={value}
            onValueChange={onValueChange}
            className="flex min-h-0 flex-1 flex-col gap-0"
        >
            <TabsList
                variant="line"
                className="relative flex h-10 w-full justify-start overflow-x-auto rounded-none border-b bg-transparent p-0"
            >
                {tabs.map((tab) => (
                    <TabsTrigger
                        key={tab.value}
                        value={tab.value}
                        className="text-muted-foreground after:bg-primary hover:text-foreground data-[state=active]:text-primary h-10 flex-none rounded-none border-0 bg-transparent px-3 shadow-none after:bottom-0 data-[state=active]:bg-transparent data-[state=active]:shadow-none"
                    >
                        {tab.label}
                    </TabsTrigger>
                ))}
            </TabsList>
            {children}
        </Tabs>
    );
}

function EntityDialogTabContent({
    value,
    className,
    children,
    forceMount = false
}) {
    return (
        <TabsContent
            value={value}
            forceMount={forceMount || undefined}
            className={cn(
                'm-0 min-h-0 flex-1 overflow-auto pt-4 data-[state=inactive]:hidden',
                className
            )}
        >
            {children}
        </TabsContent>
    );
}

function EntityMemoTextarea({
    label = 'Memo',
    value = '',
    placeholder = '',
    onSave
}) {
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
                <span className="block truncate leading-5 font-medium">
                    {label}
                </span>
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

function EntityActionDropdown({
    children,
    busy = false,
    dangerous = false,
    indicator = false
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-lg"
                    variant={dangerous ? 'destructive' : 'outline'}
                    aria-label={"Open entity actions"}
                    className="relative"
                >
                    {busy ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <MoreHorizontalIcon data-icon="inline-start" />
                    )}
                    {indicator ? (
                        <span className="bg-primary absolute top-1.5 right-1.5 size-2 rounded-full" />
                    ) : null}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuGroup>{children}</DropdownMenuGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

function EntityActionItem({
    children,
    icon: Icon,
    destructive = false,
    disabled = false,
    shortcut = null,
    onSelect
}) {
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
            }}
        >
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
    const { t } = useTranslation();

    const [snapshot, setSnapshot] = useState(() =>
        typeof valueFactory === 'function' ? valueFactory() : value
    );
    const [refreshing, setRefreshing] = useState(false);

    useEffect(() => {
        setSnapshot(
            typeof valueFactory === 'function' ? valueFactory() : value
        );
    }, [value]);

    async function refreshJson() {
        setRefreshing(true);
        try {
            setSnapshot(
                typeof valueFactory === 'function' ? valueFactory() : value
            );
        } finally {
            setRefreshing(false);
        }
    }

    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-end">
                <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void refreshJson()}
                    disabled={refreshing}
                >
                    {refreshing ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <RefreshCwIcon data-icon="inline-start" />
                    )}
                    {t('common.actions.refresh')}
                </Button>
            </div>
            <pre className="bg-muted/20 max-h-[55vh] overflow-auto rounded-md border p-3 text-xs">
                {JSON.stringify(snapshot ?? null, null, 2)}
            </pre>
        </div>
    );
}

function EntityBlank({ children = '—' }) {
    return <div className="text-muted-foreground text-sm">{children}</div>;
}

function EntityInfoGrid({ children, className }) {
    return (
        <div
            className={cn('flex flex-wrap items-start gap-1 px-2.5', className)}
        >
            {children}
        </div>
    );
}

function EntityInfoBlock({
    label,
    value,
    mono = false,
    full = false,
    wide = false,
    onClick,
    children
}) {
    const Component = onClick ? 'button' : 'div';
    return (
        <Component
            type={onClick ? 'button' : undefined}
            onClick={onClick}
            className={cn(
                'group/info-item flex items-start rounded-lg px-2 py-1.5 text-left text-sm transition-colors outline-none [&>svg:not([class*=size-])]:size-3.5',
                full ? 'w-full' : wide ? 'w-80' : 'w-44',
                onClick
                    ? 'hover:bg-muted focus-visible:border-ring focus-visible:ring-ring/50 cursor-pointer focus-visible:ring-3'
                    : 'cursor-default'
            )}
        >
            <div className="min-w-0 flex-1 overflow-hidden">
                <span className="text-muted-foreground block truncate text-xs leading-snug">
                    {label}
                </span>
                {children || (
                    <span
                        className={cn(
                            'block truncate text-sm leading-snug font-medium',
                            mono ? 'font-mono text-xs font-normal' : ''
                        )}
                    >
                        {value || '—'}
                    </span>
                )}
            </div>
            {onClick ? (
                <ChevronRightIcon
                    data-icon="inline-end"
                    className="text-muted-foreground mt-0.5 ml-2 shrink-0 opacity-70 transition-transform group-hover/info-item:translate-x-0.5"
                />
            ) : null}
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
