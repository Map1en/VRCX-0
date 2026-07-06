import {
    ListFilterIcon,
    MonitorIcon,
    MoreHorizontalIcon,
    RectangleGogglesIcon,
    SettingsIcon
} from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { EmptyState } from '@/components/layout/PageScaffold';
import { cn } from '@/lib/utils';
import { openAvatarDialog } from '@/services/dialogService';
import { getAvailablePlatforms } from '@/shared/utils/avatarPlatform';
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
} from '../myAvatarsDisplay';
import { toggleMyAvatarsTagFilter } from '../myAvatarsFilters';
import {
    MY_AVATARS_GRID_DENSITY_OPTIONS,
    MY_AVATARS_PLATFORM_OPTIONS,
    MY_AVATARS_RELEASE_STATUS_OPTIONS
} from '../myAvatarsState';
import type {
    MyAvatarActionHandler,
    MyAvatarRow,
    MyAvatarsGridDensity
} from '../myAvatarsTypes';
import { AvatarActionMenuItems, MyAvatarGridCard } from './MyAvatarGridCard';

export { AvatarActionMenuItems, MyAvatarGridCard };

export { DataTableSortButton as SortButton };

type PlatformBadgesProps = {
    unityPackages?: MyAvatarRow['unityPackages'];
};

type MyAvatarsEmptyStateProps = {
    title?: string;
    description?: string;
};

type AvatarActionsDropdownProps = {
    avatar: MyAvatarRow;
    isActive: boolean;
    isUpdating: boolean;
    onAction: MyAvatarActionHandler;
};

type MyAvatarFilterPopoverProps = {
    activeFilterCount: number;
    allTags: string[];
    releaseStatusFilter: string;
    platformFilter: string;
    tagFilters: Set<string>;
    onReleaseStatusChange: (value: string) => void;
    onPlatformChange: (value: string) => void;
    onTagFiltersChange: Dispatch<SetStateAction<Set<string>>>;
    onClearFilters: () => void;
};

type GridSettingsMenuProps = {
    gridDensity: MyAvatarsGridDensity;
    onGridDensityChange: (value: string) => void;
};

export function PlatformBadges({ unityPackages }: PlatformBadgesProps) {
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

export function MyAvatarsEmptyState({
    title,
    description
}: MyAvatarsEmptyStateProps) {
    return <EmptyState title={title} description={description} />;
}

export function openAvatarDetails(avatar: MyAvatarRow | null | undefined) {
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
}: AvatarActionsDropdownProps) {
    const { t } = useTranslation();

    const disabled = resolveMyAvatarActionDisabled(avatar, isUpdating);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
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
                }
            />
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
}: MyAvatarFilterPopoverProps) {
    const { t } = useTranslation();
    const visibilityFilterLabel = (option: string) =>
        option === 'all'
            ? t('view.search.avatar.all')
            : option === 'public'
              ? t('view.search.avatar.public')
              : t('view.search.avatar.private');
    const platformFilterLabel = (option: string) =>
        option === 'all'
            ? t('view.search.avatar.all')
            : option === 'pc'
              ? 'PC'
              : option === 'android'
                ? 'Android'
                : 'iOS';

    return (
        <Popover>
            <PopoverTrigger
                render={
                    <Button type="button" variant="outline" size="sm">
                        <ListFilterIcon data-icon="inline-start" />
                        {t('view.my_avatars.filter')}
                        {activeFilterCount ? (
                            <Badge variant="secondary">
                                {activeFilterCount}
                            </Badge>
                        ) : null}
                    </Button>
                }
            />
            <PopoverContent align="start" className="w-80 p-3">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <div className="text-muted-foreground text-xs font-medium">
                            {t('view.my_avatars.label.visibility')}
                        </div>
                        <ToggleGroup
                            variant="outline"
                            size="sm"
                            spacing={1}
                            value={
                                releaseStatusFilter ? [releaseStatusFilter] : []
                            }
                            onValueChange={(nextValue) => {
                                const next = nextValue[0];
                                if (next) {
                                    onReleaseStatusChange(next);
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
                            variant="outline"
                            size="sm"
                            spacing={1}
                            value={platformFilter ? [platformFilter] : []}
                            onValueChange={(nextValue) => {
                                const next = nextValue[0];
                                if (next) {
                                    onPlatformChange(next);
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
                                            render={
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
                                            }
                                        />
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

export function GridSettingsMenu({
    gridDensity,
    onGridDensityChange
}: GridSettingsMenuProps) {
    const { t } = useTranslation();

    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label={t('view.my_avatars.label.grid_settings')}
                    >
                        <SettingsIcon data-icon="inline-start" />
                    </Button>
                }
            />
            <DropdownMenuContent className="w-72 p-3" align="end">
                <FieldGroup>
                    <Field>
                        <FieldLabel>
                            {t('view.my_avatars.label.grid_density')}
                        </FieldLabel>
                        <ToggleGroup
                            variant="outline"
                            size="sm"
                            spacing={1}
                            value={gridDensity ? [gridDensity] : []}
                            onValueChange={(nextValue) => {
                                const next = nextValue[0];
                                if (next) {
                                    onGridDensityChange(next);
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
