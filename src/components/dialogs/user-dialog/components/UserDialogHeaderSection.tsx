import type { TFunction } from 'i18next';
import {
    ClockIcon,
    CopyIcon,
    ExternalLinkIcon,
    GemIcon,
    PencilIcon,
    UsersIcon
} from 'lucide-react';
import { isValidElement, type ComponentType, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
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
    formatStatsDuration,
    normalizePreviousDisplayNames
} from '../userDialogRows';
import {
    PreviousDisplayNamesBadge,
    UserTitleLanguages
} from '../UserDialogViewParts';
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
    UserDialogHeaderBadges,
    UserDialogHeaderMediaBadges
} from './UserDialogHeaderBadges';

export interface UserHeaderModel {
    actionStatus: string;
    avatarOverrideState: AvatarOverrideState;
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
    profileLanguages: { key: string; value: string }[];
    profileTitle: string;
    pronounsText?: string;
    recentDialogShortcut: (actionType: unknown) => ReactNode;
    statusDotClassName: string;
    statusStateText: string;
    userSubtitle: string;
    userUrl: string;
}

export interface UserHeaderCommands {
    onAvatarOverride: (type: AvatarOverrideType) => void;
    onBoop: () => void;
    onCopyUserId: () => void;
    onCopyUserUrl: () => void;
    onEditMemo: () => void;
    onEditSelfProfileDetails: () => void;
    onEditSelfProfileMedia: () => void;
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
    onSubtitleClick?: () => void;
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
        'actionStatus' | 'isCurrentUser' | 'profile' | 'userUrl'
    >;
    factsCommands: Pick<
        UserHeaderCommands,
        | 'onCopyUserId'
        | 'onCopyUserUrl'
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
        userUrl
    } = model;
    const {
        onCopyUserId,
        onCopyUserUrl,
        onOpenUserUrl,
        onToggleSelfAvatarCopying,
        onToggleSelfBooping,
        onToggleSelfDiscordConnections,
        onToggleSelfSharedConnections
    } = commands;
    const actionsDisabled = actionStatus !== 'idle';

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
            {profile.id ? (
                <HeaderFactRow label={t('dialog.user.info.id')}>
                    <span className="flex min-w-0 items-center justify-end gap-1">
                        <span
                            className="text-muted-foreground/80 min-w-0 truncate font-mono text-[11px]"
                            title={profile.id}
                        >
                            {compactUserId(profile.id)}
                        </span>
                        <Button
                            type="button"
                            aria-label={t('dialog.user.info.copy_id')}
                            title={t('dialog.user.info.copy_id')}
                            size="icon-xs"
                            variant="ghost"
                            onClick={onCopyUserId}
                        >
                            <CopyIcon data-icon="inline-start" />
                        </Button>
                    </span>
                </HeaderFactRow>
            ) : null}
            {userUrl ? (
                <HeaderFactRow label={t('dialog.user.info.url')}>
                    <span className="flex min-w-0 items-center justify-end gap-1">
                        <span
                            className="text-muted-foreground/80 min-w-0 truncate font-mono text-[11px]"
                            title={userUrl}
                        >
                            {compactUrl(userUrl)}
                        </span>
                        <Button
                            type="button"
                            aria-label={t('common.actions.open_link')}
                            title={t('common.actions.open_link')}
                            size="icon-xs"
                            variant="ghost"
                            onClick={onOpenUserUrl}
                        >
                            <ExternalLinkIcon data-icon="inline-start" />
                        </Button>
                        <Button
                            type="button"
                            aria-label={t('dialog.user.info.copy_url')}
                            title={t('dialog.user.info.copy_url')}
                            size="icon-xs"
                            variant="ghost"
                            onClick={onCopyUserUrl}
                        >
                            <CopyIcon data-icon="inline-start" />
                        </Button>
                    </span>
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
        profileLanguages,
        profileTitle,
        pronounsText,
        recentDialogShortcut,
        statusDotClassName,
        statusStateText,
        userSubtitle,
        userUrl
    } = model;
    const {
        onAvatarOverride,
        onBoop,
        onCopyUserId,
        onCopyUserUrl,
        onEditMemo,
        onEditSelfProfileDetails,
        onEditSelfProfileMedia,
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
        onSubtitleClick,
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
        userUrl
    };
    const factsCommands = {
        onCopyUserId,
        onCopyUserUrl,
        onOpenUserUrl,
        onToggleSelfAvatarCopying,
        onToggleSelfBooping,
        onToggleSelfDiscordConnections,
        onToggleSelfSharedConnections
    };
    const userIconUrl = profile.userIcon
        ? userImage(profile, true, '256', true)
        : '';
    const hasTitleMeta = Boolean(profileLanguages?.length);
    const estimatedOnlineForText = estimatedOnlineDurationMs
        ? formatStatsDuration(estimatedOnlineDurationMs)
        : '';
    const hasProfileBadges = hasRenderableUserProfileBadges(profile);
    const isOwner = profile.id === OWNER_USER_ID;

    return (
        <EntityOverviewCard
            media={
                <div className="relative">
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={!imageUrl || !onImageClick}
                        onClick={onImageClick}
                        className={cn(
                            'bg-muted aspect-[4/3] h-auto w-full overflow-hidden rounded-lg border p-0 disabled:pointer-events-none',
                            imageUrl ? 'cursor-pointer' : 'cursor-default'
                        )}
                    >
                        {imageUrl ? (
                            <FadeInImage
                                src={imageUrl}
                                alt={
                                    profile.displayName || profile.id || 'User'
                                }
                                className="size-full object-cover"
                                fallback={
                                    <UsersIcon className="text-muted-foreground size-8" />
                                }
                            />
                        ) : (
                            <UsersIcon className="text-muted-foreground size-8" />
                        )}
                    </Button>
                    {userIconUrl ? (
                        <Button
                            type="button"
                            variant="ghost"
                            aria-label={t('dialog.user.action.open_user_icon')}
                            title={t('dialog.user.action.open_user_icon')}
                            className="bg-background/90 absolute right-3 bottom-3 size-16 overflow-hidden rounded-full border-2 border-white p-0 shadow-md"
                            onClick={onOpenUserIcon}
                        >
                            <FadeInImage
                                src={userIconUrl}
                                alt=""
                                className="size-full object-cover"
                            />
                        </Button>
                    ) : null}
                </div>
            }
        >
            <div className="flex min-w-0 items-start gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <CardTitle className="flex min-w-0 flex-wrap items-center gap-1.5 text-lg leading-tight">
                        <UserStatusDot
                            aria-label={statusStateText || undefined}
                            role={statusStateText ? 'img' : undefined}
                            title={statusStateText || undefined}
                            statusDotClassName={statusDotClassName}
                            className="inline-block size-2.5 shrink-0 align-middle"
                            variant="inline"
                        />
                        {onTitleClick ? (
                            <Tooltip>
                                <TooltipTrigger
                                    render={
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            className="hover:text-primary h-auto min-w-0 justify-start p-0 text-left text-lg leading-tight font-semibold break-words whitespace-normal"
                                            onClick={onTitleClick}
                                        >
                                            {profileTitle}
                                        </Button>
                                    }
                                />
                                <TooltipContent>
                                    {t('common.actions.copy')}
                                </TooltipContent>
                            </Tooltip>
                        ) : (
                            <span className="min-w-0 break-words">
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
                        {pronounsText ? (
                            <span
                                className="text-muted-foreground shrink-0 font-mono text-xs font-normal"
                                title={t('dialog.user.pronouns')}
                            >
                                {pronounsText}
                            </span>
                        ) : null}
                        <PreviousDisplayNamesBadge
                            names={previousDisplayNames}
                        />
                    </CardTitle>
                    {userSubtitle ? (
                        onSubtitleClick ? (
                            <Button
                                type="button"
                                variant="ghost"
                                className="text-muted-foreground hover:text-primary mr-1.5 ml-2 h-auto justify-start p-0 text-left font-mono text-xs break-all whitespace-normal"
                                onClick={onSubtitleClick}
                            >
                                {userSubtitle}
                            </Button>
                        ) : (
                            <div className="text-muted-foreground font-mono text-xs break-all">
                                {userSubtitle}
                            </div>
                        )
                    ) : null}
                    {estimatedOnlineForText ? (
                        <div className="text-muted-foreground/80 flex min-w-0 items-center gap-1.5 text-[11px] leading-tight font-normal">
                            <ClockIcon
                                data-icon="inline-start"
                                className="size-3 shrink-0 opacity-70"
                            />
                            <span className="min-w-0 truncate">
                                {t('dialog.user.info.estimated_online_for', {
                                    duration: estimatedOnlineForText
                                })}
                            </span>
                        </div>
                    ) : null}
                    {hasTitleMeta ? (
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                            <UserTitleLanguages languages={profileLanguages} />
                        </div>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <UserDialogHeaderActions
                        actionMenuModel={actionMenuModel}
                        actionMenuCommands={actionMenuCommands}
                    />
                </div>
            </div>

            <div className="flex flex-wrap gap-1.5">
                <UserDialogHeaderBadges
                    profile={profile}
                    moderationState={moderationState}
                    friendNumber={friendNumber}
                    platform={platform}
                    PlatformIcon={PlatformIcon}
                    onOpenDiscordProfile={onOpenDiscordProfile}
                />
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
                                <PencilIcon
                                    data-icon="inline-start"
                                    className="mt-1 size-3 shrink-0"
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
                            <PencilIcon
                                data-icon="inline-start"
                                className="mt-1 size-3 shrink-0"
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
                              'The requested data could not be loaded.'
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
