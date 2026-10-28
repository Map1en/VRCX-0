import { ClockIcon } from 'lucide-react';
import {
    useEffect,
    useEffectEvent,
    useMemo,
    useState,
    type ComponentType
} from 'react';
import { useTranslation } from 'react-i18next';
import { useShallow } from 'zustand/react/shallow';

import { resolveSidebarStatusDotClassName } from '@/components/sidebar/friends-sidebar/friendsSidebarModel';
import type { InstanceRosterRow } from '@/domain/instances/instanceRoster';
import { openAvatarDialog, openGroupDialog } from '@/services/dialogService';
import {
    convertFileUrlToImageUrl,
    openExternalLink
} from '@/services/entityMediaService';
import { isActionRecent } from '@/services/recentActionService';
import { MINUTE_MS } from '@/shared/constants/time';
import { vrchatUserUrl } from '@/shared/constants/vrchatWebUrls';
import { parseLocation } from '@/shared/utils/location';
import { usePreferencesStore } from '@/state/preferencesStore';

import {
    EntityDialogScaffold,
    EntityDialogTwoColumnLayout
} from './EntityDialogScaffold';
import { UserDialogHeaderSection } from './user-dialog/components/UserDialogHeaderSection';
import { UserDialogProfileEditPanel } from './user-dialog/components/UserDialogProfileEditPanel';
import { UserDialogTabsSection } from './user-dialog/components/UserDialogTabsSection';
import type {
    resolveFriendRequestState,
    resolvePlatformMeta
} from './user-dialog/userDialogContentHelpers';
import { buildUserDialogLocationUsers } from './user-dialog/userDialogLocationUsers';
import {
    applyUserDialogProfileAppearanceOverrides,
    resolveUserDialogBannerColor,
    resolveUserDialogBannerUrl
} from './user-dialog/userDialogProfileAppearance';
import {
    isOfflineLikeValue,
    normalizedText
} from './user-dialog/userDialogRows';
import type { UserDialogLoadStatus } from './user-dialog/userDialogTabService';
import { buildUserDialogProfileSummary } from './user-dialog/userDialogViewData';
import { useUserDialogAvatarAuthorAction } from './user-dialog/useUserDialogAvatarAuthorAction';
import { useUserDialogClipboardActions } from './user-dialog/useUserDialogClipboardActions';
import type { useUserDialogLocationPanel } from './user-dialog/useUserDialogLocationPanel';
import type {
    AvatarOverrideState,
    ExtendedModerationState,
    ModerationState
} from './user-dialog/useUserDialogModerationState';
import { useUserDialogProfileAppearance } from './user-dialog/useUserDialogProfileAppearance';
import { useUserDialogProfileDecorations } from './user-dialog/useUserDialogProfileDecorations';
import type { UserDialogProfileRecord } from './user-dialog/useUserDialogProfileResource';
import { useUserDialogTabbedRuntimeState } from './user-dialog/useUserDialogRuntimeState';
import type { useUserDialogSelfActions } from './user-dialog/useUserDialogSelfActions';
import type { useUserDialogSupplementalData } from './user-dialog/useUserDialogSupplementalData';
import { useUserDialogTabData } from './user-dialog/useUserDialogTabData';
import type {
    AvatarOverrideType,
    ExtendedModerationType,
    ModerationType
} from './user-dialog/useUserModerationActions';

type SupplementalData = ReturnType<typeof useUserDialogSupplementalData>;
type SelfControls = ReturnType<typeof useUserDialogSelfActions>['actions'];
type SelfProfileDetails = ReturnType<
    typeof useUserDialogSelfActions
>['profileDetails'];
type LocationPanelController = ReturnType<typeof useUserDialogLocationPanel>;

interface UserDialogTabbedViewProps {
    profile: UserDialogProfileRecord;
    resource: {
        memo: string;
        detail: string;
        imageUrl: string;
        loadStatus: string;
        actionStatus: string;
        recentActionVersion?: number;
        reloadToken?: number;
        initialAction?: string;
    };
    relationship: {
        moderationState: ModerationState;
        extendedModerationState?: ExtendedModerationState;
        avatarOverrideState?: AvatarOverrideState;
        isCurrentUser: boolean;
        isFriend: boolean;
        isFavorite: boolean;
        friendRequestState: ReturnType<typeof resolveFriendRequestState>;
    };
    platformInfo: {
        platform: ReturnType<typeof resolvePlatformMeta>;
        platformIcon: ComponentType | null;
    };
    presence: {
        presenceLocation: string;
        currentAvatarTarget: string;
        homeLocationTarget: string;
        canInviteFromCurrentLocation: boolean;
        currentUserHasSharedConnectionsOptOut: boolean;
        currentUserBoopingEnabled: boolean;
        currentUserAccountStanding: string;
        userStats?: SupplementalData['userStats'];
        loadPreviousInstances?: SupplementalData['loadPreviousInstances'];
        previousInstances?: SupplementalData['previousInstances'];
        previousInstancesError?: SupplementalData['previousInstancesError'];
        previousInstancesStatus?: SupplementalData['previousInstancesStatus'];
        representedGroup?: SupplementalData['representedGroup'];
        representedGroupStatus?: string;
        hideUserNotes?: boolean;
        hideUserMemos?: boolean;
    };
    locationPanel: {
        sameInstanceUsers?: InstanceRosterRow[];
        locationOwnerUser?: Record<string, unknown> | null;
        locationOwnerGroup?: Record<string, unknown> | null;
        locationInstance?: Record<string, unknown> | null;
        locationFriendCount?: number;
        locationPlayerCount?: number;
        onRefreshLocation?: LocationPanelController['refreshLocationPanel'];
        onPreviousInstancesChange: SupplementalData['setPreviousInstances'];
    };
    profileControls: {
        onRefresh: () => void;
        onEditMemo: () => void | Promise<void>;
        onShowAccountStanding: () => void;
    };
    friendControls: {
        onFriendRequest: (action: string) => void;
        onInvite: () => void;
        onInviteMessage: () => void;
        onInviteRequest: () => void;
        onInviteRequestMessage: () => void;
        onBoop: () => void;
        onUnfriend: () => void;
        onModeration: (type: ModerationType, enabled: boolean) => void;
        onExtendedModeration: (
            type: ExtendedModerationType,
            enabled: boolean
        ) => void;
        onAvatarOverride: (type: AvatarOverrideType) => void;
        onReportUser: () => void;
        onInviteToGroup: () => void;
        onGroupModeration: () => void;
    };
    selfControls: SelfControls;
    selfProfileDetails: SelfProfileDetails;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value))
        : {};
}

const SELF_PANELS = ['profile-edit'] as const;
type SelfPanel = '' | (typeof SELF_PANELS)[number];

function isSelfPanel(value: string): value is Exclude<SelfPanel, ''> {
    return SELF_PANELS.some((panel) => panel === value);
}

const VRC_PLUS_SUMMARY_SNAPSHOT = Object.freeze({ $isVRCPlus: true });

function finiteTabCount(value: number | undefined) {
    return value !== undefined && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
}

function loadedTabCount(
    status: UserDialogLoadStatus | undefined,
    rows: readonly unknown[]
) {
    return status === 'ready' ? rows.length : undefined;
}

function resolveTabCount(
    primary: number | undefined,
    fallback: number | undefined
) {
    return finiteTabCount(primary) ?? finiteTabCount(fallback);
}

export function UserDialogTabbedView({
    profile,
    friendControls,
    locationPanel,
    platformInfo,
    presence,
    profileControls,
    relationship,
    resource,
    selfControls,
    selfProfileDetails
}: UserDialogTabbedViewProps) {
    const {
        memo,
        detail,
        imageUrl,
        loadStatus,
        actionStatus,
        recentActionVersion = 0,
        reloadToken = 0,
        initialAction = ''
    } = resource;
    const appearanceVisibility = usePreferencesStore(
        useShallow((state) => ({
            profileBackground: state.showUserDialogProfileBackground,
            avatarFrame: state.showUserDialogAvatarFrame,
            profileEffect: state.showUserDialogProfileEffect,
            nameplateEffect: state.showUserDialogNameplateEffect
        }))
    );
    const [selfPanel, setSelfPanel] = useState<SelfPanel>('');
    const activeSelfPanel: SelfPanel = relationship.isCurrentUser
        ? selfPanel
        : '';
    const canonicalProfileAppearance = useUserDialogProfileAppearance({
        profile,
        visibility: appearanceVisibility
    });
    const profileDecorations = useUserDialogProfileDecorations({
        enabled: activeSelfPanel === 'profile-edit',
        onProfileUpdated: profileControls.onRefresh
    });
    const profileAppearance = relationship.isCurrentUser
        ? applyUserDialogProfileAppearanceOverrides(
              canonicalProfileAppearance,
              profileDecorations.appearanceOverrides
          )
        : canonicalProfileAppearance;
    const {
        moderationState,
        extendedModerationState = { interactOff: false, muteChat: false },
        avatarOverrideState = { hideAvatar: false, showAvatar: false },
        isCurrentUser,
        isFriend,
        friendRequestState
    } = relationship;
    const { platform, platformIcon: PlatformIcon } = platformInfo;
    const {
        presenceLocation,
        currentAvatarTarget,
        homeLocationTarget,
        canInviteFromCurrentLocation,
        currentUserHasSharedConnectionsOptOut,
        currentUserBoopingEnabled,
        currentUserAccountStanding,
        userStats = {},
        loadPreviousInstances,
        previousInstances = [],
        previousInstancesError = '',
        previousInstancesStatus = 'idle',
        representedGroup = null,
        representedGroupStatus = 'idle',
        hideUserNotes = false,
        hideUserMemos = false
    } = presence;
    const {
        sameInstanceUsers = [],
        locationOwnerUser = null,
        locationOwnerGroup = null,
        locationInstance = null,
        locationFriendCount = 0,
        locationPlayerCount = 0,
        onRefreshLocation,
        onPreviousInstancesChange
    } = locationPanel;
    const { onRefresh, onEditMemo, onShowAccountStanding } = profileControls;
    const {
        onFriendRequest,
        onInvite,
        onInviteMessage,
        onInviteRequest,
        onInviteRequestMessage,
        onBoop,
        onUnfriend,
        onModeration,
        onExtendedModeration,
        onAvatarOverride,
        onReportUser,
        onInviteToGroup,
        onGroupModeration
    } = friendControls;
    const {
        editSelfStatus: onEditSelfStatus,
        resetSelfProfileDetailsDraft,
        setSelfProfileMediaField: onSetSelfProfileMediaField,
        setSelfBannerColor: onSetSelfBannerColor,
        toggleSelfAvatarCopying: onToggleSelfAvatarCopying,
        toggleSelfBooping: onToggleSelfBooping,
        toggleSelfSharedConnections: onToggleSelfSharedConnections,
        toggleSelfDiscordConnections: onToggleSelfDiscordConnections,
        toggleBadgeVisibility: onToggleBadgeVisibility,
        toggleBadgeShowcased: onToggleBadgeShowcased
    } = selfControls;
    const { t } = useTranslation();
    const [nowMs, setNowMs] = useState(() => Date.now());
    const {
        currentAvatarId,
        currentEndpoint,
        currentUserId,
        friendsById,
        inGameGroupOrder,
        isLocalUserVrcPlusSupporter,
        openImagePreview,
        previousAvatarSwapTime
    } = useUserDialogTabbedRuntimeState();
    const { copyUserText, openDiscordProfile } =
        useUserDialogClipboardActions();

    useEffect(() => {
        const intervalId = window.setInterval(() => {
            setNowMs(Date.now());
        }, MINUTE_MS);
        return () => {
            window.clearInterval(intervalId);
        };
    }, []);

    const tabData = useUserDialogTabData({
        profile,
        reloadToken,
        isCurrentUser,
        currentEndpoint,
        currentUserId,
        currentAvatarId,
        previousAvatarSwapTime,
        currentUserHasSharedConnectionsOptOut,
        friendsById,
        inGameGroupOrder
    });

    const openInitialSelfPanel = useEffectEvent((panel: string) => {
        if (isCurrentUser && isSelfPanel(panel)) {
            resetSelfProfileDetailsDraft();
            setSelfPanel(panel);
        }
    });

    useEffect(() => {
        openInitialSelfPanel(initialAction);
    }, [initialAction, isCurrentUser]);

    const {
        activeTab,
        avatarReleaseStatus,
        avatarSort,
        bioLinks,
        changeAvatarReleaseStatus,
        changeAvatarSort,
        changeTab,
        changeWorldOrder,
        changeWorldSort,
        effectiveGroupSort,
        favoriteWorlds,
        filteredFavoriteWorlds,
        filteredMutualFriends,
        filteredProfileGroups,
        filteredProfileWorlds,
        groupSearchActive,
        loadTab,
        mutualFriends,
        mutualSort,
        profileAvatars,
        profileGroups,
        profileWorlds,
        remoteData,
        remoteErrors,
        remoteStatus,
        remoteTabCounts,
        search,
        setGroupSort,
        setMutualSort,
        setSearch,
        sortedProfileGroups,
        tabs,
        visibleMutualFriends,
        visibleProfileAvatars,
        vrchatConfigConstants,
        worldOrder,
        worldSort
    } = tabData;

    useEffect(() => {
        if (
            activeTab === 'instance-history' &&
            previousInstancesStatus === 'idle'
        ) {
            void loadPreviousInstances?.();
        }
    }, [activeTab, loadPreviousInstances, previousInstancesStatus]);

    const userUrl = profile.id ? vrchatUserUrl(profile.id) : '';
    const username =
        profile.username && profile.username !== profile.id
            ? profile.username
            : '';
    const profileTitle = profile.displayName || profile.username || 'User';
    const pronounsText = Array.isArray(profile.pronouns)
        ? profile.pronouns.join(', ')
        : normalizedText(profile.pronouns);
    const {
        previousDisplayNames,
        statusStateText,
        userGroupSections,
        ownGroupCountText,
        remainingGroupCountText,
        userTimeSpent,
        userJoinCount,
        lastSeen,
        profileLanguages,
        mutualFriendCount,
        friendNumber,
        estimatedOnlineDurationMs,
        presenceActivityAt,
        friendedAt,
        relationshipHistory
    } = buildUserDialogProfileSummary({
        profile,
        userStats: {
            ...userStats,
            mutualFriendCount:
                remoteTabCounts.mutual ?? record(userStats).mutualFriendCount
        },
        sortedProfileGroups,
        isCurrentUser,
        vrchatConfigConstants,
        currentUserSnapshot: isLocalUserVrcPlusSupporter
            ? VRC_PLUS_SUMMARY_SNAPSHOT
            : null,
        nowMs
    });
    const statusDotClassName = resolveSidebarStatusDotClassName(profile, {
        hideNonFriend: false
    });
    const currentAvatarDisplayName = String(
        profile.currentAvatarName || profile.avatarName || ''
    ).trim();
    const fallbackAvatarTarget =
        typeof profile.fallbackAvatar === 'string'
            ? profile.fallbackAvatar.trim()
            : '';
    const fallbackAvatarDialogArgs = {
        avatarId: fallbackAvatarTarget,
        title: 'Fallback Avatar'
    };
    const visibleHomeLocationTarget = isOfflineLikeValue(homeLocationTarget)
        ? ''
        : homeLocationTarget;
    const visiblePresenceLocation = isOfflineLikeValue(presenceLocation)
        ? ''
        : presenceLocation;
    const visiblePresenceParsedLocation = visiblePresenceLocation
        ? parseLocation(visiblePresenceLocation)
        : null;
    const locationWorldTitle = normalizedText(
        profile.worldName || profile.$worldName
    );
    const { locationInstanceUsers, locationOwnerId } = useMemo(
        () =>
            buildUserDialogLocationUsers({
                currentUserId,
                friendsById,
                locationInstance,
                locationOwnerGroup,
                locationOwnerUser,
                profile,
                sameInstanceUsers,
                t,
                visiblePresenceParsedLocation
            }),
        [
            currentUserId,
            friendsById,
            locationInstance,
            locationOwnerGroup,
            locationOwnerUser,
            profile,
            sameInstanceUsers,
            t,
            visiblePresenceParsedLocation
        ]
    );
    const tabCounts = useMemo(
        () => ({
            'instance-history': isCurrentUser
                ? undefined
                : previousInstances.length,
            mutual: resolveTabCount(
                loadedTabCount(remoteStatus.mutual, mutualFriends),
                remoteTabCounts.mutual ?? mutualFriendCount
            ),
            groups: resolveTabCount(
                loadedTabCount(remoteStatus.groups, profileGroups),
                remoteTabCounts.groups
            ),
            worlds: resolveTabCount(
                loadedTabCount(remoteStatus.worlds, profileWorlds),
                remoteTabCounts.worlds
            ),
            'favorite-worlds': resolveTabCount(
                loadedTabCount(remoteStatus['favorite-worlds'], favoriteWorlds),
                remoteTabCounts['favorite-worlds']
            ),
            avatars: resolveTabCount(
                loadedTabCount(remoteStatus.avatars, profileAvatars),
                remoteTabCounts.avatars
            )
        }),
        [
            favoriteWorlds,
            isCurrentUser,
            mutualFriendCount,
            mutualFriends,
            previousInstances.length,
            profileAvatars,
            profileGroups,
            profileWorlds,
            remoteStatus,
            remoteTabCounts
        ]
    );
    const isRecentDialogAction = (
        actionType: Parameters<typeof isActionRecent>[1]
    ) => recentActionVersion >= 0 && isActionRecent(profile.id, actionType);
    const recentDialogShortcut = (
        actionType: Parameters<typeof isActionRecent>[1]
    ) =>
        isRecentDialogAction(actionType) ? (
            <ClockIcon className="text-muted-foreground size-3.5" />
        ) : null;

    const showAvatarAuthor = useUserDialogAvatarAuthorAction({
        currentAvatarTarget
    });
    const bannerUrl = convertFileUrlToImageUrl(
        resolveUserDialogBannerUrl(profile),
        1024
    );
    const bannerFallbackUrl = convertFileUrlToImageUrl(imageUrl, 1024);
    const displayedBannerUrl = bannerUrl || bannerFallbackUrl;

    function openSelfProfileEditor() {
        resetSelfProfileDetailsDraft();
        setSelfPanel('profile-edit');
    }

    function openInstanceHistory() {
        changeTab('instance-history', { allowHidden: true });
    }

    function openFeed() {
        changeTab('feed', { allowHidden: true });
    }

    const headerModel = {
        actionStatus,
        appearanceVisibility,
        avatarOverrideState,
        canInviteFromCurrentLocation,
        currentAvatarTarget,
        currentUserAccountStanding,
        currentUserBoopingEnabled,
        detail,
        extendedModerationState,
        fallbackAvatarTarget,
        friendNumber,
        friendRequestState,
        bannerColor: resolveUserDialogBannerColor(profile),
        bannerFallbackUrl,
        imageUrl: bannerUrl,
        isCurrentUser,
        isFriend,
        loadStatus,
        moderationState,
        noteSummary: (
            (hideUserMemos ? '' : memo) ||
            (hideUserNotes ? '' : normalizedText(profile.note))
        )
            .replace(/\s+/g, ' ')
            .trim(),
        platform,
        PlatformIcon,
        previousDisplayNames,
        profile,
        profileAppearance,
        profileIconUrl: imageUrl,
        profileLanguages,
        profileTitle,
        pronounsText,
        recentDialogShortcut,
        statusDotClassName,
        statusStateText,
        username,
        userUrl,
        estimatedOnlineDurationMs
    };
    const headerCommands = {
        onAvatarOverride,
        onBoop,
        onCopyDisplayName: (displayName: string) => {
            copyUserText(
                normalizedText(displayName),
                t('dialog.user.info.display_name')
            );
        },
        onCopyUserId: () => {
            copyUserText(normalizedText(profile.id), t('dialog.user.info.id'));
        },
        onCopyUserUrl: () => {
            copyUserText(userUrl, t('dialog.user.info.url'));
        },
        onCopyUsername: username
            ? () => {
                  copyUserText(username, t('dialog.user.info.username'));
              }
            : undefined,
        onEditMemo,
        onEditSelfProfile: openSelfProfileEditor,
        onEditSelfStatus,
        onExtendedModeration,
        onFriendRequest,
        onGroupModeration,
        onImageClick: () =>
            openImagePreview({
                url: displayedBannerUrl,
                title: profileTitle
            }),
        onInvite,
        onInviteMessage,
        onInviteRequest,
        onInviteRequestMessage,
        onInviteToGroup,
        onModeration,
        onOpenDiscordProfile: openDiscordProfile,
        onOpenFallbackAvatar: () => openAvatarDialog(fallbackAvatarDialogArgs),
        onOpenImagePreview: openImagePreview,
        onOpenUserIcon: () =>
            openImagePreview({
                url: imageUrl,
                title: profileTitle
            }),
        onOpenUserUrl: () => openExternalLink(userUrl),
        onRefresh,
        onReportUser,
        onShowAccountStanding,
        onShowAvatarAuthor: showAvatarAuthor,
        onShowInstanceHistory: openInstanceHistory,
        onToggleBadgeShowcased,
        onToggleBadgeVisibility,
        onToggleSelfAvatarCopying,
        onToggleSelfBooping,
        onToggleSelfDiscordConnections,
        onToggleSelfSharedConnections,
        onUnfriend
    };
    const tabsModel = {
        root: {
            activeTab,
            tabCounts,
            tabs
        },
        info: {
            bioLinks,
            currentAvatarDisplayName,
            hideUserMemos,
            hideUserNotes,
            isCurrentUser,
            isFriend,
            lastSeen,
            memo,
            friendedAt,
            relationshipHistory,
            presenceActivityAt,
            profile,
            representedGroup,
            representedGroupStatus,
            userJoinCount,
            userTimeSpent,
            visibleHomeLocationTarget
        },
        presence: {
            visiblePresenceLocation,
            locationInstance,
            locationOwnerId,
            locationPlayerCount,
            currentUserId,
            currentEndpoint,
            locationWorldTitle,
            locationFriendCount,
            previousInstances,
            locationInstanceUsers
        },
        remote: {
            loadTab,
            remoteData,
            remoteErrors,
            remoteStatus,
            search
        },
        mutual: {
            filteredMutualFriends,
            mutualFriends,
            mutualSort,
            visibleMutualFriends
        },
        groups: {
            effectiveGroupSort,
            filteredProfileGroups,
            groupSearchActive,
            ownGroupCountText,
            profileGroups,
            remainingGroupCountText,
            userGroupSections
        },
        worlds: {
            filteredProfileWorlds,
            profileWorlds,
            worldOrder,
            worldSort
        },
        favoriteWorlds: {
            favoriteWorlds,
            filteredFavoriteWorlds
        },
        avatars: {
            avatarReleaseStatus,
            avatarSort,
            currentUserId,
            profileAvatars,
            visibleProfileAvatars
        },
        history: {
            previousInstances,
            previousInstancesError,
            previousInstancesStatus
        }
    };
    const tabsCommands = {
        changeAvatarReleaseStatus,
        changeAvatarSort,
        changeTab,
        changeWorldOrder,
        changeWorldSort,
        onEditMemo,
        onEditSelfProfileDetails: openSelfProfileEditor,
        onOpenFeed: openFeed,
        onOpenInstanceHistory: openInstanceHistory,
        onPreviousInstancesChange,
        onRefreshLocation,
        openGroupDialog,
        setGroupSort,
        setMutualSort,
        setSearch
    };

    return (
        <EntityDialogScaffold className="gap-3">
            <EntityDialogTwoColumnLayout
                rail={
                    <UserDialogHeaderSection
                        headerModel={headerModel}
                        headerCommands={headerCommands}
                    />
                }
            >
                {activeSelfPanel === 'profile-edit' ? (
                    <UserDialogProfileEditPanel
                        profile={profile}
                        isVrcPlus={isLocalUserVrcPlusSupporter}
                        busy={actionStatus !== 'idle'}
                        details={selfProfileDetails}
                        decorations={profileDecorations}
                        statusDotClassName={statusDotClassName}
                        statusText={
                            normalizedText(profile.statusDescription) ||
                            statusStateText
                        }
                        onBack={() => setSelfPanel('')}
                        onEditStatus={onEditSelfStatus}
                        onSetMediaFile={onSetSelfProfileMediaField}
                        onSetBannerColor={onSetSelfBannerColor}
                    />
                ) : (
                    <UserDialogTabsSection
                        tabsModel={tabsModel}
                        tabsCommands={tabsCommands}
                    />
                )}
            </EntityDialogTwoColumnLayout>
        </EntityDialogScaffold>
    );
}
