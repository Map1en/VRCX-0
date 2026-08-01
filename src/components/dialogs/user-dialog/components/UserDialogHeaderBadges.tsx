import {
    BadgeCheckIcon,
    EyeIcon,
    EyeOffIcon,
    ShieldCheckIcon
} from 'lucide-react';
import type { ComponentType, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
import type { UserBadgeRecord } from '@/domain/entities/profileEntities';
import { cn } from '@/lib/utils';
import { convertFileUrlToImageUrl } from '@/services/entityMediaService';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';
import { Separator } from '@/ui/shadcn/separator';
import { ToggleGroup, ToggleGroupItem } from '@/ui/shadcn/toggle-group';

import { formatStatsDate } from '../userDialogRows';
import type { UserDialogProfileRecord } from '../useUserDialogProfileResource';
import type {
    UserHeaderCommands,
    UserHeaderModel
} from './UserDialogHeaderSection';

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function resolveBadgeImageUrl(badge: UserBadgeRecord) {
    const imageUrl =
        [
            badge?.badgeImageUrl,
            badge?.imageUrl,
            badge?.iconUrl,
            badge?.image
        ].find(
            (value): value is string =>
                typeof value === 'string' && Boolean(value.trim())
        ) || '';
    return imageUrl ? convertFileUrlToImageUrl(imageUrl, 128) : '';
}

function resolveBadgeName(
    badge: UserBadgeRecord,
    profileTitle: string,
    profileId: string
) {
    return String(
        badge?.badgeName || badge?.name || profileTitle || profileId || ''
    );
}

function isRenderableBadge(badge: unknown): badge is UserBadgeRecord {
    return Boolean(
        isRecord(badge) &&
        (resolveBadgeImageUrl(badge) ||
            badge.badgeName ||
            badge.name ||
            badge.badgeId ||
            badge.id)
    );
}

export function hasRenderableUserProfileBadges(profile: unknown) {
    return (
        isRecord(profile) &&
        Array.isArray(profile.badges) &&
        profile.badges.some(isRenderableBadge)
    );
}

export function UserDialogHeaderFlags({
    profile,
    moderationState
}: {
    profile: UserDialogProfileRecord;
    moderationState: UserHeaderModel['moderationState'];
}) {
    const { t } = useTranslation();
    const customTag =
        typeof profile.$customTag === 'string' ? profile.$customTag : '';
    const customTagColour =
        typeof profile.$customTagColour === 'string'
            ? profile.$customTagColour
            : '';
    const hasFlags = Boolean(
        moderationState.block ||
        moderationState.mute ||
        profile.$isTroll ||
        profile.$isProbableTroll ||
        profile.$isModerator ||
        customTag
    );

    if (!hasFlags) {
        return null;
    }

    return (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            {moderationState.block ? (
                <Badge variant="destructive">
                    {t('dialog.user.error.blocked')}
                </Badge>
            ) : null}
            {moderationState.mute ? (
                <Badge variant="destructive">
                    {t('dialog.user.label.muted')}
                </Badge>
            ) : null}
            {profile.$isTroll ? (
                <Badge variant="destructive">
                    {t(
                        'view.settings.appearance.user_colors.trust_levels.nuisance'
                    )}
                </Badge>
            ) : null}
            {profile.$isProbableTroll ? (
                <Badge variant="outline">
                    {t('view.favorite.avatars.almost_nuisance')}
                </Badge>
            ) : null}
            {profile.$isModerator ? (
                <Badge variant="secondary">
                    <ShieldCheckIcon data-icon="inline-start" />
                    {t('dialog.user.label.moderator')}
                </Badge>
            ) : null}
            {customTag ? (
                <Badge
                    variant="outline"
                    style={
                        customTagColour
                            ? {
                                  color: customTagColour,
                                  borderColor: customTagColour
                              }
                            : undefined
                    }
                >
                    {customTag}
                </Badge>
            ) : null}
        </div>
    );
}

export function UserDialogHeaderAttributes({
    profile,
    friendNumber,
    platform,
    PlatformIcon
}: {
    profile: UserDialogProfileRecord;
    friendNumber?: number | string;
    platform: UserHeaderModel['platform'];
    PlatformIcon: ComponentType | null;
}) {
    const { t } = useTranslation();
    const trustLevel =
        typeof profile.$trustLevel === 'string'
            ? profile.$trustLevel
            : 'Visitor';
    const items: { key: string; node: ReactNode }[] = [
        {
            key: 'trust',
            node: <span className="min-w-0 truncate">{trustLevel}</span>
        }
    ];

    if (profile.ageVerified) {
        items.push({
            key: 'age-verified',
            node: (
                <span className="text-foreground inline-flex shrink-0 items-center gap-1 font-medium">
                    <BadgeCheckIcon
                        aria-hidden="true"
                        className="size-3.5 shrink-0"
                    />
                    18+
                </span>
            )
        });
    }

    items.push({
        key: 'platform',
        node: (
            <span className="inline-flex shrink-0 items-center gap-1 [&_svg]:size-3.5">
                {PlatformIcon ? <PlatformIcon /> : null}
                {platform.label}
            </span>
        )
    });

    if (friendNumber) {
        items.push({
            key: 'friend-number',
            node: (
                <span className="shrink-0">
                    {t('dialog.user.label.friend')}
                    {friendNumber}
                </span>
            )
        });
    }

    return (
        <>
            {items.map((item, index) => (
                <span
                    key={item.key}
                    className="inline-flex min-w-0 items-center"
                >
                    {item.node}
                    {index < items.length - 1 ? (
                        <span className="mx-1 opacity-50">·</span>
                    ) : null}
                </span>
            ))}
        </>
    );
}

export function UserDialogHeaderMediaBadges({
    profile,
    profileTitle,
    actionStatus,
    isCurrentUser,
    onOpenImagePreview,
    onToggleBadgeVisibility,
    onToggleBadgeShowcased
}: {
    profile: UserDialogProfileRecord;
    profileTitle: string;
    actionStatus: string;
    isCurrentUser: boolean;
    onOpenImagePreview?: (request: { url: string; title: string }) => void;
    onToggleBadgeVisibility?: UserHeaderCommands['onToggleBadgeVisibility'];
    onToggleBadgeShowcased?: UserHeaderCommands['onToggleBadgeShowcased'];
}) {
    const { t } = useTranslation();
    const hiddenLabel = t('dialog.user.badges.hidden');
    const visibleLabel = t('dialog.user.badges.visible');
    const visibilityLabel = t('dialog.user.badges.visibility');
    const assignedLabel = t('dialog.user.badges.assigned');

    if (!Array.isArray(profile.badges)) {
        return null;
    }

    return (
        <>
            {profile.badges.filter(isRenderableBadge).map((badge) => {
                const badgeImageUrl = resolveBadgeImageUrl(badge);
                const badgeName = resolveBadgeName(
                    badge,
                    profileTitle,
                    String(profile.id || '')
                );
                const isBadgeVisible =
                    Boolean(badge.showcased) && !badge.hidden;
                const badgeTitle = !isBadgeVisible
                    ? `${badgeName} (${hiddenLabel})`
                    : badgeName;
                const visibilityValue = isBadgeVisible ? 'visible' : 'hidden';
                const actionsDisabled = actionStatus !== 'idle';

                return (
                    <Popover
                        key={String(
                            badge.badgeId ||
                                badge.id ||
                                badge.badgeName ||
                                badgeImageUrl
                        )}
                    >
                        <PopoverTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size={badgeImageUrl ? 'icon' : 'sm'}
                                    aria-label={badgeTitle}
                                    title={badgeTitle}
                                    className={cn(
                                        'transition-transform duration-150 ease-out active:scale-[0.97] [@media(hover:hover)]:hover:scale-110',
                                        badgeImageUrl
                                            ? 'size-8 rounded-sm p-0'
                                            : 'h-8 max-w-full rounded-sm px-2 text-xs',
                                        !isBadgeVisible && 'opacity-60'
                                    )}
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    {badgeImageUrl ? (
                                        <FadeInImage
                                            src={badgeImageUrl}
                                            alt={badge.badgeName || ''}
                                            className={cn(
                                                'size-8 rounded-sm object-cover',
                                                !isBadgeVisible && 'grayscale'
                                            )}
                                        />
                                    ) : (
                                        <span className="max-w-32 truncate">
                                            {badgeName || badge.badgeId}
                                        </span>
                                    )}
                                </Button>
                            }
                        />
                        <PopoverContent
                            side="bottom"
                            className="w-80 gap-0 overflow-hidden p-0"
                        >
                            {badgeImageUrl ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="bg-muted/20 hover:bg-muted/30 h-auto w-full rounded-none p-3"
                                    onClick={() =>
                                        onOpenImagePreview?.({
                                            url: badgeImageUrl,
                                            title: badgeName
                                        })
                                    }
                                >
                                    <FadeInImage
                                        src={badgeImageUrl}
                                        alt={badge.badgeName || ''}
                                        className={cn(
                                            'max-h-52 w-full rounded-md object-contain',
                                            !isBadgeVisible && 'grayscale'
                                        )}
                                    />
                                </Button>
                            ) : (
                                <div className="bg-muted/20 flex min-h-24 items-center justify-center p-3">
                                    <Badge
                                        variant="outline"
                                        className="mx-auto max-w-full"
                                    >
                                        <span className="truncate">
                                            {badgeName || badge.badgeId}
                                        </span>
                                    </Badge>
                                </div>
                            )}
                            <div className="flex flex-col gap-3 p-3 text-sm">
                                <div className="flex min-w-0 items-start justify-between gap-3">
                                    <div className="flex min-w-0 flex-col gap-1">
                                        <div className="min-w-0 truncate font-medium">
                                            {badgeName}
                                        </div>
                                        {badge.badgeDescription ? (
                                            <div className="text-muted-foreground text-xs leading-relaxed">
                                                {badge.badgeDescription}
                                            </div>
                                        ) : null}
                                    </div>
                                    <Badge
                                        variant={
                                            isBadgeVisible
                                                ? 'outline'
                                                : 'secondary'
                                        }
                                        className="shrink-0"
                                    >
                                        {isBadgeVisible
                                            ? visibleLabel
                                            : hiddenLabel}
                                    </Badge>
                                </div>
                                {badge.assignedAt ? (
                                    <div className="text-muted-foreground flex min-w-0 items-center justify-between gap-2 text-xs">
                                        <span>{assignedLabel}</span>
                                        <span className="min-w-0 truncate text-right font-mono">
                                            {formatStatsDate(badge.assignedAt)}
                                        </span>
                                    </div>
                                ) : null}
                                {isCurrentUser ? (
                                    <>
                                        <Separator />
                                        <ToggleGroup
                                            variant="outline"
                                            size="sm"
                                            spacing={1}
                                            value={
                                                visibilityValue
                                                    ? [visibilityValue]
                                                    : []
                                            }
                                            aria-label={visibilityLabel}
                                            className="grid w-full grid-cols-2"
                                            onValueChange={(value) => {
                                                const nextValue =
                                                    value[0] ?? '';
                                                if (!nextValue) {
                                                    return;
                                                }

                                                if (
                                                    nextValue ===
                                                    visibilityValue
                                                ) {
                                                    return;
                                                }

                                                if (nextValue === 'visible') {
                                                    onToggleBadgeShowcased?.(
                                                        badge,
                                                        true
                                                    );
                                                    return;
                                                }

                                                onToggleBadgeVisibility?.(
                                                    badge,
                                                    true
                                                );
                                            }}
                                        >
                                            <ToggleGroupItem
                                                value="visible"
                                                aria-label={visibleLabel}
                                                disabled={
                                                    actionsDisabled ||
                                                    !onToggleBadgeShowcased
                                                }
                                                className="min-w-0 justify-center"
                                            >
                                                <EyeIcon data-icon="inline-start" />
                                                <span className="truncate">
                                                    {visibleLabel}
                                                </span>
                                            </ToggleGroupItem>
                                            <ToggleGroupItem
                                                value="hidden"
                                                aria-label={hiddenLabel}
                                                disabled={
                                                    actionsDisabled ||
                                                    !onToggleBadgeVisibility
                                                }
                                                className="min-w-0 justify-center"
                                            >
                                                <EyeOffIcon data-icon="inline-start" />
                                                <span className="truncate">
                                                    {hiddenLabel}
                                                </span>
                                            </ToggleGroupItem>
                                        </ToggleGroup>
                                    </>
                                ) : null}
                            </div>
                        </PopoverContent>
                    </Popover>
                );
            })}
        </>
    );
}
