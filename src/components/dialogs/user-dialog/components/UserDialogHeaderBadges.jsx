import { ShieldCheckIcon } from 'lucide-react';

import { cn } from '@/lib/utils.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';

import { formatStatsDate } from '../userDialogRows.js';

export function UserDialogHeaderBadges({
    profile,
    moderationState,
    friendNumber,
    mutualFriendCount,
    platform,
    PlatformIcon,
    onOpenDiscordProfile,
    t
}) {
    return (
        <>
            {profile.$isModerator ? (
                <Badge variant="secondary">
                    <ShieldCheckIcon data-icon="inline-start" />
                    {t('dialog.user.generated.moderator')}
                </Badge>
            ) : null}
            {profile.$isTroll ? (
                <Badge variant="destructive">
                    {t('view.settings.appearance.user_colors.trust_levels.nuisance')}
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
                    {t('dialog.user.generated.friend')}
                    {friendNumber}
                </Badge>
            ) : null}
            {mutualFriendCount ? (
                <Badge variant="outline">
                    {mutualFriendCount} {t('dialog.user.generated.mutual')}
                </Badge>
            ) : null}
            {moderationState.block ? (
                <Badge variant="destructive">
                    {t('dialog.user.generated.blocked')}
                </Badge>
            ) : null}
            {moderationState.mute ? (
                <Badge variant="destructive">
                    {t('dialog.user.generated.muted')}
                </Badge>
            ) : null}
            <Badge variant="outline">{profile.$trustLevel || 'Visitor'}</Badge>
            <Badge variant="outline">
                {PlatformIcon ? <PlatformIcon data-icon="inline-start" /> : null}
                {platform.label}
            </Badge>
            {profile.discordId ? (
                <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    className="h-5 rounded-4xl px-2 py-0.5 text-xs"
                    title={t('dialog.user.tags.open_in_discord')}
                    aria-label={t('dialog.user.tags.open_in_discord')}
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
    onToggleBadgeShowcased,
    t
}) {
    const hiddenLabel = t('dialog.user.badges.hidden');
    const showcasedLabel = t('dialog.user.badges.showcased');
    const assignedLabel = t('dialog.user.badges.assigned');

    if (!Array.isArray(profile.badges)) {
        return null;
    }

    return (
        <>
            {profile.badges
                .filter((badge) => badge?.badgeImageUrl)
                .map((badge) => {
                    const badgeName =
                        badge.badgeName || profileTitle || profile.id || '';
                    const badgeTitle = badge.hidden
                        ? `${badgeName} (${hiddenLabel})`
                        : badgeName;

                    return (
                        <Popover
                            key={
                                badge.badgeId ||
                                badge.id ||
                                badge.badgeName
                            }
                        >
                            <PopoverTrigger asChild>
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    title={badgeTitle}
                                    aria-label={badgeTitle}
                                    className="size-8 rounded-sm p-0"
                                    onClick={(event) => event.stopPropagation()}
                                >
                                    <img
                                        src={badge.badgeImageUrl}
                                        alt={badge.badgeName || ''}
                                        className={cn(
                                            'size-8 rounded-sm object-cover',
                                            badge.hidden && 'grayscale'
                                        )}
                                    />
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
                                        badge.badgeImageUrl &&
                                        onOpenImagePreview({
                                            url: badge.badgeImageUrl,
                                            title: badgeName
                                        })
                                    }
                                >
                                    <img
                                        src={badge.badgeImageUrl}
                                        alt={badge.badgeName || ''}
                                        className="max-h-56 w-full rounded-md object-contain"
                                    />
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
