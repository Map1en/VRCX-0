import {
    CheckIcon,
    EyeIcon,
    GlobeIcon,
    ImageIcon,
    LockIcon,
    MoreHorizontalIcon,
    PencilIcon,
    PersonStandingIcon,
    ScanFaceIcon,
    ShieldCheckIcon,
    TagsIcon
} from 'lucide-react';
import type { CSSProperties, ElementType, MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { AvatarPlatformDots } from '@/components/avatars/AvatarPlatformDots';
import { FadeInImage } from '@/components/media/FadeInImage';
import { TileShell } from '@/components/tile/TileShell';
import { cn } from '@/lib/utils';
import { TILE_CHECK } from '@/shared/constants/selectableTile';
import { useRuntimeStore } from '@/state/runtimeStore';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import {
    ContextMenu,
    ContextMenuContent,
    ContextMenuGroup,
    ContextMenuItem,
    ContextMenuLabel,
    ContextMenuSeparator,
    ContextMenuTrigger
} from '@/ui/shadcn/context-menu';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
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

type MenuComponent = ElementType;

type AvatarActionMenuItemsProps = {
    avatar: MyAvatarRow;
    isActive: boolean;
    disabled: boolean;
    Item: MenuComponent;
    Group: MenuComponent;
    Label: MenuComponent;
    Separator: MenuComponent;
    onAction: MyAvatarActionHandler;
};

export function AvatarActionMenuItems({
    avatar,
    isActive,
    disabled,
    Item,
    Group,
    Label,
    Separator,
    onAction
}: AvatarActionMenuItemsProps) {
    const { t } = useTranslation();

    const isPublic = avatar?.releaseStatus === 'public';
    const releaseAction: MyAvatarAction = isPublic
        ? 'makePrivate'
        : 'makePublic';
    const ReleaseIcon = isPublic ? LockIcon : GlobeIcon;

    const handleAction = (action: MyAvatarAction) => {
        onAction(action, avatar);
    };

    const actionItemProps = (action: MyAvatarAction) => ({
        onClick: (event: MouseEvent) => {
            event.stopPropagation();
            handleAction(action);
        }
    });

    return (
        <>
            <Group>
                <Label className="max-w-64 truncate">
                    {avatar?.name ||
                        avatar?.id ||
                        t('view.my_avatars.label.untitled_avatar')}
                </Label>
            </Group>
            <Separator />
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
            {avatar.$licensed ? null : (
                <>
                    <Separator />
                    <Group>
                        <Item
                            disabled={disabled}
                            {...actionItemProps('manageTags')}
                        >
                            <TagsIcon />
                            {t('dialog.avatar.actions.manage_tags')}
                        </Item>
                        <Item
                            disabled={disabled}
                            {...actionItemProps('editDetails')}
                        >
                            <PencilIcon />
                            {t('dialog.avatar.actions.edit_details')}
                        </Item>
                        <Item
                            disabled={disabled}
                            {...actionItemProps('changeContentTags')}
                        >
                            <ShieldCheckIcon />
                            {t('dialog.avatar.actions.change_content_tags')}
                        </Item>
                        <Item
                            disabled={disabled}
                            {...actionItemProps('changeImage')}
                        >
                            <ImageIcon />
                            {t('dialog.avatar.actions.change_image')}
                        </Item>
                    </Group>
                    <Separator />
                    <Group>
                        <Item
                            disabled={disabled}
                            {...actionItemProps(releaseAction)}
                        >
                            <ReleaseIcon />
                            {isPublic
                                ? t('dialog.avatar.actions.make_private')
                                : t('dialog.avatar.actions.make_public')}
                        </Item>
                        <Item
                            disabled={disabled}
                            {...actionItemProps('createImpostor')}
                        >
                            <ScanFaceIcon />
                            {t('dialog.avatar.actions.create_impostor')}
                        </Item>
                    </Group>
                </>
            )}
        </>
    );
}

function resolveMyAvatarGridTagBadgeStyle(entry: MyAvatarTag) {
    const { backgroundColor, ...style } = resolveMyAvatarTagBadgeStyle(entry);
    const tint =
        typeof backgroundColor === 'string'
            ? backgroundColor.replace(/\/\s*[\d.]+\)$/, '/ 0.45)')
            : 'transparent';

    return {
        ...style,
        background: `linear-gradient(${tint}, ${tint}), color-mix(in oklch, var(--background) 82%, transparent)`
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
        (state) => state.auth.currentUserSnapshot
    );
    const currentAvatarId = currentUserSnapshot?.currentAvatar || '';

    const isActive = avatar?.id === currentAvatarId;
    const disabled = resolveMyAvatarActionDisabled(avatar, isUpdating);
    const canWear = !disabled && !isActive;
    const tags: MyAvatarTag[] = avatar?.$tags || [];
    const visibleTags = tags.slice(0, 2);
    const hiddenTagCount = Math.max(0, tags.length - visibleTags.length);
    const avatarName =
        avatar?.name || t('view.my_avatars.label.untitled_avatar');
    const avatarActionsLabel = t('view.my_avatars.action.open_avatar_actions');
    const overlayStyle: CSSProperties = {
        padding: `${densityConfig.overlayNameOnlyPaddingTop}px ${densityConfig.overlayPaddingX}px ${densityConfig.overlayPaddingY}px`
    };
    const avatarNameStyle: CSSProperties = {
        fontSize: `${densityConfig.nameFontSize}px`,
        lineHeight: densityConfig.nameLineHeight,
        textShadow: '0 1px 2px rgb(0 0 0 / 0.9), 0 0 10px rgb(0 0 0 / 0.65)'
    };

    return (
        <ContextMenu>
            <ContextMenuTrigger
                render={
                    <div className="group/card relative h-full min-w-0">
                        <TileShell
                            selected={isActive}
                            className={cn(
                                'h-full w-full flex-col items-stretch p-0 text-left font-normal whitespace-normal',
                                disabled && 'cursor-not-allowed opacity-60'
                            )}
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    aria-disabled={!canWear}
                                    tabIndex={disabled ? -1 : undefined}
                                    onClick={() => {
                                        if (!canWear) {
                                            return;
                                        }
                                        onAction('wear', avatar);
                                    }}
                                />
                            }
                        >
                            <div className="bg-muted relative size-full overflow-hidden">
                                {avatar?.thumbnailImageUrl ? (
                                    <FadeInImage
                                        src={avatar.thumbnailImageUrl}
                                        alt={avatar?.name || 'Avatar'}
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                        fallback={
                                            <div className="text-muted-foreground grid h-full w-full place-items-center [&>svg]:size-6">
                                                <PersonStandingIcon />
                                            </div>
                                        }
                                    />
                                ) : (
                                    <div className="text-muted-foreground grid h-full w-full place-items-center [&>svg]:size-6">
                                        <PersonStandingIcon />
                                    </div>
                                )}
                                <div className="absolute top-1 left-1 flex max-w-[calc(100%-2rem)] flex-col items-start gap-1">
                                    {isActive ? (
                                        <span className={TILE_CHECK}>
                                            <CheckIcon className="size-3" />
                                        </span>
                                    ) : null}
                                    {tags.length ? (
                                        <HoverCard>
                                            <HoverCardTrigger
                                                delay={200}
                                                closeDelay={100}
                                                render={
                                                    <div
                                                        className="flex max-w-full min-w-0 flex-nowrap gap-1 overflow-hidden"
                                                        aria-label={t(
                                                            'dialog.avatar.info.tags'
                                                        )}
                                                    >
                                                        {visibleTags.map(
                                                            (entry) => (
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
                                                                    'bg-background/80 text-foreground/90 shrink-0 shadow-sm'
                                                                )}
                                                                style={{
                                                                    fontSize: `${densityConfig.tagFontSize}px`
                                                                }}
                                                            >
                                                                +
                                                                {hiddenTagCount}
                                                            </Badge>
                                                        ) : null}
                                                    </div>
                                                }
                                            />
                                            <HoverCardContent
                                                side="bottom"
                                                align="start"
                                                className="flex w-64 flex-wrap gap-1.5"
                                            >
                                                {tags.map((entry) => (
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
                                        <div className="bg-background/85 text-foreground max-w-full -translate-y-1 rounded-sm px-1.5 py-0 text-xs font-medium opacity-0 shadow-sm transition-[opacity,transform] ease-out group-focus-within/card:translate-y-0 group-focus-within/card:opacity-100 group-hover/card:translate-y-0 group-hover/card:opacity-100 motion-reduce:translate-y-0 motion-reduce:transition-opacity">
                                            {t(
                                                'view.my_avatars.label.click_to_wear'
                                            )}
                                        </div>
                                    ) : null}
                                </div>
                                <AvatarPlatformDots
                                    unityPackages={avatar?.unityPackages}
                                    className="absolute top-1 right-1"
                                />
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
                        </TileShell>
                        <DropdownMenu>
                            <HintTooltip label={avatarActionsLabel}>
                                <DropdownMenuTrigger
                                    render={
                                        <Button
                                            type="button"
                                            variant="secondary"
                                            size="icon-xs"
                                            className="absolute top-1 right-1 opacity-0 shadow-sm transition-opacity group-focus-within/card:opacity-100 group-hover/card:opacity-100 data-popup-open:opacity-100"
                                            disabled={isUpdating}
                                            onPointerDown={(event) =>
                                                event.stopPropagation()
                                            }
                                            onClick={(event) =>
                                                event.stopPropagation()
                                            }
                                        >
                                            {isUpdating ? (
                                                <Spinner data-icon="inline-start" />
                                            ) : (
                                                <MoreHorizontalIcon data-icon="inline-start" />
                                            )}
                                        </Button>
                                    }
                                />
                            </HintTooltip>
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
                    </div>
                }
            />
            <ContextMenuContent className="bg-popover! w-max max-w-[90vw] min-w-52">
                <AvatarActionMenuItems
                    avatar={avatar}
                    isActive={isActive}
                    disabled={disabled}
                    Item={ContextMenuItem}
                    Group={ContextMenuGroup}
                    Label={ContextMenuLabel}
                    Separator={ContextMenuSeparator}
                    onAction={onAction}
                />
            </ContextMenuContent>
        </ContextMenu>
    );
}
