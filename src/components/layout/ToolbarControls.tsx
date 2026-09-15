import type { LucideIcon } from 'lucide-react';
import {
    CalendarRangeIcon,
    ChevronDownIcon,
    EllipsisIcon,
    ListFilterIcon,
    RefreshCwIcon,
    SearchIcon,
    Settings2Icon,
    XIcon
} from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput
} from '@/ui/shadcn/input-group';
import { Spinner } from '@/ui/shadcn/spinner';
import { TabsList, TabsTrigger } from '@/ui/shadcn/tabs';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

type ToolbarSlotProps = {
    className?: string;
    children?: ReactNode;
};

export function ToolbarViews({ className, children }: ToolbarSlotProps) {
    return (
        <div className={cn('flex flex-auto items-center gap-2', className)}>
            {children}
        </div>
    );
}

export function ToolbarActions({ className, children }: ToolbarSlotProps) {
    return (
        <div className={cn('flex shrink-0 items-center gap-2', className)}>
            {children}
        </div>
    );
}

export function ToolbarStatus({ className, children }: ToolbarSlotProps) {
    return (
        <div className={cn('text-content-tertiary text-xs', className)}>
            {children}
        </div>
    );
}

export function ToolbarSearch({
    value,
    onValueChange,
    onClear,
    onCommit,
    commitOnBlur = true,
    disabled = false,
    autoFocus = false,
    placeholder,
    ariaLabel,
    trailing,
    className
}: {
    value: string;
    onValueChange: (value: string) => void;
    onClear?: () => void;
    onCommit?: () => void;
    commitOnBlur?: boolean;
    disabled?: boolean;
    autoFocus?: boolean;
    placeholder?: string;
    ariaLabel?: string;
    trailing?: ReactNode;
    className?: string;
}) {
    const { t } = useTranslation();
    const resolvedPlaceholder = placeholder ?? t('common.actions.search');

    return (
        <InputGroup
            data-vrcx-0-control="toolbar"
            className={cn(
                'vrcx-0-toolbar-control w-40 shrink-0 sm:w-64',
                className
            )}
        >
            <InputGroupAddon>
                <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
                value={value}
                placeholder={resolvedPlaceholder}
                aria-label={ariaLabel ?? resolvedPlaceholder}
                disabled={disabled}
                autoFocus={autoFocus}
                onChange={(event) => onValueChange(event.target.value)}
                onBlur={commitOnBlur ? onCommit : undefined}
                onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                        onCommit?.();
                    }
                }}
            />
            {value || trailing ? (
                <InputGroupAddon align="inline-end" className="gap-1 py-0">
                    {value ? (
                        <InputGroupButton
                            type="button"
                            size="icon-xs"
                            aria-label={t('common.actions.clear')}
                            disabled={disabled}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                                if (onClear) {
                                    onClear();
                                    return;
                                }
                                onValueChange('');
                            }}
                        >
                            <XIcon data-icon="icon" />
                        </InputGroupButton>
                    ) : null}
                    {trailing}
                </InputGroupAddon>
            ) : null}
        </InputGroup>
    );
}

export type ToolbarSegmentOption<TValue extends string> = {
    value: TValue;
    label: string;
    count?: number;
    icon?: LucideIcon;
};

export function ToolbarTabs<TValue extends string>({
    options
}: {
    options: readonly ToolbarSegmentOption<TValue>[];
}) {
    return (
        <TabsList className="max-w-full shrink-0 overflow-x-auto">
            {options.map((option) => {
                const Icon = option.icon;
                return (
                    <TabsTrigger key={option.value} value={option.value}>
                        {Icon ? <Icon data-icon="inline-start" /> : null}
                        {option.label}
                        {option.count === undefined ? null : (
                            <span className="text-content-tertiary text-[11px] leading-none font-medium tabular-nums">
                                {option.count}
                            </span>
                        )}
                    </TabsTrigger>
                );
            })}
        </TabsList>
    );
}

export function ToolbarSegmented<TValue extends string>({
    value,
    onValueChange,
    options,
    iconOnly = false
}: {
    value: TValue;
    onValueChange: (value: TValue) => void;
    options: readonly ToolbarSegmentOption<TValue>[];
    iconOnly?: boolean;
}) {
    return (
        <ToggleGroup
            variant="outline"
            value={value ? [value] : []}
            onValueChange={(next) => {
                const selected = options.find(
                    (option) => option.value === next[0]
                );
                if (selected) {
                    onValueChange(selected.value);
                }
            }}
            className="shrink-0"
        >
            {options.map((option, index) => {
                const Icon = option.icon;
                const item = (
                    <ToggleGroupItem
                        value={option.value}
                        aria-label={option.label}
                    >
                        {Icon ? <Icon data-icon="inline-start" /> : null}
                        {iconOnly ? null : option.label}
                        {option.count === undefined ? null : (
                            <span className="text-content-tertiary text-[11px] leading-none font-medium tabular-nums">
                                {option.count}
                            </span>
                        )}
                    </ToggleGroupItem>
                );

                return (
                    <Fragment key={option.value}>
                        {index > 0 ? <ToggleGroupSeparator /> : null}
                        {iconOnly ? (
                            <Tooltip>
                                <TooltipTrigger render={item} />
                                <TooltipContent>{option.label}</TooltipContent>
                            </Tooltip>
                        ) : (
                            item
                        )}
                    </Fragment>
                );
            })}
        </ToggleGroup>
    );
}

export function toolbarSearchDateRangeTrigger({
    active,
    label,
    rangeLabel
}: {
    active: boolean;
    label: string;
    rangeLabel: string;
}) {
    return (
        <TooltipTrigger
            render={
                <InputGroupButton
                    variant={active ? 'secondary' : 'ghost'}
                    size="icon-xs"
                    aria-label={active ? `${rangeLabel}: ${label}` : label}
                />
            }
        >
            <CalendarRangeIcon data-icon="icon" />
            <TooltipContent>{label}</TooltipContent>
        </TooltipTrigger>
    );
}

export function toolbarSearchScopeTrigger({
    active,
    icon: Icon,
    label
}: {
    active: boolean;
    icon: LucideIcon;
    label: string;
}) {
    return (
        <TooltipTrigger
            render={
                <InputGroupButton
                    variant={active ? 'secondary' : 'ghost'}
                    size="icon-xs"
                    aria-label={label}
                />
            }
        >
            <Icon data-icon="icon" />
            <TooltipContent>{label}</TooltipContent>
        </TooltipTrigger>
    );
}

const LEADING_CHIP_VALUE = '__leading__';

export type ToolbarFilterChipsLeading = {
    label: string;
    icon: LucideIcon;
    pressed: boolean;
    disabled?: boolean;
    onPressedChange: (pressed: boolean) => void;
};

export function ToolbarFilterChips<TValue extends string>({
    value,
    onValueChange,
    options,
    leading
}: {
    value: readonly TValue[];
    onValueChange: (value: TValue[]) => void;
    options: readonly { value: TValue; label: string }[];
    leading?: ToolbarFilterChipsLeading;
}) {
    const visibleOptions = options.filter((option) =>
        value.includes(option.value)
    );
    const leadingPressed = Boolean(leading?.pressed);
    const LeadingIcon = leading?.icon;

    if (!leadingPressed && !visibleOptions.length) {
        return null;
    }

    const pressed = leadingPressed
        ? [LEADING_CHIP_VALUE, ...value]
        : [...value];

    return (
        <ToggleGroup
            multiple
            variant="default"
            value={pressed}
            onValueChange={(next) => {
                if (leading && leadingPressed) {
                    if (!next.includes(LEADING_CHIP_VALUE)) {
                        leading.onPressedChange(false);
                        return;
                    }
                }
                const picked: TValue[] = [];
                for (const entry of next) {
                    const option = options.find(
                        (candidate) => candidate.value === entry
                    );
                    if (option) {
                        picked.push(option.value);
                    }
                }
                onValueChange(picked.length === options.length ? [] : picked);
            }}
            className="max-w-full shrink-0 overflow-x-auto"
        >
            {leadingPressed && leading && LeadingIcon ? (
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <ToggleGroupItem
                                value={LEADING_CHIP_VALUE}
                                aria-label={leading.label}
                                disabled={leading.disabled}
                            >
                                <LeadingIcon
                                    data-icon="icon"
                                    className="fill-current"
                                />
                            </ToggleGroupItem>
                        }
                    />
                    <TooltipContent>{leading.label}</TooltipContent>
                </Tooltip>
            ) : null}
            {visibleOptions.map((option) => (
                <ToggleGroupItem
                    key={option.value}
                    value={option.value}
                    aria-label={option.label}
                >
                    {option.label}
                </ToggleGroupItem>
            ))}
        </ToggleGroup>
    );
}

function ToolbarTooltipButton({
    icon: Icon,
    label,
    onClick,
    variant,
    disabled,
    loading = false,
    filled = false,
    pressed
}: {
    icon: LucideIcon;
    label: string;
    onClick: () => void;
    variant: 'ghost' | 'outline' | 'secondary';
    disabled: boolean;
    loading?: boolean;
    filled?: boolean;
    pressed?: boolean;
}) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <Button
                        type="button"
                        variant={variant}
                        size="icon"
                        aria-label={label}
                        aria-pressed={pressed}
                        data-vrcx-0-control="toolbar"
                        className={cn(
                            variant === 'ghost'
                                ? 'vrcx-0-quiet-control'
                                : 'vrcx-0-toolbar-control',
                            variant === 'secondary' &&
                                'vrcx-0-toolbar-control-active'
                        )}
                        disabled={disabled || loading}
                        onClick={onClick}
                    >
                        {loading ? (
                            <Spinner data-icon="icon" />
                        ) : (
                            <Icon
                                data-icon="icon"
                                className={cn(filled && 'fill-current')}
                            />
                        )}
                    </Button>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

export function ToolbarIconButton({
    icon,
    label,
    onClick,
    active = false,
    disabled = false,
    loading = false
}: {
    icon: LucideIcon;
    label: string;
    onClick: () => void;
    active?: boolean;
    disabled?: boolean;
    loading?: boolean;
}) {
    return (
        <ToolbarTooltipButton
            icon={icon}
            label={label}
            onClick={onClick}
            variant={active ? 'secondary' : 'ghost'}
            disabled={disabled}
            loading={loading}
        />
    );
}

export function ToolbarRefreshButton({
    onRefresh,
    loading = false,
    disabled = false,
    label
}: {
    onRefresh: () => void;
    loading?: boolean;
    disabled?: boolean;
    label?: string;
}) {
    const { t } = useTranslation();

    return (
        <ToolbarIconButton
            icon={RefreshCwIcon}
            label={label ?? t('common.actions.refresh')}
            loading={loading}
            disabled={disabled}
            onClick={onRefresh}
        />
    );
}

function ToolbarMenu({
    icon: Icon,
    label,
    children,
    contentClassName
}: {
    icon: LucideIcon;
    label: string;
    children: ReactNode;
    contentClassName?: string;
}) {
    return (
        <DropdownMenu>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <DropdownMenuTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={label}
                                    data-vrcx-0-control="toolbar"
                                    className="vrcx-0-quiet-control"
                                >
                                    <Icon data-icon="icon" />
                                </Button>
                            }
                        />
                    }
                />
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
            <DropdownMenuContent
                align="end"
                className={cn(
                    'max-h-96 w-64 overflow-y-auto',
                    contentClassName
                )}
            >
                {children}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function ToolbarViewMenu({
    children,
    contentClassName
}: {
    children: ReactNode;
    contentClassName?: string;
}) {
    const { t } = useTranslation();

    return (
        <ToolbarMenu
            icon={Settings2Icon}
            label={t('common.actions.view_options')}
            contentClassName={cn('w-72', contentClassName)}
        >
            {children}
        </ToolbarMenu>
    );
}

export function ToolbarOverflowMenu({
    children,
    contentClassName
}: {
    children: ReactNode;
    contentClassName?: string;
}) {
    const { t } = useTranslation();

    return (
        <ToolbarMenu
            icon={EllipsisIcon}
            label={t('accessibility.more')}
            contentClassName={cn('w-56', contentClassName)}
        >
            {children}
        </ToolbarMenu>
    );
}

export function toolbarFilterTrigger({ label }: { label: string }) {
    return (
        <Button
            type="button"
            variant="outline"
            aria-label={label}
            data-vrcx-0-control="toolbar"
            className="vrcx-0-toolbar-control max-w-56 min-w-40 shrink-0 justify-between"
        >
            <ListFilterIcon
                data-icon="inline-start"
                className="text-content-tertiary"
            />
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
            <ChevronDownIcon
                data-icon="inline-end"
                className="text-content-tertiary"
            />
        </Button>
    );
}

export function ToolbarFilterMenu({
    activeCount,
    children,
    contentClassName
}: {
    activeCount: number;
    children: ReactNode;
    contentClassName?: string;
}) {
    const { t } = useTranslation();
    const label = activeCount
        ? t('common.filter.label_count', { count: activeCount })
        : t('common.filter.label');

    return (
        <DropdownMenu>
            <DropdownMenuTrigger render={toolbarFilterTrigger({ label })} />
            <DropdownMenuContent
                align="start"
                className={cn(
                    'max-h-96 w-64 overflow-y-auto',
                    contentClassName
                )}
            >
                {children}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
