import {
    BanIcon,
    CheckIcon,
    ClockIcon,
    CopyIcon,
    ExternalLinkIcon,
    MailIcon,
    MapPinIcon,
    MessageSquareIcon,
    MousePointerIcon,
    PencilIcon,
    RefreshCwIcon,
    SettingsIcon,
    Share2Icon,
    ShieldCheckIcon,
    UserIcon,
    UserMinusIcon,
    UsersIcon,
    VolumeXIcon,
    XIcon
} from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

import { useI18n } from '@/app/hooks/use-i18n.js';
import { FavoriteActionMenu } from '@/components/favorites/FavoriteActionMenu.jsx';
import {
    convertFileUrlToImageUrl,
    copyTextToClipboard,
    openExternalLink,
    userImage
} from '@/lib/entityMedia.js';
import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import {
    userStatusIndicatorClassName
} from '@/lib/userStatus.js';
import { cn } from '@/lib/utils.js';
import { backend } from '@/platform/tauri/backend.js';
import {
    AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS,
    avatarProfileRepository,
    avatarSearchProviderRepository,
    groupProfileRepository,
    userProfileRepository,
    vrchatAuthRepository,
    vrchatFavoriteRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog
} from '@/services/dialogService.js';
import { isActionRecent } from '@/services/recentActionService.js';
import {
    getTranslationConfig,
    translateText
} from '@/services/translationService.js';
import { parseLocation } from '@/shared/utils/location.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Badge } from '@/ui/shadcn/badge';
import { Button } from '@/ui/shadcn/button';
import { Checkbox } from '@/ui/shadcn/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/ui/shadcn/field';
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/shadcn/popover';

import {
    EntityActionDropdown,
    EntityActionItem,
    EntityActionSeparator,
    EntityDialogHeader,
    EntityDialogScaffold,
    EntityDialogTabs
} from './EntityDialogScaffold.jsx';
import {
    firstNonGroupIdText,
    formatStatsDate,
    groupIdForRow,
    isGroupId,
    isOfflineLikeValue,
    normalizedText,
    resolveTabValue,
    summarizeEntityRow,
    userIdForRow
} from './user-dialog/userDialogRows.js';
import {
    isUserDialogDataTab,
    loadUserDialogTabData,
    userDialogDataKeyForTab
} from './user-dialog/userDialogTabService.js';
import {
    buildUserDialogListViewData,
    buildUserDialogProfileSummary
} from './user-dialog/userDialogViewData.js';
import {
    PreviousDisplayNamesBadge,
    SelfPreferenceCheckboxItem,
    UserTitleLanguages,
    downloadJsonFile
} from './user-dialog/UserDialogViewParts.jsx';
import {
    UserDialogActivityTab,
    UserDialogAvatarsTab,
    UserDialogFavoriteWorldsTab,
    UserDialogInstanceHistoryTab,
    UserDialogJsonTab,
    UserDialogMutualTab,
    UserDialogWorldsTab
} from './user-dialog/components/UserDialogDataTabs.jsx';
import { UserDialogGroupsTab } from './user-dialog/components/UserDialogGroupsTab.jsx';
import { UserDialogInfoTab } from './user-dialog/components/UserDialogInfoTab.jsx';
import { appI18n } from '@/services/i18nService.js';

const userDialogTabServiceRepositories = Object.freeze({
    avatarProfileRepository,
    avatarSearchProviderRepository,
    groupProfileRepository,
    userProfileRepository,
    vrchatFavoriteRepository,
    worldProfileRepository
});

let lastUserDialogTab = 'info';

const emptyUserDialogRemoteData = Object.freeze({
    groups: Object.freeze([]),
    mutual: Object.freeze([]),
    worlds: Object.freeze([]),
    favoriteWorldGroups: Object.freeze([]),
    favoriteWorlds: Object.freeze([]),
    avatars: Object.freeze([])
});

const emptyUserDialogStatus = Object.freeze({});

const emptyUserDialogSearch = Object.freeze({
    mutual: '',
    groups: '',
    worlds: '',
    favoriteWorlds: '',
    avatars: ''
});

export function UserDialogTabbedView({
    profile,
    memo,
    detail,
    imageUrl,
    loadStatus,
    actionStatus,
    recentActionVersion = 0,
    reloadToken = 0,
    moderationState,
    extendedModerationState = { interactOff: false, muteChat: false },
    avatarOverrideState = { hideAvatar: false, showAvatar: false },
    isCurrentUser,
    isFriend,
    isFavorite,
    friendRequestState,
    platform,
    platformIcon: PlatformIcon,
    presenceLocation,
    currentAvatarTarget,
    homeLocationTarget,
    canInviteFromCurrentLocation,
    currentUserHasSharedConnectionsOptOut,
    currentUserBoopingEnabled,
    userStats = {},
    previousInstances = [],
    representedGroup = null,
    representedGroupStatus = 'idle',
    hideUserNotes = false,
    hideUserMemos = false,
    onPreviousInstancesChange,
    sameInstanceUsers = [],
    locationOwnerUser = null,
    locationOwnerGroup = null,
    locationInstance = null,
    locationFriendCount = 0,
    locationPlayerCount = 0,
    onRefreshLocation,
    onRefresh,
    onEditMemo,
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
    onReportHacking,
    onGroupModeration,
    onEditSelfStatus,
    onEditSelfLanguages,
    onEditSelfBio,
    onEditSelfBioLinks,
    onEditSelfPronouns,
    onToggleSelfAvatarCopying,
    onToggleSelfBooping,
    onToggleSelfSharedConnections,
    onToggleSelfDiscordConnections,
    onToggleBadgeVisibility,
    onToggleBadgeShowcased
}) {
    const { t } = useI18n();
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const inGameGroupOrder = useRuntimeStore(
        (state) => state.groupInstances.groupOrder
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const openImagePreview = useModalStore((state) => state.openImagePreview);
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const [activeTab, setActiveTab] = useState('info');
    const [remoteData, setRemoteData] = useState(emptyUserDialogRemoteData);
    const [remoteStatus, setRemoteStatus] = useState(emptyUserDialogStatus);
    const [remoteErrors, setRemoteErrors] = useState(emptyUserDialogStatus);
    const [search, setSearch] = useState(emptyUserDialogSearch);
    const [worldSort, setWorldSort] = useState('updated');
    const [worldOrder, setWorldOrder] = useState('descending');
    const [avatarSort, setAvatarSort] = useState('name');
    const [avatarReleaseStatus, setAvatarReleaseStatus] = useState('all');
    const [mutualSort, setMutualSort] = useState('alphabetical');
    const [groupSort, setGroupSort] = useState(
        isCurrentUser ? 'inGame' : 'alphabetical'
    );
    const [vrchatConfigConstants, setVrchatConfigConstants] = useState(null);
    const [bioTranslation, setBioTranslation] = useState({
        userId: '',
        source: '',
        text: ''
    });
    const [bioTranslationLoading, setBioTranslationLoading] = useState(false);
    const [groupActionId, setGroupActionId] = useState('');
    const [groupEditMode, setGroupEditMode] = useState(false);
    const [selectedGroupIds, setSelectedGroupIds] = useState(() => new Set());
    const effectiveAvatarReleaseStatus =
        profile.id === currentUserId ? avatarReleaseStatus : 'all';
    const loadContextRef = useRef({
        endpoint: currentEndpoint,
        userId: profile.id,
        reloadToken
    });
    const handledReloadTokenRef = useRef(reloadToken);
    const {
        profileGroups,
        mutualFriends,
        profileWorlds,
        favoriteWorlds,
        profileAvatars,
        bioLinks,
        filteredMutualFriends,
        visibleMutualFriends,
        effectiveGroupSort,
        sortedProfileGroups,
        filteredProfileGroups,
        selectedUserGroups,
        filteredProfileWorlds,
        filteredFavoriteWorlds,
        visibleProfileAvatars,
        tabs,
        groupSearchActive
    } = useMemo(
        () =>
            buildUserDialogListViewData({
                profile,
                remoteData,
                remoteStatus,
                friendsById,
                search,
                mutualSort,
                groupSort,
                isCurrentUser,
                inGameGroupOrder,
                selectedGroupIds,
                effectiveAvatarReleaseStatus,
                avatarSort,
                currentUserHasSharedConnectionsOptOut
            }),
        [
            avatarSort,
            currentUserHasSharedConnectionsOptOut,
            effectiveAvatarReleaseStatus,
            friendsById,
            groupSort,
            inGameGroupOrder,
            isCurrentUser,
            mutualSort,
            profile,
            remoteData,
            remoteStatus,
            search,
            selectedGroupIds
        ]
    );
    const isRecentDialogAction = (actionType) =>
        recentActionVersion >= 0 && isActionRecent(profile.id, actionType);
    const recentDialogShortcut = (actionType) =>
        isRecentDialogAction(actionType) ? (
            <ClockIcon className="text-muted-foreground size-3.5" />
        ) : null;
    useEffect(() => {
        loadContextRef.current = {
            endpoint: currentEndpoint,
            userId: profile.id,
            reloadToken,
            worldSort,
            worldOrder,
            avatarSort,
            avatarReleaseStatus: effectiveAvatarReleaseStatus
        };
        setRemoteData(emptyUserDialogRemoteData);
        setRemoteStatus(emptyUserDialogStatus);
        setRemoteErrors(emptyUserDialogStatus);
        setSearch(emptyUserDialogSearch);
        const nextTab = resolveTabValue(tabs, lastUserDialogTab);
        lastUserDialogTab = nextTab;
        setActiveTab(nextTab);
    }, [
        currentEndpoint,
        currentUserHasSharedConnectionsOptOut,
        isCurrentUser,
        profile.id,
        reloadToken
    ]);

    useLayoutEffect(() => {
        setAvatarSort('name');
        setAvatarReleaseStatus('all');
    }, [currentUserId, profile.id]);

    function isCurrentLoadContext(context) {
        return (
            loadContextRef.current.endpoint === context.endpoint &&
            loadContextRef.current.userId === context.userId &&
            loadContextRef.current.reloadToken === context.reloadToken &&
            (context.tab !== 'worlds' ||
                (context.worldSort === worldSort &&
                    context.worldOrder === worldOrder)) &&
            (context.tab !== 'avatars' ||
                (context.avatarSort === avatarSort &&
                    context.avatarReleaseStatus ===
                        effectiveAvatarReleaseStatus))
        );
    }

    async function loadTab(tab, { force = false } = {}) {
        if (
            !profile.id ||
            (!force &&
                (remoteStatus[tab] === 'running' ||
                    remoteStatus[tab] === 'ready'))
        ) {
            return;
        }
        if (!isUserDialogDataTab(tab)) {
            return;
        }

        const loadContext = {
            endpoint: currentEndpoint,
            userId: profile.id,
            reloadToken,
            tab,
            worldSort,
            worldOrder,
            avatarSort,
            avatarReleaseStatus: effectiveAvatarReleaseStatus
        };
        setRemoteStatus((current) => ({ ...current, [tab]: 'running' }));
        setRemoteErrors((current) => ({ ...current, [tab]: '' }));
        try {
            const { rows, favoriteWorldGroups } = await loadUserDialogTabData({
                tab,
                userId: profile.id,
                endpoint: currentEndpoint,
                currentUserId,
                worldSort,
                worldOrder,
                avatarSort,
                effectiveAvatarReleaseStatus,
                repositories: userDialogTabServiceRepositories
            });

            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            const dataKey = userDialogDataKeyForTab(tab);
            setRemoteData((current) => ({
                ...current,
                [dataKey]: rows,
                ...(tab === 'favorite-worlds' ? { favoriteWorldGroups } : {})
            }));
            setRemoteStatus((current) => ({ ...current, [tab]: 'ready' }));
        } catch (error) {
            if (!isCurrentLoadContext(loadContext)) {
                return;
            }
            setRemoteStatus((current) => ({ ...current, [tab]: 'error' }));
            setRemoteErrors((current) => ({
                ...current,
                [tab]:
                    error instanceof Error
                        ? error.message
                        : 'Failed to load tab data.'
            }));
        }
    }

    function changeTab(tab) {
        lastUserDialogTab = resolveTabValue(tabs, tab);
        setActiveTab(lastUserDialogTab);
    }

    function changeWorldSort(value) {
        loadContextRef.current = {
            ...loadContextRef.current,
            worldSort: value
        };
        setWorldSort(value);
        setRemoteStatus((current) => ({ ...current, worlds: '' }));
    }

    function changeWorldOrder(value) {
        loadContextRef.current = {
            ...loadContextRef.current,
            worldOrder: value
        };
        setWorldOrder(value);
        setRemoteStatus((current) => ({ ...current, worlds: '' }));
    }

    function changeAvatarSort(value) {
        loadContextRef.current = {
            ...loadContextRef.current,
            avatarSort: value
        };
        setAvatarSort(value);
        if (profile.id === currentUserId) {
            setRemoteStatus((current) => ({ ...current, avatars: '' }));
        }
    }

    function changeAvatarReleaseStatus(value) {
        loadContextRef.current = {
            ...loadContextRef.current,
            avatarReleaseStatus: value
        };
        setAvatarReleaseStatus(value);
        if (profile.id === currentUserId) {
            setRemoteStatus((current) => ({ ...current, avatars: '' }));
        }
    }

    useEffect(() => {
        const shouldForceReload =
            reloadToken > 0 && handledReloadTokenRef.current !== reloadToken;
        if (shouldForceReload) {
            handledReloadTokenRef.current = reloadToken;
        }
        void loadTab(activeTab, { force: shouldForceReload });
    }, [activeTab, currentEndpoint, currentUserId, profile.id, reloadToken]);

    useEffect(() => {
        let active = true;
        vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint })
            .then((response) => {
                if (active) {
                    setVrchatConfigConstants(response?.json?.constants || null);
                }
            })
            .catch(() => {
                if (active) {
                    setVrchatConfigConstants(null);
                }
            });
        return () => {
            active = false;
        };
    }, [currentEndpoint]);

    useEffect(() => {
        if (activeTab === 'worlds') {
            void loadTab('worlds', { force: true });
        }
    }, [worldOrder, worldSort]);

    useEffect(() => {
        if (activeTab === 'avatars' && profile.id === currentUserId) {
            void loadTab('avatars', { force: true });
        }
    }, [avatarReleaseStatus, avatarSort]);

    useEffect(
        () =>
            onPreferenceChanged(AVATAR_SEARCH_PROVIDER_PREFERENCE_KEYS, () => {
                if (profile.id === currentUserId) {
                    return;
                }
                setRemoteData((current) => ({ ...current, avatars: [] }));
                setRemoteStatus((current) => ({ ...current, avatars: '' }));
                setRemoteErrors((current) => ({ ...current, avatars: '' }));
                if (activeTab === 'avatars') {
                    void loadTab('avatars', { force: true });
                }
            }),
        [
            activeTab,
            avatarReleaseStatus,
            avatarSort,
            currentEndpoint,
            currentUserId,
            profile.id
        ]
    );

    useEffect(() => {
        setBioTranslation({
            userId: profile.id || '',
            source: profile.bio || '',
            text: ''
        });
        setBioTranslationLoading(false);
    }, [profile.id, profile.bio]);

    useEffect(() => {
        setGroupEditMode(false);
        setSelectedGroupIds(new Set());
        setMutualSort('alphabetical');
        setGroupSort(isCurrentUser ? 'inGame' : 'alphabetical');
    }, [currentUserId, profile.id]);

    const userUrl = profile.id
        ? `https://vrchat.com/home/user/${profile.id}`
        : '';
    const username =
        profile.username && profile.username !== profile.id
            ? profile.username
            : '';
    const userSubtitle = username;
    const pronounsText = Array.isArray(profile.pronouns)
        ? profile.pronouns.join(', ')
        : profile.pronouns;
    const {
        previousDisplayNames,
        statusStateText,
        userGroupSections,
        selectedGroupCount,
        ownGroupCountText,
        remainingGroupCountText,
        userTimeSpent,
        userJoinCount,
        lastSeen,
        profileLanguages,
        mutualFriendCount,
        friendNumber
    } = buildUserDialogProfileSummary({
        profile,
        userStats,
        sortedProfileGroups,
        selectedUserGroups,
        mutualFriends,
        isCurrentUser,
        vrchatConfigConstants,
        currentUserSnapshot
    });
    const statusIndicatorClassName = userStatusIndicatorClassName(profile, {
        showOffline: true
    });
    const currentAvatarDisplayName = String(
        profile.currentAvatarName || profile.avatarName || ''
    ).trim();
    const currentAvatarDialogArgs = {
        avatarId: currentAvatarTarget,
        ...(currentAvatarDisplayName
            ? {
                  title: currentAvatarDisplayName,
                  seedData: {
                      id: currentAvatarTarget,
                      name: currentAvatarDisplayName,
                      imageUrl: profile.currentAvatarImageUrl || '',
                      thumbnailImageUrl:
                          profile.currentAvatarThumbnailImageUrl || ''
                  }
              }
            : {})
    };
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
        profile.worldName ||
            profile.$worldName ||
            profile.$location?.worldName ||
            profile.$location?.name ||
            profile.$location?.world?.name
    );
    const translatedBioActive = Boolean(
        bioTranslation.userId === profile.id &&
        bioTranslation.source === (profile.bio || '') &&
        bioTranslation.text
    );
    const visibleBio = translatedBioActive
        ? bioTranslation.text
        : profile.bio || '—';
    const locationUsers = [];
    const locationUserRowsByKey = new Map();

    function addLocationUser(user, subtitle = '') {
        if (!user) {
            return;
        }
        const source =
            typeof user === 'string'
                ? { id: user, userId: user, displayName: user }
                : user;
        const userId = normalizedText(
            source.id || source.userId || source.targetUserId
        );
        const displayName = normalizedText(
            source.displayName || source.username || source.name || userId
        );
        const key =
            userId ||
            `display:${displayName.toLowerCase()}:${locationUsers.length}`;
        if (!key) {
            return;
        }

        const existing = locationUserRowsByKey.get(key);
        if (existing) {
            if (subtitle && !existing.$subtitle) {
                existing.$subtitle = subtitle;
            }
            if (source.$userColour && !existing.$userColour) {
                existing.$userColour = source.$userColour;
            }
            return;
        }

        const row = {
            ...source,
            id: userId || source.id,
            userId: source.userId || userId,
            displayName,
            $subtitle: subtitle || source.$subtitle || source.subtitle || ''
        };
        locationUserRowsByKey.set(key, row);
        locationUsers.push(row);
    }

    addLocationUser(locationOwnerUser, t('dialog.user.info.instance_creator'));
    for (const user of sameInstanceUsers) {
        addLocationUser(user);
    }
    if (
        visiblePresenceParsedLocation?.isRealInstance &&
        !sameInstanceUsers.length
    ) {
        addLocationUser(profile);
    }
    const locationOwnerFallbackId = normalizedText(
        visiblePresenceParsedLocation?.userId ||
            locationInstance?.ownerUserId ||
            locationInstance?.owner_user_id ||
            locationInstance?.ownerId ||
            locationInstance?.owner_id ||
            locationInstance?.userId ||
            locationInstance?.user_id ||
            locationInstance?.groupId ||
            locationInstance?.group_id ||
            locationInstance?.group?.id ||
            visiblePresenceParsedLocation?.groupId
    );
    const locationOwnerUserId = userIdForRow(locationOwnerUser);
    const locationOwnerGroupId = groupIdForRow(locationOwnerGroup);
    const locationOwnerIsGroup = Boolean(
        locationOwnerGroupId ||
        isGroupId(locationOwnerFallbackId) ||
        isGroupId(locationOwnerUserId)
    );
    const locationOwnerId =
        locationOwnerGroupId ||
        (locationOwnerIsGroup
            ? locationOwnerFallbackId || locationOwnerUserId
            : locationOwnerUserId) ||
        locationOwnerFallbackId;
    const locationOwnerName = locationOwnerIsGroup
        ? firstNonGroupIdText(
              locationOwnerGroup?.name,
              locationOwnerGroup?.displayName,
              locationOwnerGroup?.display_name,
              locationOwnerGroup?.shortCode,
              locationInstance?.groupName,
              locationInstance?.group_name,
              locationInstance?.group?.name,
              profile?.$location?.groupName,
              profile?.$location?.group_name,
              profile?.$location?.group?.name,
              locationOwnerUser?.displayName,
              locationOwnerUser?.username,
              locationOwnerUser?.name,
              locationOwnerId
          )
        : normalizedText(
              locationOwnerUser?.displayName ||
                  locationOwnerUser?.username ||
                  locationOwnerUser?.name ||
                  locationOwnerId
          );
    const locationOwnerRow =
        !locationOwnerIsGroup && locationOwnerUser
            ? {
                  ...locationOwnerUser,
                  $subtitle: t('dialog.user.info.instance_creator')
              }
            : !locationOwnerIsGroup && locationOwnerId
              ? {
                    id: locationOwnerId,
                    userId: locationOwnerId,
                    displayName: locationOwnerName,
                    $subtitle: t('dialog.user.info.instance_creator')
                }
              : null;
    const locationPlayerUsers =
        locationOwnerId && !locationOwnerIsGroup
            ? locationUsers.filter(
                  (user) => userIdForRow(user) !== locationOwnerId
              )
            : locationUsers;
    const locationInstanceUsers = locationOwnerRow
        ? [locationOwnerRow, ...locationPlayerUsers]
        : locationPlayerUsers;

    async function copyUserText(text, label) {
        await copyTextToClipboard(text);
        toast.success(appI18n.t('dialog.user.generated_dynamic.value_copied', { value: label }));
    }

    async function openDiscordProfile(discordId) {
        try {
            await backend.discord.OpenDiscordProfile(discordId);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_open_discord_profile')
            );
        }
    }

    async function toggleBioTranslation() {
        if (!profile.bio || bioTranslationLoading) {
            return;
        }
        if (translatedBioActive) {
            setBioTranslation({
                userId: profile.id || '',
                source: profile.bio || '',
                text: ''
            });
            return;
        }

        setBioTranslationLoading(true);
        try {
            const config = await getTranslationConfig();
            const translated = await translateText(
                profile.bio,
                config.bioLanguage,
                config
            );
            if (!translated) {
                throw new Error('No translation returned.');
            }
            setBioTranslation({
                userId: profile.id || '',
                source: profile.bio || '',
                text: translated
            });
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : appI18n.t('dialog.user.generated_toast.translation_failed')
            );
        } finally {
            setBioTranslationLoading(false);
        }
    }

    async function showAvatarAuthor() {
        if (!currentAvatarTarget) {
            return;
        }
        try {
            const avatar = await avatarProfileRepository.getAvatarProfile({
                avatarId: currentAvatarTarget,
                endpoint: currentEndpoint
            });
            if (avatar.authorId) {
                openUserDialog({
                    userId: avatar.authorId,
                    title: avatar.authorName || undefined
                });
                return;
            }
            toast.error(t('dialog.user.generated.avatar_author_unavailable'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_load_avatar_author')
            );
        }
    }

    async function inviteToGroup() {
        if (!profile.id) {
            return;
        }
        const result = await prompt({
            title: appI18n.t('dialog.user.generated_modal.invite_to_group'),
            description: appI18n.t('dialog.user.generated_modal.enter_the_vrchat_group_id_to_invite_this_user_to'),
            inputValue: '',
            confirmText: appI18n.t('dialog.user.generated_modal.invite'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        try {
            await groupProfileRepository.sendGroupInvite({
                groupId: result.value,
                userId: profile.id,
                endpoint: currentEndpoint
            });
            toast.success(t('dialog.user.generated.group_invite_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_send_group_invite')
            );
        }
    }

    async function refreshGroupsAfterMembershipChange() {
        setRemoteStatus((current) => ({ ...current, groups: '' }));
        setRemoteData((current) => ({ ...current, groups: [] }));
        await loadTab('groups', { force: true });
    }

    async function changeGroupVisibility(group, visibility) {
        const groupId = groupIdForRow(group);
        if (!groupId || !currentUserId || groupActionId) {
            return;
        }
        setGroupActionId(groupId);
        try {
            await groupProfileRepository.setGroupMemberProps({
                groupId,
                userId: currentUserId,
                endpoint: currentEndpoint,
                params: { visibility }
            });
            toast.success(t('dialog.user.generated.group_visibility_updated'));
            await refreshGroupsAfterMembershipChange();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_update_group_visibility')
            );
        } finally {
            setGroupActionId('');
        }
    }

    async function leaveUserGroup(group) {
        const groupId = groupIdForRow(group);
        if (!groupId || groupActionId) {
            return;
        }
        const result = await confirm({
            title: appI18n.t('dialog.user.generated_modal.leave_group'),
            description: appI18n.t('dialog.user.generated_dynamic.leave_value', { value: summarizeEntityRow(group, groupId) }),
            confirmText: appI18n.t('dialog.user.generated_modal.leave'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        setGroupActionId(groupId);
        try {
            await groupProfileRepository.leaveGroup({
                groupId,
                endpoint: currentEndpoint
            });
            toast.success(t('dialog.user.generated.left_group'));
            await refreshGroupsAfterMembershipChange();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_leave_group')
            );
        } finally {
            setGroupActionId('');
        }
    }

    function setGroupSelected(group, selected) {
        const groupId = groupIdForRow(group);
        if (!groupId) {
            return;
        }
        setSelectedGroupIds((current) => {
            const next = new Set(current);
            if (selected) {
                next.add(groupId);
            } else {
                next.delete(groupId);
            }
            return next;
        });
    }

    function selectVisibleGroups(rows) {
        setSelectedGroupIds((current) => {
            const next = new Set(current);
            for (const group of rows) {
                const groupId = groupIdForRow(group);
                if (groupId) {
                    next.add(groupId);
                }
            }
            return next;
        });
    }

    function clearSelectedGroups() {
        setSelectedGroupIds(new Set());
    }

    function exportUserGroups(rows) {
        const groups = rows.length ? rows : profileGroups;
        if (!groups.length) {
            toast.error(t('dialog.user.generated.no_groups_to_export'));
            return;
        }
        const filenameUser =
            normalizedText(
                profile.username || profile.displayName || profile.id
            ).replace(/[^a-z0-9_-]+/gi, '_') || 'user';
        downloadJsonFile(`vrcx-${filenameUser}-groups.json`, groups);
        toast.success(appI18n.t('dialog.user.generated_dynamic.exported_value_groups', { value: groups.length }));
    }

    async function changeSelectedGroupsVisibility(visibility) {
        if (!selectedUserGroups.length || !currentUserId || groupActionId) {
            return;
        }
        setGroupActionId('__bulk_groups__');
        try {
            const results = await Promise.allSettled(
                selectedUserGroups.map((group) =>
                    groupProfileRepository.setGroupMemberProps({
                        groupId: groupIdForRow(group),
                        userId: currentUserId,
                        endpoint: currentEndpoint,
                        params: { visibility }
                    })
                )
            );
            const failed = results.filter(
                (result) => result.status === 'rejected'
            ).length;
            if (failed) {
                toast.error(appI18n.t('dialog.user.generated_dynamic.failed_to_update_value_groups', { value: failed }));
            } else {
                toast.success(appI18n.t('dialog.user.generated_dynamic.updated_value_groups', { value: selectedUserGroups.length }));
            }
            await refreshGroupsAfterMembershipChange();
        } finally {
            setGroupActionId('');
        }
    }

    async function leaveSelectedGroups() {
        if (!selectedUserGroups.length || groupActionId) {
            return;
        }
        const result = await confirm({
            title: appI18n.t('dialog.user.generated_modal.leave_selected_groups'),
            description: appI18n.t('dialog.user.generated_dynamic.leave_value_selected_groups', { value: selectedUserGroups.length }),
            confirmText: appI18n.t('dialog.user.generated_modal.leave'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }
        setGroupActionId('__bulk_groups__');
        try {
            const results = await Promise.allSettled(
                selectedUserGroups.map((group) =>
                    groupProfileRepository.leaveGroup({
                        groupId: groupIdForRow(group),
                        endpoint: currentEndpoint
                    })
                )
            );
            const failed = results.filter(
                (entry) => entry.status === 'rejected'
            ).length;
            if (failed) {
                toast.error(appI18n.t('dialog.user.generated_dynamic.failed_to_leave_value_groups', { value: failed }));
            } else {
                toast.success(appI18n.t('dialog.user.generated_dynamic.left_value_groups', { value: selectedUserGroups.length }));
                clearSelectedGroups();
            }
            await refreshGroupsAfterMembershipChange();
        } finally {
            setGroupActionId('');
        }
    }

    function editableGroupOrder() {
        const nextOrder = [];
        const seen = new Set();
        const pushGroupId = (groupId) => {
            const normalizedGroupId = normalizedText(groupId);
            if (!normalizedGroupId || seen.has(normalizedGroupId)) {
                return;
            }
            seen.add(normalizedGroupId);
            nextOrder.push(normalizedGroupId);
        };
        for (const groupId of inGameGroupOrder || []) {
            pushGroupId(groupId);
        }
        for (const group of profileGroups) {
            pushGroupId(groupIdForRow(group));
        }
        return nextOrder;
    }

    async function moveGroupInGameOrder(group, direction) {
        const groupId = groupIdForRow(group);
        if (!isCurrentUser || !currentUserId || !groupId || groupActionId) {
            return;
        }
        const previousOrder = editableGroupOrder();
        const index = previousOrder.indexOf(groupId);
        if (index === -1) {
            return;
        }
        const nextOrder = previousOrder.slice();
        nextOrder.splice(index, 1);
        let nextIndex = index;
        if (direction === 'top') {
            nextIndex = 0;
        } else if (direction === 'bottom') {
            nextIndex = nextOrder.length;
        } else if (direction === 'up') {
            nextIndex = Math.max(0, index - 1);
        } else if (direction === 'down') {
            nextIndex = Math.min(nextOrder.length, index + 1);
        }
        nextOrder.splice(nextIndex, 0, groupId);
        if (previousOrder.join('\u0000') === nextOrder.join('\u0000')) {
            return;
        }
        setGroupActionId(groupId);
        useRuntimeStore
            .getState()
            .setGroupInstancesState({ groupOrder: nextOrder });
        setGroupSort('inGame');
        try {
            await backend.app.SetVRChatRegistryKey(
                `VRC_GROUP_ORDER_${currentUserId}`,
                JSON.stringify(nextOrder),
                3
            );
            toast.success(t('dialog.user.generated.group_order_updated'));
        } catch (error) {
            useRuntimeStore
                .getState()
                .setGroupInstancesState({ groupOrder: previousOrder });
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_update_group_order')
            );
        } finally {
            setGroupActionId('');
        }
    }

    return (
        <EntityDialogScaffold>
            <EntityDialogHeader
                imageUrl={imageUrl}
                imageAlt={profile.displayName || profile.id || 'User'}
                imageClassName="aspect-[4/3] w-40"
                onImageClick={
                    imageUrl
                        ? () =>
                              openImagePreview({
                                  url: imageUrl,
                                  title:
                                      profile.displayName ||
                                      profile.username ||
                                      'User'
                              })
                        : null
                }
                imagePlaceholder={
                    <UsersIcon className="text-muted-foreground size-8" />
                }
                titlePrefix={
                    statusIndicatorClassName ? (
                        <i
                            className={statusIndicatorClassName}
                            title={statusStateText || undefined}
                        />
                    ) : null
                }
                title={profile.displayName || profile.username || 'User'}
                onTitleClick={
                    profile.displayName || profile.username
                        ? () =>
                              void copyUserText(
                                  profile.displayName || profile.username,
                                  'Display name'
                              )
                        : undefined
                }
                titleMeta={
                    <>
                        {pronounsText ? (
                            <span
                                className="text-muted-foreground shrink-0 font-mono text-xs font-normal"
                                title={t('dialog.user.pronouns')}
                            >
                                {pronounsText}
                            </span>
                        ) : null}
                        <UserTitleLanguages languages={profileLanguages} />
                        <PreviousDisplayNamesBadge
                            names={previousDisplayNames}
                        />
                    </>
                }
                subtitle={userSubtitle}
                onSubtitleClick={
                    username
                        ? () => void copyUserText(username, 'Username')
                        : undefined
                }
                description={profile.statusDescription}
                detail={detail}
                badges={
                    <>
                        {profile.$isModerator ? (
                            <Badge variant="secondary">
                                <ShieldCheckIcon data-icon="inline-start" />
                                {t('dialog.user.generated.moderator')}
                            </Badge>
                        ) : null}
                        {profile.$isTroll ? (
                            <Badge variant="destructive">{t('view.settings.appearance.user_colors.trust_levels.nuisance')}</Badge>
                        ) : null}
                        {profile.$isProbableTroll ? (
                            <Badge variant="outline">{t('view.favorite.avatars.almost_nuisance')}</Badge>
                        ) : null}
                        {profile.$customTag ? (
                            <Badge
                                variant="outline"
                                style={
                                    profile.$customTagColour
                                        ? {
                                              color: profile.$customTagColour,
                                              borderColor:
                                                  profile.$customTagColour
                                          }
                                        : undefined
                                }
                            >
                                {profile.$customTag}
                            </Badge>
                        ) : null}
                        {profile.ageVerified ? (
                            <Badge variant="outline">18+</Badge>
                        ) : null}
                        {friendNumber ? (
                            <Badge variant="outline">
                                {t('dialog.user.generated.friend')}{friendNumber}
                            </Badge>
                        ) : null}
                        {mutualFriendCount ? (
                            <Badge variant="outline">
                                {mutualFriendCount} {t('dialog.user.generated.mutual')}
                            </Badge>
                        ) : null}
                        {moderationState.block ? (
                            <Badge variant="destructive">{t('dialog.user.generated.blocked')}</Badge>
                        ) : null}
                        {moderationState.mute ? (
                            <Badge variant="destructive">{t('dialog.user.generated.muted')}</Badge>
                        ) : null}
                        <Badge variant="outline">
                            {profile.$trustLevel || 'Visitor'}
                        </Badge>
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
                                onClick={() =>
                                    void openDiscordProfile(profile.discordId)
                                }
                            >
                                {t('dialog.user.generated.discord')}
                            </Button>
                        ) : null}
                    </>
                }
                mediaBadges={
                    <>
                        {Array.isArray(profile.badges)
                            ? profile.badges
                                  .filter((badge) => badge?.badgeImageUrl)
                                  .map((badge) => (
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
                                                  title={appI18n.t('dialog.user.generated_dynamic.value_value', { value: badge.badgeName || 'Badge', value2: badge.hidden ? ' (Hidden)' : '' })}
                                                  className="size-8 rounded-sm p-0"
                                                  onClick={(event) =>
                                                      event.stopPropagation()
                                                  }
                                              >
                                                  <img
                                                      src={badge.badgeImageUrl}
                                                      alt={
                                                          badge.badgeName || ''
                                                      }
                                                      className={cn(
                                                          'size-8 rounded-sm object-cover',
                                                          badge.hidden &&
                                                              'grayscale'
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
                                                      openImagePreview({
                                                          url: badge.badgeImageUrl,
                                                          title:
                                                              badge.badgeName ||
                                                              profile.displayName ||
                                                              profile.username ||
                                                              'Badge'
                                                      })
                                                  }
                                              >
                                                  <img
                                                      src={badge.badgeImageUrl}
                                                      alt={
                                                          badge.badgeName || ''
                                                      }
                                                      className="max-h-56 w-full rounded-md object-contain"
                                                  />
                                              </Button>
                                              <div className="flex flex-col gap-1 text-sm">
                                                  <div className="font-medium">
                                                      {badge.badgeName ||
                                                          'Badge'}
                                                      {badge.hidden ? (
                                                          <span className="text-muted-foreground ml-1 text-xs">
                                                              (Hidden)
                                                          </span>
                                                      ) : null}
                                                  </div>
                                                  {badge.badgeDescription ? (
                                                      <div className="text-muted-foreground text-xs">
                                                          {
                                                              badge.badgeDescription
                                                          }
                                                      </div>
                                                  ) : null}
                                                  {badge.assignedAt ? (
                                                      <div className="text-muted-foreground font-mono text-xs">
                                                          {t('dialog.user.generated.assigned')}{' '}
                                                          {formatStatsDate(
                                                              badge.assignedAt
                                                          )}
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
                                                              checked={Boolean(
                                                                  badge.hidden
                                                              )}
                                                              disabled={
                                                                  actionStatus !==
                                                                      'idle' ||
                                                                  !onToggleBadgeVisibility
                                                              }
                                                              aria-label={"Hidden"}
                                                              onCheckedChange={(
                                                                  checked
                                                              ) =>
                                                                  onToggleBadgeVisibility?.(
                                                                      badge,
                                                                      Boolean(
                                                                          checked
                                                                      )
                                                                  )
                                                              }
                                                          />
                                                          <FieldLabel>
                                                              {t('dialog.user.generated.hidden')}
                                                          </FieldLabel>
                                                      </Field>
                                                      <Field orientation="horizontal">
                                                          <Checkbox
                                                              checked={Boolean(
                                                                  badge.showcased
                                                              )}
                                                              disabled={
                                                                  actionStatus !==
                                                                      'idle' ||
                                                                  !onToggleBadgeShowcased
                                                              }
                                                              aria-label={"Showcased"}
                                                              onCheckedChange={(
                                                                  checked
                                                              ) =>
                                                                  onToggleBadgeShowcased?.(
                                                                      badge,
                                                                      Boolean(
                                                                          checked
                                                                      )
                                                                  )
                                                              }
                                                          />
                                                          <FieldLabel>
                                                              {t('dialog.user.badges.showcased')}
                                                          </FieldLabel>
                                                      </Field>
                                                  </FieldGroup>
                                              ) : null}
                                          </PopoverContent>
                                      </Popover>
                                  ))
                            : null}
                    </>
                }
                actions={
                    <>
                        {profile.userIcon ? (
                            <Button
                                type="button"
                                variant="ghost"
                                className="bg-muted size-[120px] shrink-0 overflow-hidden rounded-md border p-0"
                                onClick={() =>
                                    openImagePreview({
                                        url: convertFileUrlToImageUrl(
                                            profile.userIcon,
                                            512
                                        ),
                                        title:
                                            profile.displayName ||
                                            profile.username ||
                                            'User'
                                    })
                                }
                            >
                                <img
                                    src={userImage(profile, true, '256', true)}
                                    alt=""
                                    className="size-full object-cover"
                                />
                            </Button>
                        ) : null}
                        {!isCurrentUser ? (
                            <FavoriteActionMenu
                                kind="friend"
                                entityId={profile.id}
                                entity={profile}
                            />
                        ) : null}
                        <EntityActionDropdown
                            busy={
                                loadStatus === 'running' ||
                                actionStatus !== 'idle'
                            }
                            dangerous={
                                moderationState.block || moderationState.mute
                            }
                            indicator={
                                friendRequestState.incoming ||
                                friendRequestState.outgoing
                            }
                        >
                            <EntityActionItem
                                icon={RefreshCwIcon}
                                disabled={loadStatus === 'running'}
                                onSelect={onRefresh}
                            >
                                {t('common.actions.refresh')}
                            </EntityActionItem>
                            {userUrl ? (
                                <>
                                    <EntityActionItem
                                        icon={Share2Icon}
                                        onSelect={() =>
                                            void copyUserText(
                                                userUrl,
                                                'User URL'
                                            )
                                        }
                                    >
                                        {t('dialog.user.generated.share_copy_url')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={ExternalLinkIcon}
                                        onSelect={() =>
                                            openExternalLink(userUrl)
                                        }
                                    >
                                        {t('dialog.user.generated.open_vrchat_page')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={CopyIcon}
                                        onSelect={() =>
                                            void copyUserText(
                                                profile.id,
                                                'User ID'
                                            )
                                        }
                                    >
                                        {t('dialog.user.generated.copy_user_id')}
                                    </EntityActionItem>
                                    <EntityActionSeparator />
                                </>
                            ) : null}
                            <EntityActionItem
                                icon={UserIcon}
                                onSelect={onEditMemo}
                            >
                                {t('dialog.user.generated.edit_note_memo')}
                            </EntityActionItem>
                            {currentAvatarTarget ? (
                                <EntityActionItem
                                    icon={UserIcon}
                                    onSelect={() => void showAvatarAuthor()}
                                >
                                    {t('dialog.user.actions.show_avatar_author')}
                                </EntityActionItem>
                            ) : null}
                            {fallbackAvatarTarget ? (
                                <EntityActionItem
                                    icon={UserIcon}
                                    onSelect={() =>
                                        openAvatarDialog(
                                            fallbackAvatarDialogArgs
                                        )
                                    }
                                >
                                    {t('dialog.user.actions.show_fallback_avatar')}
                                </EntityActionItem>
                            ) : null}
                            {isCurrentUser ? (
                                <>
                                    <EntityActionSeparator />
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onEditSelfStatus}
                                    >
                                        {t('dialog.user.generated.edit_social_status_2')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onEditSelfLanguages}
                                    >
                                        {t('dialog.user.generated.edit_language_2')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onEditSelfBio}
                                    >
                                        {t('dialog.user.generated.edit_bio')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onEditSelfBioLinks}
                                    >
                                        {t('dialog.user.generated.edit_bio_links')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={PencilIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onEditSelfPronouns}
                                    >
                                        {t('dialog.user.generated.edit_pronouns')}
                                    </EntityActionItem>
                                    <EntityActionSeparator />
                                    <SelfPreferenceCheckboxItem
                                        label={t('dialog.user.info.avatar_cloning')}
                                        checked={Boolean(
                                            profile.allowAvatarCopying
                                        )}
                                        disabled={actionStatus !== 'idle'}
                                        onToggle={onToggleSelfAvatarCopying}
                                    />
                                    <SelfPreferenceCheckboxItem
                                        label={t('dialog.user.info.booping')}
                                        checked={
                                            profile.isBoopingEnabled !== false
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onToggle={onToggleSelfBooping}
                                    />
                                    <SelfPreferenceCheckboxItem
                                        label={t('dialog.user.info.show_mutual_friends')}
                                        checked={
                                            !profile.hasSharedConnectionsOptOut
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onToggle={onToggleSelfSharedConnections}
                                    />
                                    <SelfPreferenceCheckboxItem
                                        label={t('dialog.user.info.show_discord_connections')}
                                        checked={
                                            !profile.hasDiscordFriendsOptOut
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onToggle={
                                            onToggleSelfDiscordConnections
                                        }
                                    />
                                </>
                            ) : null}
                            {!isCurrentUser ? (
                                <>
                                    <EntityActionSeparator />
                                    {!isFriend &&
                                    friendRequestState.incoming ? (
                                        <>
                                            <EntityActionItem
                                                icon={CheckIcon}
                                                disabled={
                                                    actionStatus !== 'idle'
                                                }
                                                onSelect={() =>
                                                    onFriendRequest('accept')
                                                }
                                            >
                                                {t('dialog.user.actions.accept_friend_request')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={XIcon}
                                                destructive
                                                disabled={
                                                    actionStatus !== 'idle'
                                                }
                                                onSelect={() =>
                                                    onFriendRequest('decline')
                                                }
                                            >
                                                {t('dialog.user.actions.decline_friend_request')}
                                            </EntityActionItem>
                                        </>
                                    ) : !isFriend &&
                                      friendRequestState.outgoing ? (
                                        <EntityActionItem
                                            icon={XIcon}
                                            disabled={actionStatus !== 'idle'}
                                            onSelect={() =>
                                                onFriendRequest('cancel')
                                            }
                                        >
                                            {t('dialog.user.actions.cancel_friend_request')}
                                        </EntityActionItem>
                                    ) : !isFriend ? (
                                        <EntityActionItem
                                            icon={UserIcon}
                                            shortcut={recentDialogShortcut(
                                                'Send Friend Request'
                                            )}
                                            disabled={actionStatus !== 'idle'}
                                            onSelect={() =>
                                                onFriendRequest('send')
                                            }
                                        >
                                            {t('dialog.user.actions.send_friend_request')}
                                        </EntityActionItem>
                                    ) : null}
                                    {isFriend ? (
                                        <>
                                            <EntityActionItem
                                                icon={MessageSquareIcon}
                                                shortcut={recentDialogShortcut(
                                                    'Invite'
                                                )}
                                                disabled={
                                                    actionStatus !== 'idle' ||
                                                    !canInviteFromCurrentLocation
                                                }
                                                onSelect={onInvite}
                                            >
                                                {t('dialog.user.generated.send_invite')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={MessageSquareIcon}
                                                shortcut={recentDialogShortcut(
                                                    'Invite Message'
                                                )}
                                                disabled={
                                                    actionStatus !== 'idle' ||
                                                    !canInviteFromCurrentLocation
                                                }
                                                onSelect={onInviteMessage}
                                            >
                                                {t('dialog.invite_message.header')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={MailIcon}
                                                shortcut={recentDialogShortcut(
                                                    'Request Invite'
                                                )}
                                                disabled={
                                                    actionStatus !== 'idle'
                                                }
                                                onSelect={onInviteRequest}
                                            >
                                                {t('dialog.user.generated.request_invite')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={MailIcon}
                                                shortcut={recentDialogShortcut(
                                                    'Request Invite Message'
                                                )}
                                                disabled={
                                                    actionStatus !== 'idle'
                                                }
                                                onSelect={
                                                    onInviteRequestMessage
                                                }
                                            >
                                                {t('dialog.invite_request_message.header')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={MousePointerIcon}
                                                disabled={
                                                    actionStatus !== 'idle' ||
                                                    !currentUserBoopingEnabled
                                                }
                                                onSelect={onBoop}
                                            >
                                                {t('dialog.user.generated.boop')}
                                            </EntityActionItem>
                                            <EntityActionItem
                                                icon={UserMinusIcon}
                                                destructive
                                                disabled={
                                                    actionStatus !== 'idle'
                                                }
                                                onSelect={onUnfriend}
                                            >
                                                {t('dialog.user.generated.unfriend')}
                                            </EntityActionItem>
                                        </>
                                    ) : null}
                                    <EntityActionItem
                                        icon={UsersIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() => void inviteToGroup()}
                                    >
                                        {t('dialog.user.generated.invite_to_group')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={SettingsIcon}
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onGroupModeration}
                                    >
                                        {t('dialog.user.actions.group_moderation')}
                                    </EntityActionItem>
                                    <EntityActionSeparator />
                                    <EntityActionItem
                                        icon={MapPinIcon}
                                        disabled={!previousInstances.length}
                                        onSelect={() =>
                                            changeTab('instance-history')
                                        }
                                    >
                                        {t('dialog.previous_instances.header')}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={BanIcon}
                                        destructive={moderationState.block}
                                        disabled={
                                            actionStatus !== 'idle' ||
                                            (!moderationState.block &&
                                                Boolean(profile.$isModerator))
                                        }
                                        onSelect={() =>
                                            onModeration(
                                                'block',
                                                !moderationState.block
                                            )
                                        }
                                    >
                                        {moderationState.block
                                            ? 'Unblock'
                                            : 'Block'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={VolumeXIcon}
                                        destructive={moderationState.mute}
                                        disabled={
                                            actionStatus !== 'idle' ||
                                            (!moderationState.mute &&
                                                Boolean(profile.$isModerator))
                                        }
                                        onSelect={() =>
                                            onModeration(
                                                'mute',
                                                !moderationState.mute
                                            )
                                        }
                                    >
                                        {moderationState.mute
                                            ? 'Unmute'
                                            : 'Mute'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={UserIcon}
                                        destructive={
                                            avatarOverrideState.hideAvatar
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() =>
                                            onAvatarOverride?.('hideAvatar')
                                        }
                                    >
                                        {avatarOverrideState.hideAvatar
                                            ? 'Reset Hidden Avatar'
                                            : 'Hide Avatar'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={UserIcon}
                                        destructive={
                                            avatarOverrideState.showAvatar
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() =>
                                            onAvatarOverride?.('showAvatar')
                                        }
                                    >
                                        {avatarOverrideState.showAvatar
                                            ? 'Reset Shown Avatar'
                                            : 'Show Avatar'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={BanIcon}
                                        destructive={
                                            extendedModerationState.interactOff
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() =>
                                            onExtendedModeration?.(
                                                'interactOff',
                                                !extendedModerationState.interactOff
                                            )
                                        }
                                    >
                                        {extendedModerationState.interactOff
                                            ? 'Enable Avatar Interaction'
                                            : 'Disable Avatar Interaction'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={VolumeXIcon}
                                        destructive={
                                            extendedModerationState.muteChat
                                        }
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={() =>
                                            onExtendedModeration?.(
                                                'muteChat',
                                                !extendedModerationState.muteChat
                                            )
                                        }
                                    >
                                        {extendedModerationState.muteChat
                                            ? 'Enable Chatbox'
                                            : 'Disable Chatbox'}
                                    </EntityActionItem>
                                    <EntityActionItem
                                        icon={BanIcon}
                                        destructive
                                        disabled={actionStatus !== 'idle'}
                                        onSelect={onReportHacking}
                                    >
                                        {t('dialog.user.generated.report_hacking')}
                                    </EntityActionItem>
                                </>
                            ) : null}
                        </EntityActionDropdown>
                    </>
                }
            />
            <EntityDialogTabs
                value={activeTab}
                onValueChange={changeTab}
                tabs={tabs}
            >
                <UserDialogInfoTab
                    visiblePresenceLocation={visiblePresenceLocation}
                    locationInstance={locationInstance}
                    locationOwnerId={locationOwnerId}
                    locationPlayerCount={locationPlayerCount}
                    currentUserId={currentUserId}
                    currentEndpoint={currentEndpoint}
                    locationWorldTitle={locationWorldTitle}
                    locationFriendCount={locationFriendCount}
                    previousInstances={previousInstances}
                    onRefreshLocation={onRefreshLocation}
                    changeTab={changeTab}
                    locationInstanceUsers={locationInstanceUsers}
                    profile={profile}
                    hideUserNotes={hideUserNotes}
                    onEditMemo={onEditMemo}
                    memo={memo}
                    hideUserMemos={hideUserMemos}
                    currentAvatarTarget={currentAvatarTarget}
                    currentAvatarDialogArgs={currentAvatarDialogArgs}
                    currentAvatarDisplayName={currentAvatarDisplayName}
                    openAvatarDialog={openAvatarDialog}
                    representedGroupStatus={representedGroupStatus}
                    representedGroup={representedGroup}
                    openGroupDialog={openGroupDialog}
                    visibleBio={visibleBio}
                    bioTranslationLoading={bioTranslationLoading}
                    translatedBioActive={translatedBioActive}
                    toggleBioTranslation={toggleBioTranslation}
                    bioLinks={bioLinks}
                    isCurrentUser={isCurrentUser}
                    lastSeen={lastSeen}
                    userTimeSpent={userTimeSpent}
                    userJoinCount={userJoinCount}
                    visibleHomeLocationTarget={visibleHomeLocationTarget}
                    copyUserText={copyUserText}
                    t={t}
                />
                <UserDialogMutualTab
                    mutualFriends={mutualFriends}
                    filteredMutualFriends={filteredMutualFriends}
                    visibleMutualFriends={visibleMutualFriends}
                    remoteStatus={remoteStatus}
                    remoteErrors={remoteErrors}
                    loadTab={loadTab}
                    search={search}
                    setSearch={setSearch}
                    mutualSort={mutualSort}
                    setMutualSort={setMutualSort}
                    t={t}
                />
                <UserDialogGroupsTab
                    profileGroups={profileGroups}
                    filteredProfileGroups={filteredProfileGroups}
                    remoteStatus={remoteStatus}
                    remoteErrors={remoteErrors}
                    loadTab={loadTab}
                    search={search}
                    setSearch={setSearch}
                    groupEditMode={groupEditMode}
                    effectiveGroupSort={effectiveGroupSort}
                    setGroupSort={setGroupSort}
                    isCurrentUser={isCurrentUser}
                    groupActionId={groupActionId}
                    setGroupEditMode={setGroupEditMode}
                    clearSelectedGroups={clearSelectedGroups}
                    selectVisibleGroups={selectVisibleGroups}
                    selectedGroupCount={selectedGroupCount}
                    changeSelectedGroupsVisibility={changeSelectedGroupsVisibility}
                    exportUserGroups={exportUserGroups}
                    selectedUserGroups={selectedUserGroups}
                    leaveSelectedGroups={leaveSelectedGroups}
                    groupSearchActive={groupSearchActive}
                    selectedGroupIds={selectedGroupIds}
                    changeGroupVisibility={changeGroupVisibility}
                    leaveUserGroup={leaveUserGroup}
                    moveGroupInGameOrder={moveGroupInGameOrder}
                    setGroupSelected={setGroupSelected}
                    userGroupSections={userGroupSections}
                    ownGroupCountText={ownGroupCountText}
                    remainingGroupCountText={remainingGroupCountText}
                    t={t}
                />
                <UserDialogWorldsTab
                    filteredProfileWorlds={filteredProfileWorlds}
                    profileWorlds={profileWorlds}
                    remoteStatus={remoteStatus}
                    remoteErrors={remoteErrors}
                    loadTab={loadTab}
                    search={search}
                    setSearch={setSearch}
                    worldSort={worldSort}
                    changeWorldSort={changeWorldSort}
                    worldOrder={worldOrder}
                    changeWorldOrder={changeWorldOrder}
                    t={t}
                />
                <UserDialogFavoriteWorldsTab
                    remoteData={remoteData}
                    favoriteWorlds={favoriteWorlds}
                    filteredFavoriteWorlds={filteredFavoriteWorlds}
                    remoteStatus={remoteStatus}
                    remoteErrors={remoteErrors}
                    loadTab={loadTab}
                    search={search}
                    setSearch={setSearch}
                    t={t}
                />
                <UserDialogAvatarsTab
                    currentAvatarTarget={currentAvatarTarget}
                    currentAvatarDisplayName={currentAvatarDisplayName}
                    onOpenCurrentAvatar={() =>
                        openAvatarDialog(currentAvatarDialogArgs)
                    }
                    visibleProfileAvatars={visibleProfileAvatars}
                    profileAvatars={profileAvatars}
                    remoteStatus={remoteStatus}
                    remoteErrors={remoteErrors}
                    loadTab={loadTab}
                    search={search}
                    setSearch={setSearch}
                    profile={profile}
                    currentUserId={currentUserId}
                    avatarSort={avatarSort}
                    changeAvatarSort={changeAvatarSort}
                    avatarReleaseStatus={avatarReleaseStatus}
                    changeAvatarReleaseStatus={changeAvatarReleaseStatus}
                    t={t}
                />
                <UserDialogInstanceHistoryTab
                    title={t('dialog.previous_instances.header')}
                    previousInstances={previousInstances}
                    profile={profile}
                    onPreviousInstancesChange={onPreviousInstancesChange}
                />
                <UserDialogActivityTab
                    profile={profile}
                    isCurrentUser={isCurrentUser}
                    active={activeTab === 'activity'}
                />
                <UserDialogJsonTab
                    profile={profile}
                    memo={memo}
                    moderationState={moderationState}
                    isFriend={isFriend}
                    isFavorite={isFavorite}
                />
            </EntityDialogTabs>
        </EntityDialogScaffold>
    );
}
