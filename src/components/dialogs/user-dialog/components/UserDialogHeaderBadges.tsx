// @ts-nocheck
import { ShieldCheckIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { cn } from '@/lib/utils.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';

import { formatStatsDate } from '../userDialogRows.js';

function resolveBadgeImageUrl(badge) {
    const imageUrl =
        [
            badge?.badgeImageUrl,
            badge?.imageUrl,
            badge?.iconUrl,
            badge?.image
        ].find((value) => typeof value === 'string' && value.trim()) || '';
    return imageUrl ? convertFileUrlToImageUrl(imageUrl, 128) : '';
}

function resolveBadgeName(badge, profileTitle, profileId) {
    return String(
        badge?.badgeName || badge?.name || profileTitle || profileId || ''
    );
}

function isRenderableBadge(badge) {
    return Boolean(
        badge &&
            typeof badge === 'object' &&
            (resolveBadgeImageUrl(badge) ||
                badge.badgeName ||
                badge.name ||
                badge.badgeId ||
                badge.id)
    );
}

export function hasRenderableUserProfileBadges(profile) {
    return (
        Array.isArray(profile?.badges) && profile.badges.some(isRenderableBadge)
    );
}

export function UserDialogHeaderBadges({
    profile,
    moderationState,
    friendNumber,
    platform,
    PlatformIcon,
    onOpenDiscordProfile
}) {
    const { t } = useTranslation();

    return (
        <>
            {profile.$isModerator ? (
                <Badge variant="secondary">
                    <ShieldCheckIcon data-icon="inline-start" />
                    {t('dialog.user.label.moderator')}
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
            {profile.$customTag ? (
                <Badge
                    variant="outline"
                    style={
                        profile.$customTagColour
                            ? {
                                  color: profile.$customTagColour,
                                  borderColor: profile.$customTagColour
                              }
                            : undefined
                    }
                >
                    {profile.$customTag}
                </Badge>
            ) : null}
            {profile.ageVerified ? <Badge variant="outline">18+</Badge> : null}
            {friendNumber ? (
                <Badge variant="outline">
                    {t('dialog.user.label.friend')}
                    {friendNumber}
                </Badge>
            ) : null}
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
            <Badge variant="outline">{profile.$trustLevel || 'Visitor'}</Badge>
            <Badge variant="outline">
                {PlatformIcon ? (
                    <PlatformIcon data-icon="inline-start" />
                ) : null}
                {platform.label}
            </Badge>
            {profile.discordId ? (
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="h-5 rounded-4xl px-2 py-0.5 text-xs"
                    aria-label={t('dialog.user.tags.open_in_discord')}
                    title={t('dialog.user.tags.open_in_discord')}
                    onClick={() => onOpenDiscordProfile(profile.discordId)}
                >
                    {t('dialog.user.tags.discord')}
                </Button>
            ) : null}
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
}) {
    const { t } = useTranslation();
    const hiddenLabel = t('dialog.user.badges.hidden');
    const showcasedLabel = t('dialog.user.badges.showcased');
    const assignedLabel = t('dialog.user.badges.assigned');

    if (!Array.isArray(profile.badges)) {
        return null;
    }

    return (
        <>
            {profile.badges
                .filter(isRenderableBadge)
                .map((badge) => {
                    const badgeImageUrl = resolveBadgeImageUrl(badge);
                    const badgeName = resolveBadgeName(
                        badge,
                        profileTitle,
                        profile.id
                    );
                    const badgeTitle = badge.hidden
                        ? `${badgeName} (${hiddenLabel})`
                        : badgeName;

                    return (
                        <Popover
                            key={
                                badge.badgeId ||
                                badge.id ||
                                badge.badgeName ||
                                badgeImageUrl
                            }
                        >
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size={badgeImageUrl ? 'icon' : 'sm'}
                                    aria-label={badgeTitle}
                                    title={badgeTitle}
                                    className={
                                        badgeImageUrl
                                            ? 'size-8 rounded-sm p-0'
                                            : 'h-8 max-w-full rounded-sm px-2 text-xs'
                                    }
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    {badgeImageUrl ? (
                                        <img
                                            src={badgeImageUrl}
                                            alt={badge.badgeName || ''}
                                            className={cn(
                                                'size-8 rounded-sm object-cover',
                                                badge.hidden && 'grayscale'
                                            )}
                                        />
                                    ) : (
                                        <span className="max-w-32 truncate">
                                            {badgeName || badge.badgeId}
                                        </span>
                                    )}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent
                                side="bottom"
                                className="flex w-72 flex-col gap-3"
                            >
                                <Button
                                    type="button"
                                    variant="ghost"
                                    className="h-auto w-full p-0"
                                    onClick={() =>
                                        badgeImageUrl &&
                                        onOpenImagePreview({
                                            url: badgeImageUrl,
                                            title: badgeName
                                        })
                                    }
                                >
                                    {badgeImageUrl ? (
                                        <img
                                            src={badgeImageUrl}
                                            alt={badge.badgeName || ''}
                                            className="max-h-56 w-full rounded-md object-contain"
                                        />
                                    ) : (
                                        <Badge
                                            variant="outline"
                                            className="mx-auto max-w-full"
                                        >
                                            <span className="truncate">
                                                {badgeName || badge.badgeId}
                                            </span>
                                        </Badge>
                                    )}
                                </Button>
                                <div className="flex flex-col gap-1 text-sm">
                                    <div className="font-medium">
                                        {badgeName}
                                        {badge.hidden ? (
                                            <span className="text-muted-foreground ml-1 text-xs">
                                                ({hiddenLabel})
                                            </span>
                                        ) : null}
                                    </div>
                                    {badge.badgeDescription ? (
                                        <div className="text-muted-foreground text-xs">
                                            {badge.badgeDescription}
                                        </div>
                                    ) : null}
                                    {badge.assignedAt ? (
                                        <div className="text-muted-foreground font-mono text-xs">
                                            {assignedLabel}{' '}
                                            {formatStatsDate(badge.assignedAt)}
                                        </div>
                                    ) : null}
                                </div>
                                {isCurrentUser ? (
                                    <FieldGroup
                                        data-slot="checkbox-group"
                                        className="border-t pt-3 text-sm"
                                    >
                                        <Field orientation="horizontal">
                                            <Checkbox
                                                checked={Boolean(badge.hidden)}
                                                disabled={
                                                    actionStatus !== 'idle' ||
                                                    !onToggleBadgeVisibility
                                                }
                                                aria-label={hiddenLabel}
                                                onCheckedChange={(checked) =>
                                                    onToggleBadgeVisibility?.(
                                                        badge,
                                                        Boolean(checked)
                                                    )
                                                }
                                            />
                                            <FieldLabel>
                                                {hiddenLabel}
                                            </FieldLabel>
                                        </Field>
                                        <Field orientation="horizontal">
                                            <Checkbox
                                                checked={Boolean(
                                                    badge.showcased
                                                )}
                                                disabled={
                                                    actionStatus !== 'idle' ||
                                                    !onToggleBadgeShowcased
                                                }
                                                aria-label={showcasedLabel}
                                                onCheckedChange={(checked) =>
                                                    onToggleBadgeShowcased?.(
                                                        badge,
                                                        Boolean(checked)
                                                    )
                                                }
                                            />
                                            <FieldLabel>
                                                {showcasedLabel}
                                            </FieldLabel>
                                        </Field>
                                    </FieldGroup>
                                ) : null}
                            </PopoverContent>
                        </Popover>
                    );
                })}
        </>
    );
}
