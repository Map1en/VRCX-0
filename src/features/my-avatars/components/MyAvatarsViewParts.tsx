// @ts-nocheck
import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    ListFilterIcon,
    MonitorIcon,
    MoreHorizontalIcon,
    RectangleGogglesIcon,
    SettingsIcon,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '@/components/layout/PageScaffold';
import { getAvailablePlatforms } from '@/lib/avatarPlatform.js';
import { cn } from '@/lib/utils.js';
import { openAvatarDialog } from '@/services/dialogService.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Spinner } from '@/ui/shadcn/spinner';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

import {
    MY_AVATAR_TAG_BADGE_CLASS_NAME,
    resolveMyAvatarActionDisabled,
    resolveMyAvatarTagBadgeStyle
} from '../myAvatarsDisplay.js';
import { toggleMyAvatarsTagFilter } from '../myAvatarsFilters.js';
import {
    MY_AVATARS_GRID_DENSITY_OPTIONS,
    MY_AVATARS_PLATFORM_OPTIONS,
    MY_AVATARS_RELEASE_STATUS_OPTIONS
} from '../myAvatarsState.js';
import {
    AvatarActionMenuItems,
    MyAvatarGridCard
} from './MyAvatarGridCard';

export { AvatarActionMenuItems, MyAvatarGridCard };

export function SortButton({ column, label, descFirst = false }) {
    const direction = column.getIsSorted();

    return (
        <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground hover:text-primary h-auto max-w-full min-w-0 gap-1 p-0 text-left text-xs tracking-wide uppercase"
            onClick={() => {
                if (!direction && descFirst) {
                    column.toggleSorting(true);
                    return;
                }
                column.toggleSorting(direction === 'asc');
            }}
        >
            <span className="truncate">{label}</span>
            {direction === 'asc' ? (
                <ArrowUpIcon data-icon="inline-end" />
            ) : direction === 'desc' ? (
                <ArrowDownIcon data-icon="inline-end" />
            ) : (
                <ArrowUpDownIcon data-icon="inline-end" />
            )}
        </Button>
    );
}

export function PlatformBadges({ unityPackages }) {
    const platforms = getAvailablePlatforms(unityPackages);

    return (
        <div className="flex items-center gap-1">
            {platforms?.isPC ? (
                <Badge variant="outline">
                    <MonitorIcon className="size-3.5" />
                </Badge>
            ) : null}
            {platforms?.isQuest ? (
                <Badge variant="outline">
                    <RectangleGogglesIcon className="size-3.5" />
                </Badge>
            ) : null}
            {platforms?.isIos ? <Badge variant="outline">iOS</Badge> : null}
        </div>
    );
}

export function MyAvatarsEmptyState({ title, description }) {
    return <EmptyState title={title} description={description} />;
}

export function openAvatarDetails(avatar) {
    const avatarId =
        typeof avatar?.id === 'string'
            ? avatar.id.trim()
            : String(avatar?.id ?? '').trim();
    if (!avatarId) {
        return;
    }

    openAvatarDialog({
        avatarId,
        title: avatar?.name || undefined,
        seedData: avatar ?? null
    });
}

export function AvatarActionsDropdown({
    avatar,
    isActive,
    isUpdating,
    onAction
}) {
    const { t } = useTranslation();

    const disabled = resolveMyAvatarActionDisabled(avatar, isUpdating);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t(
                        'view.my_avatars.action.open_avatar_actions'
                    )}
                    disabled={isUpdating}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                >
                    {isUpdating ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <MoreHorizontalIcon data-icon="inline-start" />
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
                align="end"
                className="w-max max-w-[90vw] min-w-52"
            >
                <AvatarActionMenuItems
                    avatar={avatar}
                    isActive={isActive}
                    disabled={disabled}
                    Item={DropdownMenuItem}
                    Group={DropdownMenuGroup}
                    Separator={DropdownMenuSeparator}
                    onAction={onAction}
                />
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function MyAvatarFilterPopover({
    activeFilterCount,
    allTags,
    releaseStatusFilter,
    platformFilter,
    tagFilters,
    onReleaseStatusChange,
    onPlatformChange,
    onTagFiltersChange,
    onClearFilters
}) {
    const { t } = useTranslation();
    const visibilityFilterLabel = (option) =>
        option === 'all'
            ? t('view.search.avatar.all')
            : option === 'public'
              ? t('view.search.avatar.public')
              : t('view.search.avatar.private');
    const platformFilterLabel = (option) =>
        option === 'all'
            ? t('view.search.avatar.all')
            : option === 'pc'
              ? 'PC'
              : option === 'android'
                ? 'Android'
                : 'iOS';

    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                    <ListFilterIcon data-icon="inline-start" />
                    {t('view.my_avatars.filter')}
                    {activeFilterCount ? (
                        <Badge variant="secondary">{activeFilterCount}</Badge>
                    ) : null}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-3">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <div className="text-muted-foreground text-xs font-medium">
                            {t('view.my_avatars.label.visibility')}
                        </div>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            size="sm"
                            spacing={1}
                            value={releaseStatusFilter}
                            onValueChange={(nextValue) => {
                                if (nextValue) {
                                    onReleaseStatusChange(nextValue);
                                }
                            }}
                            className="grid w-full grid-cols-3"
                        >
                            {MY_AVATARS_RELEASE_STATUS_OPTIONS.map((option) => (
                                <ToggleGroupItem
                                    key={option}
                                    value={option}
                                    aria-label={visibilityFilterLabel(option)}
                                    className="w-full min-w-0 justify-center px-2"
                                >
                                    <span className="truncate">
                                        {visibilityFilterLabel(option)}
                                    </span>
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <div className="text-muted-foreground text-xs font-medium">
                            {t('view.my_avatars.label.platform')}
                        </div>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            size="sm"
                            spacing={1}
                            value={platformFilter}
                            onValueChange={(nextValue) => {
                                if (nextValue) {
                                    onPlatformChange(nextValue);
                                }
                            }}
                            className="grid w-full grid-cols-4"
                        >
                            {MY_AVATARS_PLATFORM_OPTIONS.map((option) => {
                                const label = platformFilterLabel(option);
                                return (
                                    <ToggleGroupItem
                                        key={option}
                                        value={option}
                                        aria-label={label}
                                        className="w-full min-w-0 justify-center px-2"
                                    >
                                        <span className="truncate">
                                            {label}
                                        </span>
                                    </ToggleGroupItem>
                                );
                            })}
                        </ToggleGroup>
                    </div>
                    {allTags.length ? (
                        <div className="flex flex-col gap-1.5">
                            <div className="text-muted-foreground text-xs font-medium">
                                {t('dialog.avatar.info.tags')}
                            </div>
                            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                                {allTags.map((tag) => {
                                    const selected = tagFilters.has(tag);
                                    return (
                                        <Badge
                                            key={tag}
                                            asChild
                                            variant="secondary"
                                            className={cn(
                                                MY_AVATAR_TAG_BADGE_CLASS_NAME,
                                                'cursor-pointer select-none',
                                                selected
                                                    ? 'border-ring'
                                                    : 'border-transparent opacity-80 hover:opacity-100'
                                            )}
                                            style={resolveMyAvatarTagBadgeStyle(
                                                { tag }
                                            )}
                                        >
                                            <button
                                                type="button"
                                                aria-pressed={selected}
                                                onClick={() =>
                                                    onTagFiltersChange(
                                                        (current) =>
                                                            toggleMyAvatarsTagFilter(
                                                                current,
                                                                tag
                                                            )
                                                    )
                                                }
                                            >
                                                {tag}
                                            </button>
                                        </Badge>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}
                    {activeFilterCount ? (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onClearFilters}
                        >
                            {t('view.my_avatars.action.clear_filters')}
                        </Button>
                    ) : null}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export function GridSettingsMenu({ gridDensity, onGridDensityChange }) {
    const { t } = useTranslation();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t('view.my_avatars.label.grid_settings')}
                >
                    <SettingsIcon data-icon="inline-start" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-72 p-3" align="end">
                <FieldGroup>
                    <Field>
                        <FieldLabel>
                            {t('view.my_avatars.label.grid_density')}
                        </FieldLabel>
                        <ToggleGroup
                            type="single"
                            variant="outline"
                            size="sm"
                            spacing={1}
                            value={gridDensity}
                            onValueChange={(nextValue) => {
                                if (nextValue) {
                                    onGridDensityChange(nextValue);
                                }
                            }}
                            className="grid w-full grid-cols-3"
                        >
                            {MY_AVATARS_GRID_DENSITY_OPTIONS.map((option) => (
                                <ToggleGroupItem
                                    key={option.value}
                                    value={option.value}
                                    aria-label={t(option.labelKey)}
                                    className="w-full min-w-0 justify-center px-2"
                                >
                                    <span className="truncate">
                                        {t(option.labelKey)}
                                    </span>
                                </ToggleGroupItem>
                            ))}
                        </ToggleGroup>
                    </Field>
                </FieldGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
