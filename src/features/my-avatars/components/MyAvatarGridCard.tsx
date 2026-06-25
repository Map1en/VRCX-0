import {
    CheckCircle2Icon,
    CheckIcon,
    EyeIcon,
    ImageIcon,
    MoreHorizontalIcon,
    PencilIcon,
    PersonStandingIcon,
    RefreshCwIcon,
    TagIcon
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { getAvailablePlatforms } from '@/shared/utils/avatarPlatform';
import { useRuntimeStore } from '@/state/runtimeStore';
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
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    MY_AVATAR_TAG_BADGE_CLASS_NAME,
    resolveMyAvatarActionDisabled,
    resolveMyAvatarTagBadgeStyle
} from '../myAvatarsDisplay';
import type {
    MyAvatarAction,
    MyAvatarActionHandler,
    MyAvatarRow,
    MyAvatarTag,
    MyAvatarsGridDensityConfig
} from '../myAvatarsTypes';

type MenuComponent = ComponentType<any>;

type AvatarActionMenuItemsProps = {
    avatar: MyAvatarRow;
    isActive: boolean;
    disabled: boolean;
    Item: MenuComponent;
    Group: MenuComponent;
    Separator: MenuComponent;
    onAction: MyAvatarActionHandler;
};

export function AvatarActionMenuItems({
    avatar,
    isActive,
    disabled,
    Item,
    Group,
    Separator,
    onAction
}: AvatarActionMenuItemsProps) {
    const { t } = useTranslation();

    const releaseAction: MyAvatarAction =
        avatar?.releaseStatus === 'public' ? 'makePrivate' : 'makePublic';

    const stopMenuClick = (event: any) => {
        event.stopPropagation();
    };

    const handleAction = (action: MyAvatarAction) => {
        onAction(action, avatar);
    };

    const actionItemProps = (action: MyAvatarAction) => ({
        onClick: stopMenuClick,
        onSelect: (event: any) => {
            event.stopPropagation?.();
            handleAction(action);
        }
    });

    return (
        <>
            <Group>
                <Item {...actionItemProps('details')}>
                    <EyeIcon />
                    {t('common.actions.view_details')}
                </Item>
                <Item
                    disabled={disabled || isActive}
                    {...actionItemProps('wear')}
                >
                    <CheckIcon />
                    {t('dialog.avatar.actions.select')}
                </Item>
            </Group>
            <Separator />
            <Group>
                <Item disabled={disabled} {...actionItemProps('manageTags')}>
                    <TagIcon />
                    {t('dialog.avatar.actions.manage_tags')}
                </Item>
                <Item disabled={disabled} {...actionItemProps('editDetails')}>
                    <PencilIcon />
                    {t('dialog.avatar.actions.edit_details')}
                </Item>
                <Item
                    disabled={disabled}
                    {...actionItemProps('changeContentTags')}
                >
                    <TagIcon />
                    {t('dialog.avatar.actions.change_content_tags')}
                </Item>
                <Item disabled={disabled} {...actionItemProps('changeImage')}>
                    <ImageIcon />
                    {t('dialog.avatar.actions.change_image')}
                </Item>
            </Group>
            <Separator />
            <Group>
                <Item disabled={disabled} {...actionItemProps(releaseAction)}>
                    <PersonStandingIcon />
                    {avatar?.releaseStatus === 'public'
                        ? t('dialog.avatar.actions.make_private')
                        : t('dialog.avatar.actions.make_public')}
                </Item>
                <Item
                    disabled={disabled}
                    {...actionItemProps('createImpostor')}
                >
                    <RefreshCwIcon />
                    {t('dialog.avatar.actions.create_impostor')}
                </Item>
            </Group>
        </>
    );
}

function resolveMyAvatarGridTagBadgeStyle(entry: MyAvatarTag) {
    const style = resolveMyAvatarTagBadgeStyle(entry);
    const backgroundColor =
        typeof style.backgroundColor === 'string'
            ? style.backgroundColor.replace(/\/\s*[\d.]+\)$/, '/ 0.45)')
            : style.backgroundColor;

    return {
        ...style,
        backgroundColor
    };
}

export function MyAvatarGridCard({
    avatar,
    densityConfig,
    isUpdating,
    onAction
}: {
    avatar: MyAvatarRow;
    densityConfig: MyAvatarsGridDensityConfig;
    isUpdating: boolean;
    onAction: MyAvatarActionHandler;
}) {
    const { t } = useTranslation();
    const currentUserSnapshot = useRuntimeStore(
        (state: any) => state.auth.currentUserSnapshot
    );
    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';

    const isActive = avatar?.id === currentAvatarId;
    const platforms = getAvailablePlatforms(avatar?.unityPackages);
    const disabled = resolveMyAvatarActionDisabled(avatar, isUpdating);
    const canWear = !disabled && !isActive;
    const tags = avatar?.$tags || [];
    const visibleTags = tags.slice(0, 2);
    const hiddenTagCount = Math.max(0, tags.length - visibleTags.length);
    const platformDotClassName =
        'size-2.5 -ml-1 rounded-full border border-background/80 opacity-80 shadow-sm first:ml-0';
    const avatarName =
        avatar?.name || t('view.my_avatars.label.untitled_avatar');
    const overlayStyle: any = {
        padding: `${densityConfig.overlayNameOnlyPaddingTop}px ${densityConfig.overlayPaddingX}px ${densityConfig.overlayPaddingY}px`
    };
    const avatarNameStyle: any = {
        fontSize: `${densityConfig.nameFontSize}px`,
        lineHeight: densityConfig.nameLineHeight,
        textShadow: '0 1px 2px rgb(0 0 0 / 0.9), 0 0 10px rgb(0 0 0 / 0.65)'
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger asChild>
                <div className="group/card relative min-w-0">
                    <Button
                        type="button"
                        variant="outline"
                        className={cn(
                            'h-auto min-w-0 flex-col items-stretch overflow-hidden p-0 text-left font-normal whitespace-normal',
                            disabled && 'cursor-not-allowed opacity-60',
                            isActive && 'ring-primary ring-2'
                        )}
                        aria-disabled={!canWear}
                        tabIndex={disabled ? -1 : undefined}
                        onClick={() => {
                            if (!canWear) {
                                return;
                            }
                            onAction('wear', avatar);
                        }}
                    >
                        <div
                            className="bg-muted relative w-full overflow-hidden"
                            style={{
                                aspectRatio: `${1 / densityConfig.imageHeightRatio}`
                            }}
                        >
                            {avatar?.thumbnailImageUrl ? (
                                <img
                                    src={avatar.thumbnailImageUrl}
                                    alt={avatar?.name || 'Avatar'}
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                />
                            ) : (
                                <div className="text-muted-foreground grid h-full w-full place-items-center [&>svg]:size-6">
                                    <PersonStandingIcon />
                                </div>
                            )}
                            <div className="absolute top-1 left-1 flex max-w-[calc(100%-2rem)] flex-col items-start gap-1">
                                {isActive ? (
                                    <span className="bg-primary text-primary-foreground grid size-5 place-items-center rounded-full shadow-sm">
                                        <CheckCircle2Icon className="size-3.5" />
                                    </span>
                                ) : null}
                                {tags.length ? (
                                    <HoverCard openDelay={200} closeDelay={100}>
                                        <HoverCardTrigger asChild>
                                            <div
                                                className="flex max-w-full min-w-0 flex-nowrap gap-1 overflow-hidden"
                                                aria-label={t(
                                                    'dialog.avatar.info.tags'
                                                )}
                                            >
                                                {visibleTags.map(
                                                    (entry: any) => (
                                                        <Badge
                                                            key={`${avatar.id}:${entry.tag}`}
                                                            variant="secondary"
                                                            className={cn(
                                                                MY_AVATAR_TAG_BADGE_CLASS_NAME,
                                                                'max-w-16 min-w-0 shrink truncate shadow-sm'
                                                            )}
                                                            style={{
                                                                ...resolveMyAvatarGridTagBadgeStyle(
                                                                    entry
                                                                ),
                                                                fontSize: `${densityConfig.tagFontSize}px`
                                                            }}
                                                        >
                                                            {entry.tag}
                                                        </Badge>
                                                    )
                                                )}
                                                {hiddenTagCount ? (
                                                    <Badge
                                                        variant="outline"
                                                        className={cn(
                                                            MY_AVATAR_TAG_BADGE_CLASS_NAME,
                                                            'bg-background/80 text-foreground/90 shrink-0 shadow-sm backdrop-blur-[1px]'
                                                        )}
                                                        style={{
                                                            fontSize: `${densityConfig.tagFontSize}px`
                                                        }}
                                                    >
                                                        +{hiddenTagCount}
                                                    </Badge>
                                                ) : null}
                                            </div>
                                        </HoverCardTrigger>
                                        <HoverCardContent
                                            side="bottom"
                                            align="start"
                                            className="flex w-64 flex-wrap gap-1.5"
                                        >
                                            {tags.map((entry: any) => (
                                                <Badge
                                                    key={`${avatar.id}:hover:${entry.tag}`}
                                                    variant="secondary"
                                                    className={cn(
                                                        MY_AVATAR_TAG_BADGE_CLASS_NAME,
                                                        'max-w-full truncate'
                                                    )}
                                                    style={resolveMyAvatarGridTagBadgeStyle(
                                                        entry
                                                    )}
                                                >
                                                    {entry.tag}
                                                </Badge>
                                            ))}
                                        </HoverCardContent>
                                    </HoverCard>
                                ) : null}
                                {canWear && !tags.length ? (
                                    <div className="bg-background/85 text-foreground max-w-full -translate-y-1 rounded-sm px-1.5 py-0 text-xs font-medium opacity-0 shadow-sm backdrop-blur-[1px] transition-all group-focus-within/card:translate-y-0 group-focus-within/card:opacity-100 group-hover/card:translate-y-0 group-hover/card:opacity-100">
                                        {t(
                                            'view.my_avatars.label.click_to_wear'
                                        )}
                                    </div>
                                ) : null}
                            </div>
                            {platforms?.isQuest || platforms?.isIos ? (
                                <div className="absolute top-1 right-1 flex">
                                    {platforms?.isPC ? (
                                        <span
                                            className={cn(
                                                platformDotClassName,
                                                'bg-platform-pc'
                                            )}
                                        />
                                    ) : null}
                                    {platforms?.isQuest ? (
                                        <span
                                            className={cn(
                                                platformDotClassName,
                                                'bg-platform-quest'
                                            )}
                                        />
                                    ) : null}
                                    {platforms?.isIos ? (
                                        <span
                                            className={cn(
                                                platformDotClassName,
                                                'bg-platform-ios'
                                            )}
                                        />
                                    ) : null}
                                </div>
                            ) : null}
                            <div
                                className="absolute right-0 bottom-0 left-0 flex min-w-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent"
                                style={overlayStyle}
                            >
                                <span
                                    className="block truncate font-semibold text-white"
                                    style={avatarNameStyle}
                                >
                                    {avatarName}
                                </span>
                            </div>
                        </div>
                    </Button>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="secondary"
                                size="icon-xs"
                                className="absolute top-1 right-1 opacity-0 shadow-sm transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100 data-[state=open]:opacity-100"
                                aria-label={t(
                                    'view.my_avatars.action.open_avatar_actions'
                                )}
                                disabled={isUpdating}
                                onPointerDown={(event: any) =>
                                    event.stopPropagation()
                                }
                                onClick={(event: any) =>
                                    event.stopPropagation()
                                }
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
                </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-max max-w-[90vw] min-w-52">
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
