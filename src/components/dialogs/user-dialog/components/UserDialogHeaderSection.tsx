import type { TFunction } from 'i18next';
import {
    ClockIcon,
    CopyIcon,
    ExternalLinkIcon,
    GemIcon,
    GlobeIcon,
    PencilIcon,
    ShieldCheckIcon,
    UserRoundIcon
} from 'lucide-react';
import {
    isValidElement,
    type ComponentType,
    type CSSProperties,
    type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';

import { UserStatusDot } from '@/components/UserStatusDot';
import type { UserBadgeRecord } from '@/domain/entities/profileEntities';
import { userFacingErrorMessage } from '@/lib/errorDisplay';
import { cn } from '@/lib/utils';
import { userImage } from '@/services/entityMediaService';
import { OWNER_USER_ID } from '@/shared/constants/user';
import { Button } from '@/ui/shadcn/button';
import { CardTitle } from '@/ui/shadcn/card';
import { Separator } from '@/ui/shadcn/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { EntityOverviewCard } from '../../EntityDialogScaffold';
import type {
    resolveFriendRequestState,
    resolvePlatformMeta
} from '../userDialogContentHelpers';
import {
    normalizeProfileAppearanceColor,
    resolveUserDialogBackgroundTextureUrl,
    resolveProfileDecorationAssetUrls,
    type UserDialogProfileAppearance
} from '../userDialogProfileAppearance';
import {
    formatStatsDuration,
    normalizePreviousDisplayNames
} from '../userDialogRows';
import { PreviousDisplayNamesBadge } from '../UserDialogViewParts';
import { languageDisplayName } from '../userProfileFields';
import type {
    AvatarOverrideState,
    ExtendedModerationState,
    ModerationState
} from '../useUserDialogModerationState';
import type { UserDialogProfileRecord } from '../useUserDialogProfileResource';
import type {
    AvatarOverrideType,
    ExtendedModerationType,
    ModerationType
} from '../useUserModerationActions';
import { UserDialogHeaderActions } from './UserDialogHeaderActions';
import {
    hasRenderableUserProfileBadges,
    UserDialogHeaderAttributes,
    UserDialogHeaderFlags,
    UserDialogHeaderMediaBadges
} from './UserDialogHeaderBadges';
import { UserDialogHeaderMedia } from './UserDialogHeaderMedia';
import { UserDialogProfileDecorationImage } from './UserDialogProfileDecorationImage';

function linearGradientStyle(
    angle: number,
    start: string,
    end: string
): CSSProperties | undefined {
    if (!start || !end) {
        return undefined;
    }
    return {
        backgroundImage: `linear-gradient(${angle}deg, ${start}, ${end})`
    };
}

function resolveProfileBackgroundStyle(
    profile: UserDialogProfileRecord
): CSSProperties | undefined {
    if (profile.backgroundType === 'gradient') {
        return linearGradientStyle(
            180,
            normalizeProfileAppearanceColor(profile.backgroundGradientTop),
            normalizeProfileAppearanceColor(profile.backgroundGradientBottom)
        );
    }
    if (profile.backgroundType === 'texture') {
        const url = resolveUserDialogBackgroundTextureUrl(profile);
        if (url) {
            const overlay = 'color-mix(in oklch, var(--card) 55%, transparent)';
            return {
                backgroundImage: `linear-gradient(${overlay}, ${overlay}), url("${url}")`,
                backgroundPosition: 'top center',
                backgroundRepeat: 'no-repeat',
                backgroundSize: 'cover'
            };
        }
    }
    return undefined;
}

export interface UserHeaderModel {
    actionStatus: string;
    avatarOverrideState: AvatarOverrideState;
    bannerFallbackUrl: string;
    canInviteFromCurrentLocation: boolean;
    currentAvatarTarget: string;
    currentUserBoopingEnabled: boolean;
    detail: string;
    extendedModerationState: ExtendedModerationState;
    fallbackAvatarTarget: string;
    estimatedOnlineDurationMs?: number;
    friendNumber?: number | string;
    friendRequestState: ReturnType<typeof resolveFriendRequestState>;
    imageUrl: string;
    isCurrentUser: boolean;
    isFriend: boolean;
    loadStatus: string;
    moderationState: ModerationState;
    platform: ReturnType<typeof resolvePlatformMeta>;
    PlatformIcon: ComponentType | null;
    previousDisplayNames: ReturnType<typeof normalizePreviousDisplayNames>;
    previousInstances: unknown[];
    profile: UserDialogProfileRecord;
    profileAppearance: UserDialogProfileAppearance;
    profileIconUrl: string;
    profileLanguages: { key: string; value: string }[];
    profileTitle: string;
    pronounsText?: string;
    recentDialogShortcut: (actionType: unknown) => ReactNode;
    statusDotClassName: string;
    statusStateText: string;
    username: string;
    userUrl: string;
}

export interface UserHeaderCommands {
    onAvatarOverride: (type: AvatarOverrideType) => void;
    onBoop: () => void;
    onCopyUserId: () => void;
    onCopyUsername?: () => void;
    onCopyUserUrl: () => void;
    onEditMemo: () => void;
    onEditSelfProfileDetails: () => void;
    onEditSelfProfileMedia: () => void;
    onEditSelfProfileDecorations: () => void;
    onEditSelfStatus: () => void;
    onExtendedModeration: (
        type: ExtendedModerationType,
        enabled: boolean
    ) => void;
    onFriendRequest: (action: string) => void;
    onGroupModeration: () => void;
    onImageClick: () => void;
    onInvite: () => void;
    onInviteMessage: () => void;
    onInviteRequest: () => void;
    onInviteRequestMessage: () => void;
    onInviteToGroup: () => void;
    onModeration: (type: ModerationType, enabled: boolean) => void;
    onOpenDiscordProfile: (discordId: unknown) => void | Promise<void>;
    onOpenFallbackAvatar: () => void;
    onOpenImagePreview: (options?: Record<string, unknown>) => void;
    onOpenUserIcon: () => void;
    onOpenUserUrl: () => void;
    onRefresh: () => void;
    onReportHacking: () => void;
    onShowAvatarAuthor: () => void;
    onShowInstanceHistory: () => void;
    onTitleClick?: () => void;
    onToggleBadgeShowcased: (
        badge: UserBadgeRecord,
        showcased: boolean
    ) => void;
    onToggleBadgeVisibility: (badge: UserBadgeRecord, hidden: boolean) => void;
    onToggleSelfAvatarCopying: () => void;
    onToggleSelfBooping: () => void;
    onToggleSelfDiscordConnections: () => void;
    onToggleSelfSharedConnections: () => void;
    onUnfriend: () => void;
}

function preferenceLabel(value: boolean, t: TFunction) {
    return value
        ? t('dialog.user.info.avatar_cloning_allow')
        : t('dialog.user.info.avatar_cloning_deny');
}

function HeaderRowIcon({
    icon,
    className
}: {
    icon: ReactNode;
    className?: string;
}) {
    return (
        <span
            className={cn(
                'flex size-4 shrink-0 items-center justify-center opacity-70 [&_svg]:size-3.5',
                className
            )}
        >
            {icon}
        </span>
    );
}

function HeaderMetaRow({
    icon,
    children
}: {
    icon: ReactNode;
    children: ReactNode;
}) {
    return (
        <div className="flex min-w-0 items-center gap-2">
            <HeaderRowIcon icon={icon} />
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5">
                {children}
            </div>
        </div>
    );
}

function HeaderFactRow({
    label,
    value,
    children
}: {
    label: ReactNode;
    value?: ReactNode;
    children?: ReactNode;
}) {
    return (
        <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="text-muted-foreground min-w-0 truncate">
                {label}
            </span>
            {children || (
                <span className="text-muted-foreground/80 min-w-0 truncate text-right">
                    {value || '\u2014'}
                </span>
            )}
        </div>
    );
}

function HeaderFactValue({
    display,
    title,
    children
}: {
    display: ReactNode;
    title?: string;
    children?: ReactNode;
}) {
    return (
        <span className="flex min-w-0 items-center justify-end gap-1">
            <span
                className="text-muted-foreground/80 min-w-0 truncate font-mono text-[11px]"
                title={title}
            >
                {display}
            </span>
            {children}
        </span>
    );
}

function HeaderFactIconButton({
    label,
    icon,
    onClick
}: {
    label: string;
    icon: ReactNode;
    onClick?: () => void;
}) {
    return (
        <Button
            type="button"
            aria-label={label}
            title={label}
            size="icon-xs"
            variant="ghost"
            onClick={onClick}
        >
            {icon}
        </Button>
    );
}

function HeaderPreferenceRow({
    checked,
    disabled,
    label,
    onToggle
}: {
    checked: boolean;
    disabled: boolean;
    label: ReactNode;
    onToggle?: () => void;
}) {
    const { t } = useTranslation();
    const value = preferenceLabel(checked, t);

    if (!onToggle) {
        return <HeaderFactRow label={label} value={value} />;
    }

    return (
        <HeaderFactRow label={label}>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={checked}
                disabled={disabled}
                onClick={onToggle}
                className="text-muted-foreground hover:text-primary h-auto min-w-0 px-1 py-0 text-xs"
            >
                <span className="min-w-0 truncate text-right">{value}</span>
            </Button>
        </HeaderFactRow>
    );
}

function compactUserId(userId: string) {
    if (!userId || userId.length <= 18) {
        return userId || '';
    }
    return `${userId.slice(0, 12)}\u2026${userId.slice(-4)}`;
}

function compactUrl(url: string) {
    if (!url) {
        return '';
    }

    const displayUrl = url.replace(/^https?:\/\//, '');
    if (displayUrl.length <= 18) {
        return displayUrl;
    }

    return `${displayUrl.slice(0, 12)}\u2026${displayUrl.slice(-4)}`;
}

function UserDialogHeaderFacts({
    factsModel: model,
    factsCommands: commands
}: {
    factsModel: Pick<
        UserHeaderModel,
        'actionStatus' | 'isCurrentUser' | 'profile' | 'username' | 'userUrl'
    >;
    factsCommands: Pick<
        UserHeaderCommands,
        | 'onCopyUserId'
        | 'onCopyUsername'
        | 'onCopyUserUrl'
        | 'onOpenDiscordProfile'
        | 'onOpenUserUrl'
        | 'onToggleSelfAvatarCopying'
        | 'onToggleSelfBooping'
        | 'onToggleSelfDiscordConnections'
        | 'onToggleSelfSharedConnections'
    >;
}) {
    const { t } = useTranslation();
    const {
        actionStatus = 'idle',
        isCurrentUser,
        profile = {},
        username,
        userUrl
    } = model;
    const {
        onCopyUserId,
        onCopyUsername,
        onCopyUserUrl,
        onOpenDiscordProfile,
        onOpenUserUrl,
        onToggleSelfAvatarCopying,
        onToggleSelfBooping,
        onToggleSelfDiscordConnections,
        onToggleSelfSharedConnections
    } = commands;
    const actionsDisabled = actionStatus !== 'idle';
    const discordId =
        typeof profile.discordId === 'string' ? profile.discordId : '';

    return (
        <div className="text-muted-foreground/80 flex min-w-0 flex-col gap-1 border-t pt-3 text-xs">
            <HeaderPreferenceRow
                label={t('dialog.user.info.avatar_cloning')}
                checked={Boolean(profile.allowAvatarCopying)}
                disabled={actionsDisabled}
                onToggle={isCurrentUser ? onToggleSelfAvatarCopying : undefined}
            />
            {isCurrentUser ? (
                <>
                    <HeaderPreferenceRow
                        label={t('dialog.user.info.booping')}
                        checked={profile.isBoopingEnabled !== false}
                        disabled={actionsDisabled}
                        onToggle={onToggleSelfBooping}
                    />
                    <HeaderPreferenceRow
                        label={t('dialog.user.info.show_mutual_friends')}
                        checked={!profile.hasSharedConnectionsOptOut}
                        disabled={actionsDisabled}
                        onToggle={onToggleSelfSharedConnections}
                    />
                    <HeaderPreferenceRow
                        label={t('dialog.user.info.show_discord_connections')}
                        checked={!profile.hasDiscordFriendsOptOut}
                        disabled={actionsDisabled}
                        onToggle={onToggleSelfDiscordConnections}
                    />
                </>
            ) : null}
            {username ? (
                <HeaderFactRow label={t('dialog.user.info.username')}>
                    <HeaderFactValue display={username} title={username}>
                        {onCopyUsername ? (
                            <HeaderFactIconButton
                                label={t('common.actions.copy')}
                                icon={<CopyIcon data-icon="inline-start" />}
                                onClick={onCopyUsername}
                            />
                        ) : null}
                    </HeaderFactValue>
                </HeaderFactRow>
            ) : null}
            {profile.id ? (
                <HeaderFactRow label={t('dialog.user.info.id')}>
                    <HeaderFactValue
                        display={compactUserId(profile.id)}
                        title={profile.id}
                    >
                        <HeaderFactIconButton
                            label={t('dialog.user.info.copy_id')}
                            icon={<CopyIcon data-icon="inline-start" />}
                            onClick={onCopyUserId}
                        />
                    </HeaderFactValue>
                </HeaderFactRow>
            ) : null}
            {userUrl ? (
                <HeaderFactRow label={t('dialog.user.info.url')}>
                    <HeaderFactValue
                        display={compactUrl(userUrl)}
                        title={userUrl}
                    >
                        <HeaderFactIconButton
                            label={t('common.actions.open_link')}
                            icon={<ExternalLinkIcon data-icon="inline-start" />}
                            onClick={onOpenUserUrl}
                        />
                        <HeaderFactIconButton
                            label={t('dialog.user.info.copy_url')}
                            icon={<CopyIcon data-icon="inline-start" />}
                            onClick={onCopyUserUrl}
                        />
                    </HeaderFactValue>
                </HeaderFactRow>
            ) : null}
            {discordId ? (
                <HeaderFactRow label="Discord">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title={t('dialog.user.tags.open_in_discord')}
                        onClick={() => onOpenDiscordProfile(discordId)}
                        className="text-muted-foreground/80 hover:text-primary h-auto min-w-0 px-1 py-0 text-xs font-normal"
                    >
                        <span className="min-w-0 truncate">
                            {t('common.actions.open')}
                        </span>
                        <ExternalLinkIcon data-icon="inline-end" />
                    </Button>
                </HeaderFactRow>
            ) : null}
        </div>
    );
}

export function UserDialogHeaderSection({
    headerModel: model,
    headerCommands: commands
}: {
    headerModel: UserHeaderModel;
    headerCommands: UserHeaderCommands;
}) {
    const { t } = useTranslation();
    const {
        actionStatus = 'idle',
        avatarOverrideState,
        bannerFallbackUrl,
        canInviteFromCurrentLocation,
        currentAvatarTarget,
        currentUserBoopingEnabled,
        detail,
        extendedModerationState,
        fallbackAvatarTarget,
        estimatedOnlineDurationMs,
        friendNumber,
        friendRequestState,
        imageUrl,
        isCurrentUser,
        isFriend,
        loadStatus,
        moderationState,
        platform,
        PlatformIcon,
        previousDisplayNames,
        previousInstances = [],
        profile,
        profileAppearance,
        profileIconUrl,
        profileLanguages,
        profileTitle,
        pronounsText,
        recentDialogShortcut,
        statusDotClassName,
        statusStateText,
        username,
        userUrl
    } = model;
    const {
        onAvatarOverride,
        onBoop,
        onCopyUserId,
        onCopyUsername,
        onCopyUserUrl,
        onEditMemo,
        onEditSelfProfileDetails,
        onEditSelfProfileMedia,
        onEditSelfProfileDecorations,
        onEditSelfStatus,
        onExtendedModeration,
        onFriendRequest,
        onGroupModeration,
        onImageClick,
        onInvite,
        onInviteMessage,
        onInviteRequest,
        onInviteRequestMessage,
        onInviteToGroup,
        onModeration,
        onOpenDiscordProfile,
        onOpenFallbackAvatar,
        onOpenImagePreview,
        onOpenUserIcon,
        onOpenUserUrl,
        onRefresh,
        onReportHacking,
        onShowAvatarAuthor,
        onShowInstanceHistory,
        onTitleClick,
        onToggleBadgeShowcased,
        onToggleBadgeVisibility,
        onToggleSelfAvatarCopying,
        onToggleSelfBooping,
        onToggleSelfDiscordConnections,
        onToggleSelfSharedConnections,
        onUnfriend
    } = commands;
    const actionMenuModel = {
        actionStatus,
        avatarOverrideState,
        canInviteFromCurrentLocation,
        currentAvatarTarget,
        currentUserBoopingEnabled,
        extendedModerationState,
        fallbackAvatarTarget,
        friendRequestState,
        isCurrentUser,
        isFriend,
        loadStatus,
        moderationState,
        previousInstances,
        profile,
        recentDialogShortcut
    };
    const actionMenuCommands = {
        onAvatarOverride,
        onBoop,
        onEditMemo,
        onEditSelfProfileDetails,
        onEditSelfProfileMedia,
        onEditSelfProfileDecorations,
        onEditSelfStatus,
        onExtendedModeration,
        onFriendRequest,
        onGroupModeration,
        onInvite,
        onInviteMessage,
        onInviteRequest,
        onInviteRequestMessage,
        onInviteToGroup,
        onModeration,
        onOpenFallbackAvatar,
        onRefresh,
        onReportHacking,
        onShowAvatarAuthor,
        onShowInstanceHistory,
        onUnfriend
    };
    const factsModel = {
        actionStatus,
        isCurrentUser,
        profile,
        username,
        userUrl
    };
    const factsCommands = {
        onCopyUserId,
        onCopyUsername,
        onCopyUserUrl,
        onOpenDiscordProfile,
        onOpenUserUrl,
        onToggleSelfAvatarCopying,
        onToggleSelfBooping,
        onToggleSelfDiscordConnections,
        onToggleSelfSharedConnections
    };
    const userIconUrl = profileIconUrl || userImage(profile, true, '256', true);
    const hasTitleMeta = Boolean(profileLanguages?.length);
    const hasIdentityMeta = Boolean(
        pronounsText || previousDisplayNames.length
    );
    const estimatedOnlineForText = estimatedOnlineDurationMs
        ? formatStatsDuration(estimatedOnlineDurationMs)
        : '';
    const hasProfileBadges = hasRenderableUserProfileBadges(profile);
    const isOwner = profile.id === OWNER_USER_ID;
    const profileBackgroundStyle = resolveProfileBackgroundStyle(profile);
    const nameplateGradientStart = normalizeProfileAppearanceColor(
        profileAppearance.nameplateEffect?.metadata?.gradientStart
    );
    const nameplateGradientEnd = normalizeProfileAppearanceColor(
        profileAppearance.nameplateEffect?.metadata?.gradientEnd
    );
    const nameplateStyle = linearGradientStyle(
        90,
        nameplateGradientStart,
        nameplateGradientEnd
    );
    const nameplateAssets = resolveProfileDecorationAssetUrls(
        profileAppearance.nameplateEffect
    );
    const hasNameplateAppearance = Boolean(
        nameplateStyle ||
        nameplateAssets.animatedUrl ||
        nameplateAssets.staticUrl
    );
    return (
        <EntityOverviewCard
            style={profileBackgroundStyle}
            className={cn(
                'relative isolate overflow-hidden',
                profileBackgroundStyle && 'bg-transparent'
            )}
            media={
                <UserDialogHeaderMedia
                    bannerAlt={profile.displayName || profile.id || 'User'}
                    bannerFallbackUrl={bannerFallbackUrl}
                    bannerUrl={imageUrl}
                    iconFrame={profileAppearance.iconFrame}
                    onBannerClick={onImageClick}
                    onOpenUserIcon={onOpenUserIcon}
                    userIconLabel={t('dialog.user.action.open_user_icon')}
                    userIconUrl={userIconUrl}
                />
            }
        >
            <UserDialogProfileDecorationImage
                item={profileAppearance.profileEffect}
                className="absolute inset-x-0 top-0 z-20 aspect-[4/5] overflow-hidden rounded-t-lg"
                imageClassName="object-cover"
            />
            <div className="flex min-w-0 flex-col gap-2.5">
                <div className="flex min-w-0 items-center gap-2">
                    <div
                        style={nameplateStyle}
                        className="relative isolate -ml-1.5 min-h-9 min-w-0 flex-1 overflow-hidden rounded-md"
                    >
                        <UserDialogProfileDecorationImage
                            item={profileAppearance.nameplateEffect}
                            className="absolute inset-0 z-0"
                            imageClassName="object-cover"
                        />
                        <CardTitle
                            className={cn(
                                'relative z-10 flex min-h-9 min-w-0 items-center gap-x-2 px-1.5 py-1 text-lg leading-tight',
                                hasNameplateAppearance && 'text-white'
                            )}
                        >
                            <span className="flex size-4 shrink-0 items-center justify-center">
                                <UserStatusDot
                                    aria-label={statusStateText || undefined}
                                    role={statusStateText ? 'img' : undefined}
                                    title={statusStateText || undefined}
                                    statusDotClassName={statusDotClassName}
                                    className="inline-block size-2.5 shrink-0 align-middle"
                                    variant="inline"
                                />
                            </span>
                            {onTitleClick ? (
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                className="hover:text-primary h-auto min-w-0 justify-start p-0 text-left text-lg leading-tight font-semibold"
                                                title={profileTitle}
                                                onClick={onTitleClick}
                                            >
                                                <span className="min-w-0 truncate">
                                                    {profileTitle}
                                                </span>
                                            </Button>
                                        }
                                    />
                                    <TooltipContent>
                                        {t('common.actions.copy')}
                                    </TooltipContent>
                                </Tooltip>
                            ) : (
                                <span
                                    className="min-w-0 truncate"
                                    title={profileTitle}
                                >
                                    {profileTitle}
                                </span>
                            )}
                            {isOwner ? (
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <span
                                                className="owner-badge"
                                                role="img"
                                                aria-label={t(
                                                    'dialog.user.badges.developer',
                                                    {
                                                        defaultValue:
                                                            'VRCX-0 Developer'
                                                    }
                                                )}
                                            >
                                                <GemIcon aria-hidden="true" />
                                            </span>
                                        }
                                    />
                                    <TooltipContent>
                                        {t('dialog.user.badges.developer', {
                                            defaultValue: 'VRCX-0 Developer'
                                        })}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                        </CardTitle>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <UserDialogHeaderActions
                            actionMenuModel={actionMenuModel}
                            actionMenuCommands={actionMenuCommands}
                        />
                    </div>
                </div>
                <UserDialogHeaderFlags
                    profile={profile}
                    moderationState={moderationState}
                />
                <div className="text-muted-foreground flex min-w-0 flex-col gap-1.5 text-xs">
                    {estimatedOnlineForText ? (
                        <HeaderMetaRow icon={<ClockIcon />}>
                            <span className="min-w-0 truncate">
                                {t('dialog.user.info.estimated_online_for', {
                                    duration: estimatedOnlineForText
                                })}
                            </span>
                        </HeaderMetaRow>
                    ) : null}
                    <HeaderMetaRow icon={<ShieldCheckIcon />}>
                        <UserDialogHeaderAttributes
                            profile={profile}
                            friendNumber={isFriend ? friendNumber : undefined}
                            platform={platform}
                            PlatformIcon={PlatformIcon}
                        />
                    </HeaderMetaRow>
                    {hasIdentityMeta ? (
                        <HeaderMetaRow icon={<UserRoundIcon />}>
                            {pronounsText ? (
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <span className="min-w-0 cursor-default truncate">
                                                {pronounsText}
                                            </span>
                                        }
                                    />
                                    <TooltipContent>
                                        {t('dialog.user.pronouns')}
                                    </TooltipContent>
                                </Tooltip>
                            ) : null}
                            <PreviousDisplayNamesBadge
                                names={previousDisplayNames}
                            />
                        </HeaderMetaRow>
                    ) : null}
                    {hasTitleMeta ? (
                        <HeaderMetaRow icon={<GlobeIcon />}>
                            {profileLanguages.map((language, index) => {
                                const code = language.key.toUpperCase();
                                return (
                                    <span
                                        key={language.key}
                                        className="inline-flex shrink-0 items-center"
                                    >
                                        <Tooltip>
                                            <TooltipTrigger
                                                render={
                                                    <span className="cursor-default">
                                                        {languageDisplayName(
                                                            language
                                                        )}
                                                    </span>
                                                }
                                            />
                                            <TooltipContent>
                                                {code}
                                            </TooltipContent>
                                        </Tooltip>
                                        {index < profileLanguages.length - 1 ? (
                                            <span className="mx-1 opacity-50">
                                                ·
                                            </span>
                                        ) : null}
                                    </span>
                                );
                            })}
                        </HeaderMetaRow>
                    ) : null}
                </div>
            </div>

            {hasProfileBadges ? (
                <>
                    <Separator />
                    <div className="flex flex-wrap items-center gap-1.5">
                        <UserDialogHeaderMediaBadges
                            profile={profile}
                            profileTitle={profileTitle}
                            actionStatus={actionStatus}
                            isCurrentUser={isCurrentUser}
                            onOpenImagePreview={onOpenImagePreview}
                            onToggleBadgeVisibility={onToggleBadgeVisibility}
                            onToggleBadgeShowcased={onToggleBadgeShowcased}
                        />
                    </div>
                </>
            ) : null}

            {profile.statusDescription ? (
                <>
                    <Separator />
                    {isCurrentUser && onEditSelfStatus ? (
                        <Button
                            type="button"
                            variant="ghost"
                            className="text-muted-foreground hover:text-primary h-auto max-h-24 w-full min-w-0 justify-start overflow-auto p-0 text-left text-sm whitespace-pre-wrap"
                            title={t('dialog.user.actions.edit_status')}
                            onClick={onEditSelfStatus}
                        >
                            <span className="flex min-w-0 items-start gap-2">
                                <HeaderRowIcon
                                    icon={<PencilIcon />}
                                    className="mt-0.5"
                                />
                                <span className="min-w-0">
                                    {typeof profile.statusDescription ===
                                    'string'
                                        ? profile.statusDescription
                                        : ''}
                                </span>
                            </span>
                        </Button>
                    ) : (
                        <div className="text-muted-foreground flex max-h-24 min-w-0 items-start gap-2 overflow-auto text-sm whitespace-pre-wrap">
                            <HeaderRowIcon
                                icon={<PencilIcon />}
                                className="mt-0.5"
                            />
                            <span className="min-w-0">
                                {typeof profile.statusDescription === 'string'
                                    ? profile.statusDescription
                                    : ''}
                            </span>
                        </div>
                    )}
                </>
            ) : null}

            {detail ? (
                <div className="text-muted-foreground text-xs">
                    {isValidElement(detail)
                        ? detail
                        : userFacingErrorMessage(
                              detail,
                              t('common.error.failed_to_load_data')
                          )}
                </div>
            ) : null}

            <UserDialogHeaderFacts
                factsModel={factsModel}
                factsCommands={factsCommands}
            />
        </EntityOverviewCard>
    );
}
