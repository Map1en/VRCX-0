import {
    Globe2Icon,
    LockIcon,
    MonitorIcon,
    MoreHorizontalIcon,
    PersonStandingIcon,
    RectangleGogglesIcon,
    SmartphoneIcon
} from 'lucide-react';
import { Fragment } from 'react';
import type {
    ComponentProps,
    Dispatch,
    ReactNode,
    SetStateAction
} from 'react';
import { useTranslation } from 'react-i18next';

import { DataTableSortButton } from '@/components/data-table/DataTableSortButton';
import { EmptyState } from '@/components/layout/PageScaffold';
import {
    toolbarFilterTrigger,
    ToolbarViewMenu
} from '@/components/layout/ToolbarControls';
import { FadeInImage } from '@/components/media/FadeInImage';
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
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger
} from '@/ui/shadcn/dropdown-menu';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Spinner } from '@/ui/shadcn/spinner';
import {
    ToggleGroup,
    ToggleGroupItem,
    ToggleGroupSeparator
} from '@/ui/shadcn/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import {
    MY_AVATAR_TAG_BADGE_CLASS_NAME,
    resolveMyAvatarActionDisabled,
    resolveMyAvatarTagBadgeStyle
} from '../myAvatarsDisplay';
import { toggleMyAvatarsTagFilter } from '../myAvatarsFilters';
import {
    isMyAvatarsGridDensity,
    isMyAvatarsPlatformFilter,
    isMyAvatarsReleaseStatusFilter,
    MY_AVATARS_GRID_DENSITY_OPTIONS,
    MY_AVATARS_PLATFORM_OPTIONS,
    MY_AVATARS_RELEASE_STATUS_OPTIONS
} from '../myAvatarsState';
import type {
    MyAvatarActionHandler,
    MyAvatarRow,
    MyAvatarsGridDensity,
    MyAvatarsPlatformFilter,
    MyAvatarsReleaseStatusFilter
} from '../myAvatarsTypes';
import { AvatarActionMenuItems, MyAvatarGridCard } from './MyAvatarGridCard';

export { AvatarActionMenuItems, MyAvatarGridCard };

export { DataTableSortButton as SortButton };

type PlatformBadgesProps = {
    unityPackages?: MyAvatarRow['unityPackages'];
};

type PlatformBadgeProps = {
    children: ReactNode;
    label: string;
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
    releaseStatusFilter: MyAvatarsReleaseStatusFilter;
    platformFilter: MyAvatarsPlatformFilter;
    tagFilters: Set<string>;
    onReleaseStatusChange: (value: MyAvatarsReleaseStatusFilter) => void;
    onPlatformChange: (value: MyAvatarsPlatformFilter) => void;
    onTagFiltersChange: Dispatch<SetStateAction<Set<string>>>;
    onClearFilters: () => void;
};

type GridSettingsMenuProps = {
    gridDensity: MyAvatarsGridDensity;
    onGridDensityChange: (value: MyAvatarsGridDensity) => void;
};

function PlatformBadge({ children, label }: PlatformBadgeProps) {
    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <span
                        aria-label={label}
                        className="text-content-primary inline-flex items-center"
                    >
                        {children}
                    </span>
                }
            />
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    );
}

export function PlatformBadges({ unityPackages }: PlatformBadgesProps) {
    const platforms = getAvailablePlatforms(unityPackages);

    return (
        <div className="flex items-center gap-2">
            {platforms?.isPC ? (
                <PlatformBadge label="PC">
                    <MonitorIcon aria-hidden="true" className="size-3.5" />
                </PlatformBadge>
            ) : null}
            {platforms?.isQuest ? (
                <PlatformBadge label="Android">
                    <RectangleGogglesIcon
                        aria-hidden="true"
                        className="size-3.5"
                    />
                </PlatformBadge>
            ) : null}
            {platforms?.isIos ? (
                <PlatformBadge label="iOS">
                    <SmartphoneIcon aria-hidden="true" className="size-3.5" />
                </PlatformBadge>
            ) : null}
        </div>
    );
}

export function AvatarVisibilityIndicator({
    isPublic,
    label
}: {
    isPublic: boolean;
    label: string;
}) {
    const Icon = isPublic ? Globe2Icon : LockIcon;
    return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
            <Icon
                aria-hidden="true"
                className={cn(
                    'size-3.5 shrink-0',
                    isPublic ? 'text-emerald-500' : 'text-muted-foreground'
                )}
            />
            <span className="text-foreground/80 min-w-0 truncate text-sm font-normal">
                {label}
            </span>
        </span>
    );
}

export function MyAvatarNameCell({
    avatar,
    isPublic,
    publicLabel
}: {
    avatar: MyAvatarRow;
    isPublic: boolean;
    publicLabel: string;
}) {
    const { t } = useTranslation();
    const name = avatar?.name || t('view.my_avatars.label.untitled_avatar');
    const thumbnailUrl = avatar?.thumbnailImageUrl || avatar?.imageUrl || '';

    return (
        <div className="flex min-w-0 items-center gap-1.5">
            <HoverCard>
                <HoverCardTrigger
                    delay={400}
                    closeDelay={100}
                    render={
                        <Button
                            type="button"
                            variant="ghost"
                            className="hover:text-primary h-auto min-w-0 p-0 text-left text-sm font-medium hover:bg-transparent"
                            onClick={() => openAvatarDetails(avatar)}
                        >
                            <span className="truncate">{name}</span>
                        </Button>
                    }
                />
                <HoverCardContent side="right" sideOffset={8} className="w-64">
                    <div className="bg-muted aspect-[4/3] w-full overflow-hidden rounded-md">
                        {thumbnailUrl ? (
                            <FadeInImage
                                src={thumbnailUrl}
                                alt=""
                                className="size-full object-cover"
                                loading="lazy"
                            />
                        ) : (
                            <div className="flex size-full items-center justify-center">
                                <PersonStandingIcon
                                    aria-hidden="true"
                                    className="text-muted-foreground size-6"
                                />
                            </div>
                        )}
                    </div>
                    <p className="mt-2 line-clamp-2 text-sm font-medium break-words">
                        {name}
                    </p>
                </HoverCardContent>
            </HoverCard>
            {isPublic ? (
                <Globe2Icon
                    aria-label={publicLabel}
                    className="size-3.5 shrink-0 text-emerald-500"
                />
            ) : null}
        </div>
    );
}

export function MyAvatarsEmptyState({
    title,
    description,
    ...props
}: ComponentProps<typeof EmptyState>) {
    return <EmptyState {...props} title={title} description={description} />;
}

export function openAvatarDetails(avatar: MyAvatarRow | null | undefined) {
    const avatarId = avatar?.id?.trim() ?? '';
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
                className="bg-popover! w-max max-w-[90vw] min-w-52"
            >
                <AvatarActionMenuItems
                    avatar={avatar}
                    isActive={isActive}
                    disabled={disabled}
                    Item={DropdownMenuItem}
                    Group={DropdownMenuGroup}
                    Label={DropdownMenuLabel}
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
    const visibilityFilterLabel = (option: MyAvatarsReleaseStatusFilter) =>
        option === 'all'
            ? t('view.search.avatar.all')
            : option === 'public'
              ? t('view.search.avatar.public')
              : t('view.search.avatar.private');
    const platformFilterLabel = (option: MyAvatarsPlatformFilter) =>
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
                render={toolbarFilterTrigger({
                    label: activeFilterCount
                        ? t('common.filter.label_count', {
                              count: activeFilterCount
                          })
                        : t('common.filter.label')
                })}
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
                            value={
                                releaseStatusFilter ? [releaseStatusFilter] : []
                            }
                            onValueChange={(nextValue) => {
                                const next = nextValue[0];
                                if (isMyAvatarsReleaseStatusFilter(next)) {
                                    onReleaseStatusChange(next);
                                }
                            }}
                            className="w-full [&>[data-slot=toggle]]:min-w-0 [&>[data-slot=toggle]]:flex-1"
                        >
                            {MY_AVATARS_RELEASE_STATUS_OPTIONS.map(
                                (option, index) => (
                                    <Fragment key={option}>
                                        {index > 0 ? (
                                            <ToggleGroupSeparator />
                                        ) : null}
                                        <ToggleGroupItem
                                            value={option}
                                            aria-label={visibilityFilterLabel(
                                                option
                                            )}
                                            className="w-full min-w-0 justify-center px-2"
                                        >
                                            <span className="truncate">
                                                {visibilityFilterLabel(option)}
                                            </span>
                                        </ToggleGroupItem>
                                    </Fragment>
                                )
                            )}
                        </ToggleGroup>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <div className="text-muted-foreground text-xs font-medium">
                            {t('view.my_avatars.label.platform')}
                        </div>
                        <ToggleGroup
                            variant="outline"
                            size="sm"
                            value={platformFilter ? [platformFilter] : []}
                            onValueChange={(nextValue) => {
                                const next = nextValue[0];
                                if (isMyAvatarsPlatformFilter(next)) {
                                    onPlatformChange(next);
                                }
                            }}
                            className="w-full [&>[data-slot=toggle]]:min-w-0 [&>[data-slot=toggle]]:flex-1"
                        >
                            {MY_AVATARS_PLATFORM_OPTIONS.map(
                                (option, index) => {
                                    const label = platformFilterLabel(option);
                                    return (
                                        <Fragment key={option}>
                                            {index > 0 ? (
                                                <ToggleGroupSeparator />
                                            ) : null}
                                            <ToggleGroupItem
                                                value={option}
                                                aria-label={label}
                                                className="w-full min-w-0 justify-center px-2"
                                            >
                                                <span className="truncate">
                                                    {label}
                                                </span>
                                            </ToggleGroupItem>
                                        </Fragment>
                                    );
                                }
                            )}
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
        <ToolbarViewMenu contentClassName="p-3">
            <FieldGroup>
                <Field>
                    <FieldLabel>
                        {t('view.my_avatars.label.grid_density')}
                    </FieldLabel>
                    <ToggleGroup
                        variant="outline"
                        size="sm"
                        value={gridDensity ? [gridDensity] : []}
                        onValueChange={(nextValue) => {
                            const next = nextValue[0];
                            if (next && isMyAvatarsGridDensity(next)) {
                                onGridDensityChange(next);
                            }
                        }}
                        className="w-full [&>[data-slot=toggle]]:min-w-0 [&>[data-slot=toggle]]:flex-1"
                    >
                        {MY_AVATARS_GRID_DENSITY_OPTIONS.map(
                            (option, index) => (
                                <Fragment key={option.value}>
                                    {index > 0 ? (
                                        <ToggleGroupSeparator />
                                    ) : null}
                                    <ToggleGroupItem
                                        value={option.value}
                                        aria-label={t(option.labelKey)}
                                        className="w-full min-w-0 justify-center px-2"
                                    >
                                        <span className="truncate">
                                            {t(option.labelKey)}
                                        </span>
                                    </ToggleGroupItem>
                                </Fragment>
                            )
                        )}
                    </ToggleGroup>
                </Field>
            </FieldGroup>
        </ToolbarViewMenu>
    );
}
