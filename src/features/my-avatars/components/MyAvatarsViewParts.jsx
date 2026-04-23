import {
    ArrowDownIcon,
    ArrowUpDownIcon,
    ArrowUpIcon,
    CheckIcon,
    EyeIcon,
    ImageIcon,
    ListFilterIcon,
    MonitorIcon,
    MoreHorizontalIcon,
    PencilIcon,
    RefreshCwIcon,
    SettingsIcon,
    SmartphoneIcon,
    TagIcon,
    UserIcon
} from 'lucide-react';

import { EmptyState } from '@/components/layout/PageScaffold.jsx';
import { getAvailablePlatforms } from '@/lib/avatarPlatform.js';
import { cn } from '@/lib/utils.js';
import { configRepository } from '@/repositories/index.js';
import { openAvatarDialog } from '@/services/dialogService.js';
import { appI18n } from '@/services/i18nService.js';
import { getTagColor } from '@/shared/constants/tags.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
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
import { Slider } from '@/ui/shadcn/slider';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    resolveMyAvatarActionDisabled
} from '../myAvatarsDisplay.js';
import { toggleMyAvatarsTagFilter } from '../myAvatarsFilters.js';
import {
    MY_AVATARS_PLATFORM_OPTIONS,
    MY_AVATARS_RELEASE_STATUS_OPTIONS,
    sanitizeMyAvatarsCardScale,
    sanitizeMyAvatarsCardSpacing
} from '../myAvatarsState.js';

export function SortButton({ column, label, descFirst = false }) {
    const direction = column.getIsSorted();

    return (
        <Button
            type="button"
            variant="ghost"
            className="text-muted-foreground hover:text-primary h-auto gap-1 p-0 text-left text-xs tracking-wide uppercase"
            onClick={() => {
                if (!direction && descFirst) {
                    column.toggleSorting(true);
                    return;
                }
                column.toggleSorting(direction === 'asc');
            }}
        >
            <span>{label}</span>
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
                    <SmartphoneIcon className="size-3.5" />
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

export function AvatarActionMenuItems({
    avatar,
    isActive,
    disabled,
    Item,
    Group,
    Separator,
    onAction
}) {
    const releaseAction =
        avatar?.releaseStatus === 'public' ? 'makePrivate' : 'makePublic';

    const handleAction = (action) => {
        onAction(action, avatar);
    };

    return (
        <>
            <Group>
                <Item onSelect={() => handleAction('details')}>
                    <EyeIcon />
                    {appI18n.t('view.my_avatars.generated.view_details')}
                </Item>
                <Item
                    disabled={disabled || isActive}
                    onSelect={() => handleAction('wear')}
                >
                    <CheckIcon />
                    {appI18n.t('view.my_avatars.generated.select_avatar')}
                </Item>
            </Group>
            <Separator />
            <Group>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('manageTags')}
                >
                    <TagIcon />
                    {appI18n.t('view.my_avatars.generated.manage_tags')}
                </Item>
            </Group>
            <Separator />
            <Group>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction(releaseAction)}
                >
                    <UserIcon />
                    {avatar?.releaseStatus === 'public'
                        ? 'Make private'
                        : 'Make public'}
                </Item>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('rename')}
                >
                    <PencilIcon />
                    {appI18n.t('view.my_avatars.generated.rename')}
                </Item>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('changeDescription')}
                >
                    <PencilIcon />
                    {appI18n.t('view.my_avatars.generated.change_description')}
                </Item>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('changeTags')}
                >
                    <PencilIcon />
                    {appI18n.t('view.my_avatars.generated.change_content_tags')}
                </Item>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('changeStyles')}
                >
                    <PencilIcon />
                    {appI18n.t('view.my_avatars.generated.change_styles_author_tags')}
                </Item>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('changeImage')}
                >
                    <ImageIcon />
                    {appI18n.t('view.my_avatars.generated.change_image')}
                </Item>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('createImpostor')}
                >
                    <RefreshCwIcon />
                    {appI18n.t('view.my_avatars.generated.create_impostor')}
                </Item>
            </Group>
        </>
    );
}

export function AvatarActionsDropdown({
    avatar,
    isActive,
    isUpdating,
    onAction
}) {
    const disabled = resolveMyAvatarActionDisabled(avatar, isUpdating);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Open avatar actions"
                    disabled={isUpdating}
                    onClick={(event) => event.stopPropagation()}
                >
                    {isUpdating ? (
                        <Spinner data-icon="inline-start" />
                    ) : (
                        <MoreHorizontalIcon data-icon="inline-start" />
                    )}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
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
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                    <ListFilterIcon data-icon="inline-start" />
                    {appI18n.t('view.my_avatars.generated.filter')}
                    {activeFilterCount ? (
                        <Badge variant="secondary">{activeFilterCount}</Badge>
                    ) : null}
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 p-3">
                <div className="flex flex-col gap-3">
                    <div className="flex flex-col gap-1.5">
                        <div className="text-muted-foreground text-xs font-medium">
                            {appI18n.t('view.my_avatars.generated.visibility')}
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {MY_AVATARS_RELEASE_STATUS_OPTIONS.map((option) => (
                                <Button
                                    key={option}
                                    type="button"
                                    size="sm"
                                    variant={
                                        releaseStatusFilter === option
                                            ? 'default'
                                            : 'outline'
                                    }
                                    onClick={() =>
                                        onReleaseStatusChange(option)
                                    }
                                >
                                    {option === 'all'
                                        ? 'All'
                                        : option === 'public'
                                          ? 'Public'
                                          : 'Private'}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <div className="text-muted-foreground text-xs font-medium">
                            {appI18n.t('view.my_avatars.generated.platform')}
                        </div>
                        <div className="flex flex-wrap gap-1">
                            {MY_AVATARS_PLATFORM_OPTIONS.map((option) => (
                                <Button
                                    key={option}
                                    type="button"
                                    size="sm"
                                    variant={
                                        platformFilter === option
                                            ? 'default'
                                            : 'outline'
                                    }
                                    onClick={() => onPlatformChange(option)}
                                >
                                    {option === 'all'
                                        ? 'All'
                                        : option === 'pc'
                                          ? 'PC'
                                          : option === 'android'
                                            ? 'Android'
                                            : 'iOS'}
                                </Button>
                            ))}
                        </div>
                    </div>
                    {allTags.length ? (
                        <div className="flex flex-col gap-1.5">
                            <div className="text-muted-foreground text-xs font-medium">
                                {appI18n.t('dialog.avatar.info.tags')}
                            </div>
                            <div className="flex max-h-40 flex-wrap gap-1 overflow-y-auto">
                                {allTags.map((tag) => {
                                    const color = getTagColor(tag);
                                    return (
                                        <Badge
                                            key={tag}
                                            variant={
                                                tagFilters.has(tag)
                                                    ? 'default'
                                                    : 'outline'
                                            }
                                            className="cursor-pointer select-none"
                                            style={
                                                tagFilters.has(tag)
                                                    ? {
                                                          backgroundColor:
                                                              color.bg,
                                                          color: color.text
                                                      }
                                                    : {
                                                          borderColor: color.bg,
                                                          color: color.text
                                                      }
                                            }
                                            onClick={() =>
                                                onTagFiltersChange((current) =>
                                                    toggleMyAvatarsTagFilter(
                                                        current,
                                                        tag
                                                    )
                                                )
                                            }
                                        >
                                            {tag}
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
                            {appI18n.t('view.my_avatars.generated.clear_filters')}
                        </Button>
                    ) : null}
                </div>
            </PopoverContent>
        </Popover>
    );
}

export function GridSettingsMenu({
    cardScale,
    cardSpacing,
    onCardScaleChange,
    onCardSpacingChange
}) {
    const cardScalePercent = Math.round(cardScale * 100);
    const cardSpacingPercent = Math.round(cardSpacing * 100);

    const updateCardScale = (value) => {
        const nextValue = sanitizeMyAvatarsCardScale(value);
        onCardScaleChange(nextValue);
        return nextValue;
    };

    const commitCardScale = (value) => {
        const nextValue = updateCardScale(value);
        void configRepository.setString(
            'VRCX_MyAvatarsCardScale',
            String(nextValue)
        );
    };

    const updateCardSpacing = (value) => {
        const nextValue = sanitizeMyAvatarsCardSpacing(value);
        onCardSpacingChange(nextValue);
        return nextValue;
    };

    const commitCardSpacing = (value) => {
        const nextValue = updateCardSpacing(value);
        void configRepository.setString(
            'VRCX_MyAvatarsCardSpacing',
            String(nextValue)
        );
    };

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Grid settings"
                >
                    <SettingsIcon data-icon="inline-start" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-60 p-3" align="end">
                <FieldGroup>
                    <Field>
                        <div className="flex items-center justify-between text-sm font-medium">
                            <FieldLabel>
                                {appI18n.t('view.friends_locations.scale')}
                            </FieldLabel>
                            <span className="text-xs">{cardScalePercent}%</span>
                        </div>
                        <Slider
                            value={[cardScale]}
                            min={0.4}
                            max={1.4}
                            step={0.05}
                            aria-label="Avatar card scale"
                            onValueChange={(value) => updateCardScale(value[0])}
                            onValueCommit={(value) => commitCardScale(value[0])}
                        />
                    </Field>
                    <Field>
                        <div className="flex items-center justify-between text-sm font-medium">
                            <FieldLabel>
                                {appI18n.t('view.friends_locations.spacing')}
                            </FieldLabel>
                            <span className="text-xs">
                                {cardSpacingPercent}%
                            </span>
                        </div>
                        <Slider
                            value={[cardSpacing]}
                            min={0.6}
                            max={2}
                            step={0.05}
                            aria-label="Avatar card spacing"
                            onValueChange={(value) =>
                                updateCardSpacing(value[0])
                            }
                            onValueCommit={(value) =>
                                commitCardSpacing(value[0])
                            }
                        />
                    </Field>
                </FieldGroup>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}

export function MyAvatarGridCard({
    avatar,
    currentAvatarId,
    cardScale,
    isUpdating,
    onAction
}) {
    const isActive = avatar?.id === currentAvatarId;
    const platforms = getAvailablePlatforms(avatar?.unityPackages);
    const disabled = resolveMyAvatarActionDisabled(avatar, isUpdating);

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    className={cn(
                        'h-auto min-w-0 flex-col items-stretch overflow-hidden p-0 text-left font-normal whitespace-normal',
                        disabled && 'cursor-not-allowed opacity-60',
                        isActive && 'ring-primary ring-2'
                    )}
                    aria-disabled={disabled}
                    tabIndex={disabled ? -1 : undefined}
                    onClick={() => {
                        if (disabled) {
                            return;
                        }
                        onAction('wear', avatar);
                    }}
                >
                    <div className="bg-muted relative aspect-[5/2] w-full overflow-hidden">
                        {avatar?.thumbnailImageUrl ? (
                            <img
                                src={avatar.thumbnailImageUrl}
                                alt={avatar?.name || 'Avatar'}
                                className="h-full w-full object-cover"
                                loading="lazy"
                            />
                        ) : (
                            <div className="text-muted-foreground grid h-full w-full place-items-center [&>svg]:size-6">
                                <ImageIcon />
                            </div>
                        )}
                        {platforms?.isQuest || platforms?.isIos ? (
                            <div className="absolute top-1 right-1 flex gap-0.5">
                                {platforms?.isPC ? (
                                    <span className="bg-muted-foreground/70 size-2.5 rounded-full border" />
                                ) : null}
                                {platforms?.isQuest ? (
                                    <span className="bg-muted-foreground/50 size-2.5 rounded-full border" />
                                ) : null}
                                {platforms?.isIos ? (
                                    <span className="bg-muted-foreground/30 size-2.5 rounded-full border" />
                                ) : null}
                            </div>
                        ) : null}
                    </div>
                    <div
                        className="flex min-h-0 flex-col gap-0.5"
                        style={{
                            padding: `${Math.round(6 * cardScale)}px ${Math.round(8 * cardScale)}px`
                        }}
                    >
                        <span
                            className="line-clamp-2 block min-h-[2.75em] overflow-hidden leading-snug"
                            style={{
                                fontSize: `${Math.max(9, Math.round(18 * cardScale))}px`
                            }}
                        >
                            {avatar?.name || 'Untitled avatar'}
                        </span>
                        {(avatar?.$tags || []).length ? (
                            <div
                                className="flex flex-nowrap gap-0.5 overflow-hidden"
                                style={{
                                    maxHeight: `${Math.max(14, Math.round(22 * cardScale))}px`
                                }}
                            >
                                {avatar.$tags.map((entry) => {
                                    const color = getTagColor(entry.tag);
                                    return (
                                        <Badge
                                            key={`${avatar.id}:${entry.tag}`}
                                            variant="outline"
                                            className="shrink-0 rounded-sm px-1 py-0 leading-tight"
                                            style={{
                                                fontSize: `${Math.max(8, Math.round(14 * cardScale))}px`,
                                                borderColor: color.bg,
                                                color: color.text
                                            }}
                                        >
                                            {entry.tag}
                                        </Badge>
                                    );
                                })}
                            </div>
                        ) : null}
                    </div>
                </Button>
            </ContextMenuTrigger>
            <ContextMenuContent>
                <AvatarActionMenuItems
                    avatar={avatar}
                    isActive={isActive}
                    disabled={disabled}
                    Item={ContextMenuItem}
                    Group={ContextMenuGroup}
                    Separator={ContextMenuSeparator}
                    onAction={onAction}
                />
            </ContextMenuContent>
        </ContextMenu>
    );
}
