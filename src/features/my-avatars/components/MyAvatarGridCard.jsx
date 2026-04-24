import {
    CheckIcon,
    EyeIcon,
    ImageIcon,
    PencilIcon,
    RefreshCwIcon,
    TagIcon,
    UserIcon
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { getAvailablePlatforms } from '@/lib/avatarPlatform.js';
import { cn } from '@/lib/utils.js';
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

import { resolveMyAvatarActionDisabled } from '../myAvatarsDisplay.js';

export function AvatarActionMenuItems({
    avatar,
    isActive,
    disabled,
    Item,
    Group,
    Separator,
    onAction
}) {
    const { t } = useTranslation();

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
                    {t('view.my_avatars.generated.view_details')}
                </Item>
                <Item
                    disabled={disabled || isActive}
                    onSelect={() => handleAction('wear')}
                >
                    <CheckIcon />
                    {t('view.my_avatars.generated.select_avatar')}
                </Item>
            </Group>
            <Separator />
            <Group>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('manageTags')}
                >
                    <TagIcon />
                    {t('view.my_avatars.generated.manage_tags')}
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
                        ? t('view.my_avatars.generated.make_private')
                        : t('view.my_avatars.generated.make_public')}
                </Item>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('rename')}
                >
                    <PencilIcon />
                    {t('view.my_avatars.generated.rename')}
                </Item>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('changeDescription')}
                >
                    <PencilIcon />
                    {t('view.my_avatars.generated.change_description')}
                </Item>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('changeTags')}
                >
                    <PencilIcon />
                    {t('view.my_avatars.generated.change_content_tags')}
                </Item>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('changeStyles')}
                >
                    <PencilIcon />
                    {t('view.my_avatars.generated.change_styles_author_tags')}
                </Item>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('changeImage')}
                >
                    <ImageIcon />
                    {t('view.my_avatars.generated.change_image')}
                </Item>
                <Item
                    disabled={disabled}
                    onSelect={() => handleAction('createImpostor')}
                >
                    <RefreshCwIcon />
                    {t('view.my_avatars.generated.create_impostor')}
                </Item>
            </Group>
        </>
    );
}

export function MyAvatarGridCard({
    avatar,
    currentAvatarId,
    cardScale,
    isUpdating,
    onAction
}) {
    const { t } = useTranslation();

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
                            {avatar?.name ||
                                t('view.my_avatars.generated.untitled_avatar')}
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
