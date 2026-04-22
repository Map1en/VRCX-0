import {
    AppleIcon,
    MonitorIcon,
    SmartphoneIcon
} from 'lucide-react';
import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react';
import { toast } from 'sonner';

import { EmptyState as AppEmptyState } from '@/components/layout/PageScaffold.jsx';
import { convertFileUrlToImageUrl } from '@/lib/entityMedia.js';
import { userFacingErrorMessage } from '@/lib/errorDisplay.js';
import { backend } from '@/platform/index.js';
import {
    configRepository,
    gameLogRepository,
    groupProfileRepository,
    instanceRepository,
    memoRepository,
    notificationRepository,
    playerListRepository,
    toolsRepository,
    userProfileRepository,
    userSessionRepository,
    vrchatAuthRepository,
    vrchatFriendRepository,
    vrchatModerationRepository,
    vrchatSearchRepository
} from '@/repositories/index.js';
import { openGroupDialog } from '@/services/dialogService.js';
import friendRelationshipService from '@/services/friendRelationshipService.js';
import {
    recordRecentAction,
    subscribeRecentActions
} from '@/services/recentActionService.js';
import {
    buildCurrentUserPresenceView,
    mergeCurrentUserPresenceFields
} from '@/shared/utils/currentUserPresence.js';
import { checkCanInvite } from '@/shared/utils/invite.js';
import {
    parseLocation,
    resolveFriendPresenceLocation
} from '@/shared/utils/location.js';
import { useDialogStore } from '@/state/dialogStore.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { usePreferencesStore } from '@/state/preferencesStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Spinner } from '@/ui/shadcn/spinner';

import { InviteMessageDialog } from './InviteMessageDialog.jsx';
import {
    cachePreviousInstances,
    cacheUserStats,
    dialogTargetKey,
    readCachedPreviousInstances,
    readCachedUserStats
} from './user-dialog/userDialogCache.js';
import {
    buildFavoriteIdSet,
    fallbackLanguageOptions,
    maxStatusPresets,
    normalizeLanguageKey,
    normalizeLanguageOptionsFromConfig,
    normalizeProfileLanguageRows,
    normalizeSelfStatusInput,
    normalizeStatusHistoryRows,
    normalizeUserId,
    selfStatusBaseOptions,
    statusPresetsConfigKey
} from './user-dialog/userProfileFields.js';
import { UserDialogTabbedView } from './UserDialogTabbedView.jsx';
import {
    UserLanguageDialog,
    UserSocialStatusDialog
} from './user-dialog/UserSelfEditDialogs.jsx';
import { appI18n } from '@/services/i18nService.js';

function isGroupId(value) {
    return normalizeUserId(value).startsWith('grp_');
}

function groupSeed(value) {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const groupId = normalizeUserId(
        value.groupId || value.group_id || value.id
    );
    return isGroupId(groupId) ? value : null;
}

function groupDisplayName(...values) {
    const fallback = [];
    for (const value of values) {
        const text = normalizeUserId(value);
        if (!text) {
            continue;
        }
        if (!isGroupId(text)) {
            return text;
        }
        fallback.push(text);
    }
    return fallback[0] || '';
}

function hasGroupProfileDetails(group, fallback = {}) {
    if (!group || typeof group !== 'object') {
        return false;
    }
    const nestedGroup =
        group.group && typeof group.group === 'object' ? group.group : {};
    const name = groupDisplayName(
        group.name,
        group.displayName,
        group.display_name,
        group.groupName,
        group.group_name,
        group.shortCode,
        nestedGroup.name,
        nestedGroup.displayName,
        nestedGroup.display_name,
        fallback.name,
        fallback.displayName,
        fallback.display_name
    );
    const image = normalizeUserId(
        group.iconUrl ||
            group.icon_url ||
            group.thumbnailImageUrl ||
            group.thumbnail_image_url ||
            group.imageUrl ||
            group.image_url ||
            nestedGroup.iconUrl ||
            nestedGroup.icon_url ||
            nestedGroup.thumbnailImageUrl ||
            nestedGroup.thumbnail_image_url ||
            nestedGroup.imageUrl ||
            nestedGroup.image_url
    );
    return Boolean((name && !isGroupId(name)) || image);
}

function resolvePlatformMeta(platform) {
    const normalized = normalizeUserId(platform).toLowerCase();

    if (
        normalized === 'standalonewindows' ||
        normalized === 'pc' ||
        normalized === 'windows'
    ) {
        return {
            label: 'PC',
            icon: MonitorIcon
        };
    }

    if (normalized === 'android' || normalized === 'quest') {
        return {
            label: 'Android',
            icon: SmartphoneIcon
        };
    }

    if (normalized === 'ios') {
        return {
            label: 'iOS',
            icon: AppleIcon
        };
    }

    return {
        label: normalized ? normalized : 'Unknown',
        icon: null
    };
}

function resolvePresenceLocation(profile) {
    return resolveFriendPresenceLocation(profile);
}

function isSameLocationTag(left, right) {
    const leftTag = normalizeUserId(left);
    const rightTag = normalizeUserId(right);
    if (!leftTag || !rightTag) {
        return false;
    }
    if (leftTag === rightTag) {
        return true;
    }
    const leftLocation = parseLocation(leftTag);
    const rightLocation = parseLocation(rightTag);
    return Boolean(
        leftLocation.worldId &&
        rightLocation.worldId &&
        leftLocation.instanceId &&
        rightLocation.instanceId &&
        leftLocation.worldId === rightLocation.worldId &&
        leftLocation.instanceId === rightLocation.instanceId
    );
}

function userDisplayName(user) {
    if (typeof user === 'string') {
        return normalizeUserId(user);
    }
    return normalizeUserId(
        user?.displayName ||
            user?.display_name ||
            user?.username ||
            user?.name ||
            user?.user?.displayName ||
            user?.user?.display_name ||
            user?.user?.username ||
            user?.user?.name ||
            user?.userId ||
            user?.user_id ||
            user?.id ||
            user?.user?.id ||
            user?.user?.userId ||
            user?.user?.user_id
    );
}

function createLocationUserRow(user, fallback = {}) {
    const source =
        typeof user === 'string'
            ? { id: user, userId: user, displayName: user }
            : user || {};
    const userId = normalizeUserId(
        source.id ||
            source.userId ||
            source.user_id ||
            source.targetUserId ||
            source.target_user_id ||
            source.user?.id ||
            source.user?.userId ||
            source.user?.user_id ||
            fallback.id ||
            fallback.userId ||
            fallback.user_id
    );
    const displayName =
        userDisplayName(source) ||
        normalizeUserId(fallback.displayName || fallback.display_name) ||
        userId;
    return {
        ...(source && typeof source === 'object' ? source : {}),
        id: userId,
        userId,
        displayName,
        $subtitle: fallback.subtitle || '',
        $location_at:
            source?.$location_at ||
            source?.locationAt ||
            source?.location_at ||
            fallback.joinedAt ||
            fallback.joined_at ||
            '',
        joinedAt:
            source?.joinedAt ||
            source?.joined_at ||
            fallback.joinedAt ||
            fallback.joined_at ||
            ''
    };
}

function createLocationGroupRow(group, fallback = {}) {
    const source =
        typeof group === 'string'
            ? { id: group, groupId: group, name: group }
            : group || {};
    const nestedGroup =
        source.group && typeof source.group === 'object' ? source.group : {};
    const groupId = normalizeUserId(
        source.groupId ||
            source.group_id ||
            nestedGroup.id ||
            nestedGroup.groupId ||
            nestedGroup.group_id ||
            (isGroupId(source.id) ? source.id : '') ||
            fallback.groupId ||
            fallback.group_id ||
            fallback.id
    );
    const name = groupDisplayName(
        source.name,
        source.displayName,
        source.display_name,
        source.groupName,
        source.group_name,
        source.shortCode,
        nestedGroup.name,
        nestedGroup.displayName,
        nestedGroup.display_name,
        fallback.name,
        fallback.displayName,
        fallback.display_name,
        groupId
    );
    return {
        ...nestedGroup,
        ...(source && typeof source === 'object' ? source : {}),
        id: groupId,
        groupId,
        name,
        displayName: source.displayName || source.display_name || name,
        iconUrl:
            source.iconUrl ||
            source.icon_url ||
            nestedGroup.iconUrl ||
            nestedGroup.icon_url ||
            fallback.iconUrl ||
            fallback.icon_url ||
            '',
        thumbnailImageUrl:
            source.thumbnailImageUrl ||
            source.thumbnail_image_url ||
            nestedGroup.thumbnailImageUrl ||
            nestedGroup.thumbnail_image_url ||
            '',
        imageUrl:
            source.imageUrl ||
            source.image_url ||
            nestedGroup.imageUrl ||
            nestedGroup.image_url ||
            ''
    };
}

function mergeLocationUser(rowsById, user, fallback = {}) {
    const row = createLocationUserRow(user, fallback);
    const key = row.id || `display:${row.displayName}`;
    if (!key || rowsById.has(key)) {
        return;
    }
    rowsById.set(key, row);
}

function pushLocationUserSource(source, push) {
    if (!source) {
        return;
    }
    if (source instanceof Map) {
        for (const value of source.values()) {
            pushLocationUserSource(value, push);
        }
        return;
    }
    if (Array.isArray(source)) {
        for (const value of source) {
            pushLocationUserSource(value, push);
        }
        return;
    }
    if (typeof source === 'object') {
        if (
            source.id ||
            source.userId ||
            source.user_id ||
            source.targetUserId ||
            source.target_user_id ||
            source.displayName ||
            source.display_name ||
            source.username ||
            source.name ||
            source.user?.id ||
            source.user?.userId ||
            source.user?.displayName ||
            source.user?.username
        ) {
            push(source);
            return;
        }
        for (const value of Object.values(source)) {
            pushLocationUserSource(value, push);
        }
        return;
    }
    push(source);
}

function resolveCurrentInviteLocation(gameState, currentUserSnapshot) {
    const currentLocation = normalizeUserId(gameState?.currentLocation);
    if (currentLocation === 'traveling') {
        return normalizeUserId(gameState?.currentDestination);
    }
    return (
        currentLocation ||
        normalizeUserId(gameState?.currentDestination) ||
        normalizeUserId(
            currentUserSnapshot?.$locationTag || currentUserSnapshot?.location
        )
    );
}

function instanceLocation(instance) {
    const source = instance?.instance || instance;
    return normalizeUserId(
        source?.location ||
            source?.tag ||
            source?.$location?.tag ||
            instance?.location ||
            instance?.tag ||
            instance?.$location?.tag
    );
}

function locationCacheKey(location) {
    const parsed = parseLocation(location);
    if (!parsed.worldId || !parsed.instanceId) {
        return '';
    }
    return `${parsed.worldId}:${parsed.instanceId}`;
}

function buildCachedInstanceMap(instances) {
    const map = new Map();
    for (const instance of Array.isArray(instances) ? instances : []) {
        const source = instance?.instance || instance;
        const location = instanceLocation(instance);
        if (!location) {
            continue;
        }
        map.set(location, source);
        const key = locationCacheKey(location);
        if (key) {
            map.set(key, source);
        }
    }
    return map;
}

function resolveFriendRequestState(profile) {
    const status = normalizeUserId(profile?.friendRequestStatus).toLowerCase();
    return {
        incoming:
            Boolean(profile?.incomingRequest) || status.includes('incoming'),
        outgoing:
            Boolean(profile?.outgoingRequest) || status.includes('outgoing')
    };
}

function UserDialogEmptyState({ title, description, loading = false }) {
    return (
        <AppEmptyState
            className="min-h-56"
            title={title}
            description={description}
            icon={loading ? Spinner : undefined}
        />
    );
}

export function UserDialogContent({ userId, seedData = null, openNonce = 0 }) {
    const normalizedUserId = normalizeUserId(userId);
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const currentUserSnapshot = useRuntimeStore(
        (state) => state.auth.currentUserSnapshot
    );
    const currentEndpoint = useRuntimeStore(
        (state) => state.auth.currentUserEndpoint
    );
    const gameState = useRuntimeStore((state) => state.gameState);
    const groupInstancesState = useRuntimeStore(
        (state) => state.groupInstances
    );
    const normalizedCurrentUserId = normalizeUserId(currentUserId);
    const isTargetCurrentUser = Boolean(
        normalizedUserId && normalizedUserId === normalizedCurrentUserId
    );
    const friendsById = useFriendRosterStore((state) => state.friendsById);
    const applyFriendPatch = useFriendRosterStore(
        (state) => state.applyFriendPatch
    );
    const remoteFavoriteFriendIds = useFavoriteStore(
        (state) => state.favoriteFriendIds
    );
    const localFriendFavorites = useFavoriteStore(
        (state) => state.localFriendFavorites
    );
    const prompt = useModalStore((state) => state.prompt);
    const confirm = useModalStore((state) => state.confirm);
    const updateEntityDialogMetadata = useDialogStore(
        (state) => state.updateEntityDialogMetadata
    );

    const localSnapshot = isTargetCurrentUser
        ? currentUserSnapshot
        : friendsById[normalizedUserId] || seedData || null;
    const gameLogDisabled = usePreferencesStore(
        (state) => state.gameLogDisabled
    );
    const localSnapshotRef = useRef(localSnapshot);
    localSnapshotRef.current = localSnapshot;
    const currentUserPresenceRef = useRef({
        isTargetCurrentUser,
        currentUserSnapshot,
        gameState,
        gameLogDisabled
    });
    currentUserPresenceRef.current = {
        isTargetCurrentUser,
        currentUserSnapshot,
        gameState,
        gameLogDisabled
    };
    const withCurrentUserPresence = useCallback((nextProfile) => {
        const context = currentUserPresenceRef.current;
        if (!context.isTargetCurrentUser) {
            return nextProfile;
        }
        return buildCurrentUserPresenceView(nextProfile, context);
    }, []);
    const targetKey = useMemo(
        () => dialogTargetKey(currentEndpoint, normalizedUserId),
        [currentEndpoint, normalizedUserId]
    );

    const [baseProfile, setBaseProfile] = useState(() =>
        localSnapshot ? userProfileRepository.normalize(localSnapshot) : null
    );
    const profile = useMemo(
        () => withCurrentUserPresence(baseProfile),
        [
            baseProfile,
            currentUserSnapshot,
            gameState?.currentDestination,
            gameState?.currentLocation,
            gameState?.currentWorldId,
            gameState?.isGameRunning,
            gameLogDisabled,
            isTargetCurrentUser,
            withCurrentUserPresence
        ]
    );
    const [memo, setMemo] = useState('');
    const [loadStatus, setLoadStatus] = useState(
        normalizedUserId ? 'running' : 'idle'
    );
    const [reloadToken, setReloadToken] = useState(0);
    const [actionStatus, setActionStatus] = useState('idle');
    const [recentActionVersion, setRecentActionVersion] = useState(0);
    const [moderationState, setModerationState] = useState(() => ({
        block: false,
        mute: false
    }));
    const [extendedModerationState, setExtendedModerationState] = useState(
        () => ({
            interactOff: false,
            muteChat: false
        })
    );
    const [avatarOverrideState, setAvatarOverrideState] = useState(() => ({
        hideAvatar: false,
        showAvatar: false
    }));
    const [detail, setDetail] = useState('');
    const [previousInstances, setPreviousInstances] = useState(() =>
        readCachedPreviousInstances(targetKey)
    );
    const [userStats, setUserStats] = useState(() =>
        readCachedUserStats(targetKey)
    );
    const [representedGroup, setRepresentedGroup] = useState(null);
    const [representedGroupStatus, setRepresentedGroupStatus] =
        useState('idle');
    const [locationPanel, setLocationPanel] = useState({
        location: '',
        instance: null,
        ownerUser: null,
        ownerGroup: null,
        users: [],
        friendCount: 0,
        playerCount: 0
    });
    const [currentInviteInstance, setCurrentInviteInstance] = useState(null);
    const [currentInviteInstanceStatus, setCurrentInviteInstanceStatus] =
        useState('idle');
    const [locationRefreshToken, setLocationRefreshToken] = useState(0);
    const [inviteMessageRequest, setInviteMessageRequest] = useState(null);
    const [socialStatusDialogOpen, setSocialStatusDialogOpen] = useState(false);
    const [socialStatusDraft, setSocialStatusDraft] = useState({
        status: 'active',
        statusDescription: ''
    });
    const [statusPresets, setStatusPresets] = useState([]);
    const [languageDialogOpen, setLanguageDialogOpen] = useState(false);
    const [languageOptions, setLanguageOptions] = useState([]);
    const [languageOptionsStatus, setLanguageOptionsStatus] = useState('idle');
    const [selectedLanguageToAdd, setSelectedLanguageToAdd] = useState('');
    const actionStatusRef = useRef('idle');
    const memoRevisionRef = useRef(0);
    const moderationRevisionRef = useRef(0);
    const activeUserTargetRef = useRef({
        userId: normalizedUserId,
        endpoint: currentEndpoint
    });
    const currentGameLocation = normalizeUserId(gameState?.currentLocation);
    const currentGameDestination = normalizeUserId(
        gameState?.currentDestination
    );
    const currentSnapshotLocation = normalizeUserId(
        currentUserSnapshot?.$locationTag || currentUserSnapshot?.location
    );
    const currentInviteLocation = resolveCurrentInviteLocation(
        gameState,
        currentUserSnapshot
    );
    const groupInstances =
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.instances
            : [];
    const groupInstancesRevision =
        groupInstancesState.endpoint === currentEndpoint
            ? groupInstancesState.lastLoadedAt ||
              groupInstancesState.fetchedAt ||
              groupInstancesState.status
            : '';
    const hideUserNotes = usePreferencesStore((state) => state.hideUserNotes);
    const hideUserMemos = usePreferencesStore((state) => state.hideUserMemos);
    const appearanceSettings = useMemo(
        () => ({ hideUserNotes, hideUserMemos }),
        [hideUserMemos, hideUserNotes]
    );
    const selfStatusOptions = useMemo(
        () =>
            profile?.$isModerator
                ? [
                      ...selfStatusBaseOptions,
                      { value: 'offline', label: 'Offline' }
                  ]
                : selfStatusBaseOptions,
        [profile?.$isModerator]
    );
    const languageOptionsMap = useMemo(
        () => new Map(languageOptions.map((option) => [option.key, option])),
        [languageOptions]
    );
    const currentLanguageRows = useMemo(
        () => normalizeProfileLanguageRows(profile, languageOptionsMap),
        [profile, languageOptionsMap]
    );
    const selectedLanguageKeys = useMemo(
        () => new Set(currentLanguageRows.map((language) => language.key)),
        [currentLanguageRows]
    );
    const availableLanguageOptions = useMemo(
        () =>
            languageOptions.filter(
                (option) => !selectedLanguageKeys.has(option.key)
            ),
        [languageOptions, selectedLanguageKeys]
    );
    const statusHistoryRows = useMemo(
        () => normalizeStatusHistoryRows(profile, currentUserSnapshot),
        [currentUserSnapshot, profile]
    );
    const selfStatusLabelByValue = useMemo(
        () =>
            new Map(
                selfStatusOptions.map((option) => [option.value, option.label])
            ),
        [selfStatusOptions]
    );

    useEffect(() => {
        activeUserTargetRef.current = {
            userId: normalizedUserId,
            endpoint: currentEndpoint
        };
    }, [currentEndpoint, normalizedUserId]);

    useEffect(
        () =>
            subscribeRecentActions(() => {
                setRecentActionVersion((version) => version + 1);
            }),
        []
    );

    useLayoutEffect(() => {
        setInviteMessageRequest(null);
    }, [currentEndpoint, normalizedCurrentUserId, profile?.id]);

    useEffect(() => {
        setLanguageOptions([]);
        setLanguageOptionsStatus('idle');
        setSelectedLanguageToAdd('');
    }, [currentEndpoint]);

    useEffect(() => {
        let active = true;

        configRepository
            .getArray(statusPresetsConfigKey, [])
            .then((presets) => {
                if (active) {
                    setStatusPresets(Array.isArray(presets) ? presets : []);
                }
            })
            .catch(() => {
                if (active) {
                    setStatusPresets([]);
                }
            });

        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        let active = true;

        if (!languageDialogOpen || languageOptions.length) {
            return () => {
                active = false;
            };
        }

        setLanguageOptionsStatus('running');
        vrchatAuthRepository
            .getConfig({ endpoint: currentEndpoint })
            .then((response) => {
                if (!active) {
                    return;
                }
                const nextOptions = normalizeLanguageOptionsFromConfig(
                    response.json
                );
                setLanguageOptions(
                    nextOptions.length ? nextOptions : fallbackLanguageOptions()
                );
                setLanguageOptionsStatus('ready');
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setLanguageOptions(fallbackLanguageOptions());
                setLanguageOptionsStatus('error');
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, languageDialogOpen, languageOptions.length]);

    useEffect(() => {
        if (localSnapshot) {
            const nextSnapshot = userProfileRepository.normalize(localSnapshot);
            setBaseProfile((currentProfile) =>
                isTargetCurrentUser
                    ? mergeCurrentUserPresenceFields(
                          nextSnapshot,
                          currentProfile
                      )
                    : nextSnapshot
            );
        } else if (!normalizedUserId) {
            setBaseProfile(null);
        }
    }, [isTargetCurrentUser, localSnapshot, normalizedUserId]);

    useEffect(() => {
        const title = normalizeUserId(
            profile?.displayName || profile?.username
        );
        if (!profile?.id || !title) {
            return;
        }
        updateEntityDialogMetadata({
            kind: 'user',
            entityId: profile.id,
            title
        });
    }, [
        profile?.displayName,
        profile?.id,
        profile?.username,
        updateEntityDialogMetadata
    ]);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setBaseProfile(null);
            setLoadStatus('error');
            setDetail('No user id was provided for this dialog.');
            return () => {
                active = false;
            };
        }

        const snapshot = localSnapshotRef.current;
        const nextSnapshot = snapshot
            ? userProfileRepository.normalize(snapshot)
            : null;
        setBaseProfile((currentProfile) =>
            isTargetCurrentUser && nextSnapshot
                ? mergeCurrentUserPresenceFields(nextSnapshot, currentProfile)
                : nextSnapshot
        );
        setMemo('');
        setPreviousInstances(readCachedPreviousInstances(targetKey));
        setUserStats(readCachedUserStats(targetKey));
        setLoadStatus('running');
        setDetail('');

        userProfileRepository
            .getUserProfile({
                userId: normalizedUserId,
                endpoint: currentEndpoint,
                force: reloadToken > 0
            })
            .then((nextProfile) => {
                if (!active) {
                    return;
                }

                setBaseProfile((currentProfile) =>
                    isTargetCurrentUser
                        ? mergeCurrentUserPresenceFields(
                              nextProfile,
                              currentProfile
                          )
                        : nextProfile
                );
                setLoadStatus('ready');
            })
            .catch((error) => {
                if (!active) {
                    return;
                }

                const fallbackSnapshot = localSnapshotRef.current;
                if (fallbackSnapshot) {
                    const nextFallback =
                        userProfileRepository.normalize(fallbackSnapshot);
                    setBaseProfile((currentProfile) =>
                        isTargetCurrentUser
                            ? mergeCurrentUserPresenceFields(
                                  nextFallback,
                                  currentProfile
                              )
                            : nextFallback
                    );
                    setLoadStatus('ready');
                    setDetail(
                        error instanceof Error
                            ? error.message
                            : 'Failed to refresh the remote user snapshot.'
                    );
                    return;
                }

                setBaseProfile(null);
                setLoadStatus('error');
                setDetail(
                    error instanceof Error
                        ? error.message
                        : 'Failed to load the user profile.'
                );
            });

        return () => {
            active = false;
        };
    }, [
        currentEndpoint,
        isTargetCurrentUser,
        normalizedUserId,
        reloadToken,
        targetKey
    ]);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setRepresentedGroup(null);
            setRepresentedGroupStatus('idle');
            return () => {
                active = false;
            };
        }

        const targetUserId = normalizedUserId;
        const targetEndpoint = currentEndpoint;
        setRepresentedGroup(null);
        setRepresentedGroupStatus('running');

        userProfileRepository
            .getRepresentedGroup({
                userId: targetUserId,
                endpoint: targetEndpoint,
                force: reloadToken > 0
            })
            .then((group) => {
                if (
                    !active ||
                    activeUserTargetRef.current.userId !== targetUserId ||
                    activeUserTargetRef.current.endpoint !== targetEndpoint
                ) {
                    return;
                }
                setRepresentedGroup(group);
                setRepresentedGroupStatus('ready');
            })
            .catch(() => {
                if (
                    !active ||
                    activeUserTargetRef.current.userId !== targetUserId ||
                    activeUserTargetRef.current.endpoint !== targetEndpoint
                ) {
                    return;
                }
                setRepresentedGroup(null);
                setRepresentedGroupStatus('error');
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, normalizedUserId, reloadToken]);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setMemo('');
            return () => {
                active = false;
            };
        }

        setMemo('');
        const revision = memoRevisionRef.current;
        memoRepository
            .getUserMemo(normalizedUserId)
            .then((entry) => {
                if (active && memoRevisionRef.current === revision) {
                    setMemo(entry?.memo || '');
                }
            })
            .catch(() => {
                if (active && memoRevisionRef.current === revision) {
                    setMemo('');
                }
            });

        return () => {
            active = false;
        };
    }, [normalizedUserId]);

    useEffect(() => {
        let active = true;

        if (!profile?.id) {
            setPreviousInstances(readCachedPreviousInstances(targetKey));
            return () => {
                active = false;
            };
        }

        gameLogRepository
            .getPreviousInstancesByUserId({
                id: profile.id
            })
            .then((rows) => {
                if (!active) {
                    return;
                }
                const values =
                    rows instanceof Set ? Array.from(rows.values()) : [];
                const nextInstances = values.reverse();
                cachePreviousInstances(targetKey, nextInstances);
                setPreviousInstances(nextInstances);
            })
            .catch(() => {
                // Keep the last visible rows while a refresh fails.
            });

        return () => {
            active = false;
        };
    }, [
        openNonce,
        profile?.displayName,
        profile?.id,
        profile?.username,
        reloadToken,
        targetKey
    ]);

    useEffect(() => {
        let active = true;

        if (!profile?.id) {
            setUserStats(readCachedUserStats(targetKey));
            return () => {
                active = false;
            };
        }

        const activeLocation = resolvePresenceLocation(profile);
        const currentLocation =
            currentGameLocation === 'traveling'
                ? currentGameDestination
                : currentGameLocation ||
                  currentGameDestination ||
                  currentSnapshotLocation;
        const inCurrentWorld = Boolean(
            activeLocation &&
            currentLocation &&
            isSameLocationTag(activeLocation, currentLocation)
        );

        gameLogRepository
            .getUserStats(
                {
                    id: profile.id,
                    displayName: profile.displayName || profile.username || ''
                },
                inCurrentWorld
            )
            .then((stats) => {
                if (!active) {
                    return;
                }
                const previousDisplayNames =
                    stats?.previousDisplayNames instanceof Map
                        ? Array.from(
                              stats.previousDisplayNames,
                              ([displayName, updated_at]) => ({
                                  displayName,
                                  updated_at
                              })
                          )
                        : Array.isArray(stats?.previousDisplayNames)
                          ? stats.previousDisplayNames
                          : [];
                const nextStats = {
                    timeSpent: Number(stats?.timeSpent) || 0,
                    lastSeen: stats?.lastSeen || '',
                    joinCount: Number(stats?.joinCount) || 0,
                    previousDisplayNames
                };
                cacheUserStats(targetKey, nextStats);
                setUserStats(nextStats);
            })
            .catch(() => {
                // Keep the last visible stats while a refresh fails.
            });

        return () => {
            active = false;
        };
    }, [
        currentGameDestination,
        currentGameLocation,
        currentSnapshotLocation,
        profile?.displayName,
        profile?.id,
        profile?.location,
        profile?.travelingToLocation,
        profile?.username,
        openNonce,
        reloadToken,
        targetKey
    ]);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId) {
            setModerationState({ block: false, mute: false });
            return () => {
                active = false;
            };
        }

        const revision = moderationRevisionRef.current;
        const localModerationPromise = currentUserId
            ? userSessionRepository.ensureUserTables(currentUserId).then(() =>
                  vrchatModerationRepository.getLocalModeration({
                      ownerUserId: currentUserId,
                      userId: normalizedUserId
                  })
              )
            : vrchatModerationRepository.getLocalModeration({
                  ownerUserId: '',
                  userId: normalizedUserId
              });
        localModerationPromise
            .then((entry) => {
                if (active && moderationRevisionRef.current === revision) {
                    setModerationState({
                        block: Boolean(entry?.block),
                        mute: Boolean(entry?.mute)
                    });
                }
            })
            .catch(() => {
                if (active && moderationRevisionRef.current === revision) {
                    setModerationState({ block: false, mute: false });
                }
            });

        return () => {
            active = false;
        };
    }, [normalizedUserId, reloadToken]);

    useEffect(() => {
        let active = true;

        if (!normalizedUserId || isTargetCurrentUser) {
            setExtendedModerationState({ interactOff: false, muteChat: false });
            return () => {
                active = false;
            };
        }

        vrchatModerationRepository
            .getPlayerModerations({ endpoint: currentEndpoint })
            .then((response) => {
                if (!active) {
                    return;
                }
                const rows = Array.isArray(response.json) ? response.json : [];
                setExtendedModerationState({
                    interactOff: rows.some(
                        (row) =>
                            row.targetUserId === normalizedUserId &&
                            row.type === 'interactOff'
                    ),
                    muteChat: rows.some(
                        (row) =>
                            row.targetUserId === normalizedUserId &&
                            row.type === 'muteChat'
                    )
                });
            })
            .catch(() => {
                if (active) {
                    setExtendedModerationState({
                        interactOff: false,
                        muteChat: false
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, isTargetCurrentUser, normalizedUserId, reloadToken]);

    useEffect(() => {
        let active = true;

        if (
            !normalizedUserId ||
            !normalizedCurrentUserId ||
            isTargetCurrentUser
        ) {
            setAvatarOverrideState({ hideAvatar: false, showAvatar: false });
            return () => {
                active = false;
            };
        }

        backend.app
            .GetVRChatUserModeration(normalizedCurrentUserId, normalizedUserId)
            .then((value) => {
                if (!active) {
                    return;
                }
                const moderationType = Number(
                    value?.moderationType ??
                        value?.type ??
                        value?.value ??
                        value
                );
                setAvatarOverrideState({
                    hideAvatar: moderationType === 4,
                    showAvatar: moderationType === 5
                });
            })
            .catch(() => {
                if (active) {
                    setAvatarOverrideState({
                        hideAvatar: false,
                        showAvatar: false
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [
        isTargetCurrentUser,
        normalizedCurrentUserId,
        normalizedUserId,
        reloadToken
    ]);

    useEffect(() => {
        let active = true;
        const emptyLocationPanel = {
            location: '',
            instance: null,
            ownerUser: null,
            ownerGroup: null,
            users: [],
            friendCount: 0,
            playerCount: 0
        };

        const activeLocation = resolvePresenceLocation(profile);
        const parsedLocation = parseLocation(activeLocation);
        if (
            !profile?.id ||
            !activeLocation ||
            parsedLocation.isOffline ||
            parsedLocation.isPrivate ||
            parsedLocation.isTraveling
        ) {
            setLocationPanel(emptyLocationPanel);
            return () => {
                active = false;
            };
        }

        const currentLocation =
            currentGameLocation === 'traveling'
                ? currentGameDestination
                : currentGameLocation ||
                  currentGameDestination ||
                  currentSnapshotLocation;
        const currentLocationMatches = isSameLocationTag(
            currentLocation,
            activeLocation
        );
        const snapshotLocation =
            currentLocationMatches && currentLocation
                ? currentLocation
                : activeLocation;
        const rowsById = new Map();
        const knownUsersById = new Map();

        function addKnownUser(user) {
            const userId = normalizeUserId(
                user?.id ||
                    user?.userId ||
                    user?.user_id ||
                    user?.targetUserId ||
                    user?.target_user_id
            );
            if (userId && !knownUsersById.has(userId)) {
                knownUsersById.set(userId, user);
            }
        }

        function userIsAtLocation(user) {
            if (!user) {
                return false;
            }
            return isSameLocationTag(
                resolvePresenceLocation(user),
                activeLocation
            );
        }

        addKnownUser(profile);
        addKnownUser(currentUserSnapshot);
        for (const friend of Object.values(friendsById)) {
            addKnownUser(friend);
        }

        mergeLocationUser(rowsById, profile);
        if (currentLocationMatches) {
            mergeLocationUser(rowsById, currentUserSnapshot);
        }

        for (const friend of Object.values(friendsById)) {
            if (!userIsAtLocation(friend)) {
                continue;
            }
            if (friend?.state !== 'online' && friend?.location === 'private') {
                continue;
            }
            mergeLocationUser(rowsById, friend);
        }

        const locationMetadata =
            profile?.$location && typeof profile.$location === 'object'
                ? profile.$location
                : {};
        pushLocationUserSource(
            [
                locationMetadata.users,
                locationMetadata.players,
                locationMetadata.friends
            ],
            (user) => mergeLocationUser(rowsById, user)
        );

        const canFetchInstance = Boolean(
            parsedLocation.worldId && parsedLocation.instanceId
        );
        const ownerId = normalizeUserId(
            parsedLocation.userId ||
                locationMetadata.ownerUserId ||
                locationMetadata.owner_user_id ||
                locationMetadata.ownerId ||
                locationMetadata.owner_id ||
                locationMetadata.creatorUserId ||
                locationMetadata.creator_user_id ||
                locationMetadata.userId ||
                locationMetadata.user_id ||
                locationMetadata.ownerUser?.id ||
                locationMetadata.ownerUser?.userId ||
                locationMetadata.ownerUser?.user_id ||
                locationMetadata.owner?.id ||
                locationMetadata.owner?.userId ||
                locationMetadata.owner?.user_id ||
                locationMetadata.creatorUser?.id ||
                locationMetadata.creatorUser?.userId ||
                locationMetadata.creatorUser?.user_id ||
                locationMetadata.user?.id ||
                locationMetadata.user?.userId ||
                locationMetadata.user?.user_id ||
                locationMetadata.groupId ||
                locationMetadata.group_id ||
                locationMetadata.group?.id ||
                locationMetadata.group?.groupId ||
                locationMetadata.group?.group_id ||
                parsedLocation.groupId
        );
        const ownerIsGroup = isGroupId(ownerId);
        const ownerSeed = ownerId
            ? ownerIsGroup
                ? locationMetadata.group ||
                  locationMetadata.ownerGroup ||
                  locationMetadata.owner_group ||
                  groupSeed(locationMetadata.owner) ||
                  locationMetadata.creatorGroup ||
                  locationMetadata.creator_group ||
                  null
                : locationMetadata.ownerUser ||
                  locationMetadata.owner ||
                  locationMetadata.creatorUser ||
                  locationMetadata.user ||
                  knownUsersById.get(ownerId)
            : null;
        const ownerPromise = ownerId
            ? Promise.resolve(ownerSeed).then((cachedOwner) => {
                  if (ownerIsGroup) {
                      const groupFallback = {
                          id: ownerId,
                          name:
                              locationMetadata.groupName ||
                              locationMetadata.group_name
                      };
                      const cachedOwnerGroup = cachedOwner
                          ? createLocationGroupRow(cachedOwner, groupFallback)
                          : null;
                      if (
                          cachedOwner &&
                          hasGroupProfileDetails(cachedOwner, groupFallback)
                      ) {
                          return {
                              ownerUser: null,
                              ownerGroup: cachedOwnerGroup
                          };
                      }
                      return groupProfileRepository
                          .getGroupProfile({
                              groupId: ownerId,
                              endpoint: currentEndpoint,
                              includeRoles: false
                          })
                          .then((groupProfile) => ({
                              ownerUser: null,
                              ownerGroup: createLocationGroupRow(
                                  groupProfile,
                                  groupFallback
                              )
                          }))
                          .catch(() => ({
                              ownerUser: null,
                              ownerGroup:
                                  cachedOwnerGroup ||
                                  createLocationGroupRow({
                                      id: ownerId,
                                      name:
                                          locationMetadata.groupName ||
                                          locationMetadata.group_name ||
                                          ownerId
                                  })
                          }));
                  }
                  if (cachedOwner) {
                      return {
                          ownerUser: createLocationUserRow(cachedOwner),
                          ownerGroup: null
                      };
                  }
                  return userProfileRepository
                      .getUserProfile({
                          userId: ownerId,
                          endpoint: currentEndpoint
                      })
                      .then((ownerProfile) => ({
                          ownerUser: createLocationUserRow(ownerProfile),
                          ownerGroup: null
                      }))
                      .catch(() => ({
                          ownerUser: createLocationUserRow({
                              id: ownerId,
                              displayName: ownerId
                          }),
                          ownerGroup: null
                      }));
              })
            : Promise.resolve({ ownerUser: null, ownerGroup: null });
        const instancePromise = canFetchInstance
            ? instanceRepository
                  .getInstance({
                      worldId: parsedLocation.worldId,
                      instanceId: parsedLocation.instanceId,
                      endpoint: currentEndpoint
                  })
                  .then((response) => response.json)
                  .catch(() => null)
            : Promise.resolve(null);
        const playerSnapshotPromise = currentLocationMatches
            ? playerListRepository
                  .getCurrentInstanceSnapshot({
                      currentUserId: normalizedCurrentUserId,
                      currentLocation: snapshotLocation
                  })
                  .catch(() => null)
            : Promise.resolve(null);

        Promise.allSettled([
            ownerPromise,
            instancePromise,
            playerSnapshotPromise
        ])
            .then(
                async ([ownerResult, instanceResult, playerSnapshotResult]) => {
                    if (!active) {
                        return;
                    }
                    const ownerPayload =
                        ownerResult.status === 'fulfilled'
                            ? ownerResult.value
                            : null;
                    let ownerUser = ownerPayload?.ownerUser || null;
                    let ownerGroup = ownerPayload?.ownerGroup || null;
                    const instance =
                        instanceResult.status === 'fulfilled'
                            ? instanceResult.value
                            : null;
                    const playerSnapshot =
                        playerSnapshotResult.status === 'fulfilled'
                            ? playerSnapshotResult.value
                            : null;
                    const instanceOwnerId = normalizeUserId(
                        instance?.ownerUserId ||
                            instance?.owner_user_id ||
                            instance?.ownerId ||
                            instance?.owner_id ||
                            instance?.userId ||
                            instance?.user_id ||
                            instance?.creatorUserId ||
                            instance?.creator_user_id ||
                            instance?.ownerUser?.id ||
                            instance?.ownerUser?.userId ||
                            instance?.ownerUser?.user_id ||
                            instance?.owner?.id ||
                            instance?.owner?.userId ||
                            instance?.owner?.user_id ||
                            instance?.creatorUser?.id ||
                            instance?.creatorUser?.userId ||
                            instance?.creatorUser?.user_id ||
                            instance?.groupId ||
                            instance?.group_id ||
                            instance?.group?.id ||
                            instance?.group?.groupId ||
                            instance?.group?.group_id ||
                            parsedLocation.groupId
                    );
                    const instanceOwnerIsGroup = isGroupId(instanceOwnerId);
                    if (!ownerUser && !ownerGroup && instanceOwnerId) {
                        const cachedOwner = instanceOwnerIsGroup
                            ? instance?.group ||
                              instance?.ownerGroup ||
                              instance?.owner_group ||
                              groupSeed(instance?.owner) ||
                              instance?.creatorGroup ||
                              instance?.creator_group ||
                              null
                            : instance?.ownerUser ||
                              instance?.owner ||
                              instance?.creatorUser ||
                              instance?.user ||
                              knownUsersById.get(instanceOwnerId);
                        if (instanceOwnerIsGroup) {
                            const groupFallback = {
                                id: instanceOwnerId,
                                name:
                                    instance?.groupName ||
                                    instance?.group_name ||
                                    instance?.group?.name
                            };
                            const cachedOwnerGroup = cachedOwner
                                ? createLocationGroupRow(
                                      cachedOwner,
                                      groupFallback
                                  )
                                : null;
                            ownerGroup =
                                cachedOwner &&
                                hasGroupProfileDetails(
                                    cachedOwner,
                                    groupFallback
                                )
                                    ? cachedOwnerGroup
                                    : await groupProfileRepository
                                          .getGroupProfile({
                                              groupId: instanceOwnerId,
                                              endpoint: currentEndpoint,
                                              includeRoles: false
                                          })
                                          .then((groupProfile) =>
                                              createLocationGroupRow(
                                                  groupProfile,
                                                  groupFallback
                                              )
                                          )
                                          .catch(
                                              () =>
                                                  cachedOwnerGroup ||
                                                  createLocationGroupRow({
                                                      id: instanceOwnerId,
                                                      name:
                                                          instance?.groupName ||
                                                          instance?.group_name ||
                                                          instance?.group
                                                              ?.name ||
                                                          instanceOwnerId
                                                  })
                                          );
                        } else {
                            ownerUser = cachedOwner
                                ? createLocationUserRow(cachedOwner)
                                : await userProfileRepository
                                      .getUserProfile({
                                          userId: instanceOwnerId,
                                          endpoint: currentEndpoint
                                      })
                                      .then((ownerProfile) =>
                                          createLocationUserRow(ownerProfile)
                                      )
                                      .catch(() =>
                                          createLocationUserRow({
                                              id: instanceOwnerId,
                                              displayName: instanceOwnerId
                                          })
                                      );
                        }
                        if (!active) {
                            return;
                        }
                    }
                    pushLocationUserSource(
                        [
                            instance?.users,
                            instance?.players,
                            instance?.playerList,
                            instance?.userList,
                            instance?.userIds,
                            instance?.usersById
                        ],
                        (user) => mergeLocationUser(rowsById, user)
                    );
                    for (const player of playerSnapshot?.players || []) {
                        const playerId = normalizeUserId(
                            player.userId ||
                                player.user_id ||
                                player.id ||
                                player.targetUserId ||
                                player.target_user_id
                        );
                        const knownUser = playerId
                            ? knownUsersById.get(playerId)
                            : null;
                        mergeLocationUser(rowsById, knownUser || player, {
                            id: playerId,
                            userId: playerId,
                            displayName:
                                player.displayName || player.display_name,
                            joinedAt: player.joinedAt || player.joined_at
                        });
                    }

                    const users = Array.from(rowsById.values()).sort(
                        (left, right) =>
                            userDisplayName(left).localeCompare(
                                userDisplayName(right),
                                undefined,
                                { sensitivity: 'base' }
                            )
                    );
                    const friendCount = users.filter((user) => {
                        const userId = normalizeUserId(
                            user?.id || user?.userId
                        );
                        return Boolean(userId && friendsById[userId]);
                    }).length;
                    const instanceFriendCount =
                        Number(
                            instance?.friendCount ??
                                instance?.friendsCount ??
                                instance?.n_friends ??
                                friendCount
                        ) || friendCount;
                    setLocationPanel({
                        location: activeLocation,
                        instance,
                        ownerUser,
                        ownerGroup,
                        users,
                        friendCount: instanceFriendCount,
                        playerCount:
                            Number(
                                instance?.userCount ??
                                    instance?.occupants ??
                                    playerSnapshot?.context?.playerCount ??
                                    users.length
                            ) || users.length
                    });
                }
            )
            .catch(() => {
                if (active) {
                    setLocationPanel({
                        ...emptyLocationPanel,
                        location: activeLocation,
                        users: Array.from(rowsById.values()),
                        friendCount: Array.from(rowsById.values()).filter(
                            (user) => {
                                const userId = normalizeUserId(
                                    user?.id || user?.userId
                                );
                                return Boolean(userId && friendsById[userId]);
                            }
                        ).length
                    });
                }
            });

        return () => {
            active = false;
        };
    }, [
        currentEndpoint,
        currentGameDestination,
        currentGameLocation,
        currentSnapshotLocation,
        currentUserSnapshot,
        friendsById,
        locationRefreshToken,
        normalizedCurrentUserId,
        profile,
        reloadToken
    ]);

    useEffect(() => {
        let active = true;
        const parsedLocation = parseLocation(currentInviteLocation);
        if (
            !parsedLocation.isRealInstance ||
            !parsedLocation.worldId ||
            !parsedLocation.instanceId
        ) {
            setCurrentInviteInstance(null);
            setCurrentInviteInstanceStatus('idle');
            return () => {
                active = false;
            };
        }

        setCurrentInviteInstance(null);
        setCurrentInviteInstanceStatus('running');
        instanceRepository
            .getInstance({
                worldId: parsedLocation.worldId,
                instanceId: parsedLocation.instanceId,
                endpoint: currentEndpoint
            })
            .then((response) => {
                if (!active) {
                    return;
                }
                setCurrentInviteInstance(response?.json || null);
                setCurrentInviteInstanceStatus('ready');
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setCurrentInviteInstance(null);
                setCurrentInviteInstanceStatus('error');
            });

        return () => {
            active = false;
        };
    }, [currentEndpoint, currentInviteLocation, reloadToken]);

    function refreshLocationPanel(requestLocation) {
        const activeLocation = resolvePresenceLocation(profile);
        if (
            requestLocation &&
            activeLocation &&
            !isSameLocationTag(requestLocation, activeLocation)
        ) {
            return null;
        }
        setLocationRefreshToken((value) => value + 1);
        return null;
    }

    const favoriteFriendIds = useMemo(
        () => buildFavoriteIdSet(remoteFavoriteFriendIds, localFriendFavorites),
        [localFriendFavorites, remoteFavoriteFriendIds]
    );

    const isFavorite = profile?.id
        ? favoriteFriendIds.has(normalizeUserId(profile.id))
        : false;
    const isCurrentUser =
        profile?.id &&
        normalizeUserId(profile.id) === normalizeUserId(currentUserId);
    const profileUserId = normalizeUserId(profile?.id);
    const isFriend = Boolean(
        profileUserId && (friendsById[profileUserId] || profile?.isFriend)
    );
    const friendRequestState = resolveFriendRequestState(profile);
    const platform = resolvePlatformMeta(
        profile?.$platform || profile?.platform || profile?.last_platform
    );
    const PlatformIcon = platform.icon;
    const imageUrl = profile
        ? convertFileUrlToImageUrl(
              profile.profilePicOverrideThumbnail ||
                  profile.profilePicOverride ||
                  profile.currentAvatarThumbnailImageUrl ||
                  profile.currentAvatarImageUrl ||
                  '',
              256
          )
        : '';
    const presenceLocation = resolvePresenceLocation(profile);
    const inviteInstanceCache = useMemo(() => {
        const cache = buildCachedInstanceMap(groupInstances);
        function setCachedInstance(location, instance) {
            if (!location || !instance) {
                return;
            }
            const key = locationCacheKey(location);
            const existing =
                cache.get(location) || (key ? cache.get(key) : null);
            const merged =
                existing?.closedAt && !instance?.closedAt
                    ? { ...instance, closedAt: existing.closedAt }
                    : instance;
            cache.set(location, merged);
            if (key) {
                cache.set(key, merged);
            }
        }
        if (locationPanel.location && locationPanel.instance) {
            setCachedInstance(locationPanel.location, locationPanel.instance);
        }
        if (
            currentInviteLocation &&
            isSameLocationTag(locationPanel.location, currentInviteLocation) &&
            locationPanel.instance
        ) {
            setCachedInstance(currentInviteLocation, locationPanel.instance);
        }
        if (currentInviteLocation && currentInviteInstance) {
            setCachedInstance(currentInviteLocation, currentInviteInstance);
        }
        const currentInviteKey = locationCacheKey(currentInviteLocation);
        const cachedCurrentInviteInstance = currentInviteKey
            ? cache.get(currentInviteKey)
            : null;
        if (currentInviteLocation && cachedCurrentInviteInstance) {
            setCachedInstance(
                currentInviteLocation,
                cachedCurrentInviteInstance
            );
        }
        return cache;
    }, [
        currentInviteLocation,
        currentInviteInstance,
        groupInstances,
        groupInstancesRevision,
        locationPanel.instance,
        locationPanel.location
    ]);
    const canInviteFromCurrentLocation =
        currentInviteInstanceStatus !== 'running' &&
        checkCanInvite(currentInviteLocation, {
            currentUserId,
            lastLocationStr: '',
            cachedInstances: inviteInstanceCache
        });

    async function findIncomingFriendRequestNotification(rosterUserId) {
        const normalizedCurrentUserId = normalizeUserId(currentUserId);
        if (!normalizedCurrentUserId || !rosterUserId) {
            return null;
        }

        const rows = await notificationRepository.queryNotifications({
            userId: normalizedCurrentUserId,
            filters: ['friendRequest']
        });
        return (
            rows.find(
                (row) =>
                    row?.type === 'friendRequest' &&
                    !row.expired &&
                    normalizeUserId(row.senderUserId) === rosterUserId
            ) || null
        );
    }

    async function dismissBoopNotifications(rosterUserId) {
        const normalizedCurrentUserId = normalizeUserId(currentUserId);
        if (!normalizedCurrentUserId || !rosterUserId) {
            return;
        }

        const rows = await notificationRepository.queryNotifications({
            userId: normalizedCurrentUserId,
            filters: ['boop']
        });
        const matchingRows = rows.filter(
            (row) =>
                row?.type === 'boop' &&
                !row.expired &&
                row.link === `user:${rosterUserId}`
        );
        await Promise.allSettled(
            matchingRows.map(async (row) => {
                try {
                    await notificationRepository.hideRemoteNotification({
                        id: row.id,
                        version: row.version,
                        type: row.type,
                        senderUserId: row.senderUserId,
                        endpoint: currentEndpoint
                    });
                } finally {
                    await notificationRepository.expireNotification({
                        userId: normalizedCurrentUserId,
                        id: row.id
                    });
                }
            })
        );
    }

    async function editMemo() {
        const targetProfile = profile;
        const targetUserId = normalizeUserId(targetProfile?.id);
        const targetEndpoint = currentEndpoint;
        const editingCurrentUser = isCurrentUser;
        if (!targetUserId) {
            return;
        }

        let nextNote = targetProfile.note || '';
        if (!editingCurrentUser) {
            const noteResult = await prompt({
                title: appI18n.t('dialog.user.generated_modal.edit_vrchat_note'),
                description: targetProfile.displayName || targetProfile.id,
                inputValue: nextNote,
                multiline: true,
                confirmText: appI18n.t('dialog.user.generated_modal.next'),
                cancelText: appI18n.t('common.actions.cancel')
            });
            if (!noteResult.ok) {
                return;
            }
            nextNote = String(noteResult.value || '').slice(0, 256);
        }

        const result = await prompt({
            title: appI18n.t('dialog.user.generated_modal.edit_local_memo'),
            description: targetProfile.displayName || targetProfile.id,
            inputValue: memo,
            multiline: true,
            confirmText: appI18n.t('common.actions.save'),
            cancelText: appI18n.t('common.actions.cancel')
        });

        if (!result.ok) {
            return;
        }

        memoRevisionRef.current += 1;
        try {
            if (
                !editingCurrentUser &&
                nextNote !== (targetProfile.note || '')
            ) {
                await toolsRepository.saveUserNote(
                    {
                        targetUserId,
                        note: nextNote
                    },
                    { endpoint: targetEndpoint }
                );
            }
            const nextEntry = await memoRepository.saveUserMemo({
                userId: targetUserId,
                memo: result.value
            });
            if (
                activeUserTargetRef.current.userId !== targetUserId ||
                activeUserTargetRef.current.endpoint !== targetEndpoint
            ) {
                return;
            }
            const nextMemo = nextEntry.memo || '';
            const rosterUserId = targetUserId;
            setMemo(nextMemo);
            setBaseProfile((currentProfile) =>
                normalizeUserId(currentProfile?.id) === targetUserId
                    ? {
                          ...currentProfile,
                          note: nextNote,
                          memo: nextMemo,
                          $nickName: nextMemo
                      }
                    : currentProfile
            );
            if (rosterUserId && friendsById[rosterUserId]) {
                applyFriendPatch({
                    userId: rosterUserId,
                    patch: {
                        note: nextNote,
                        memo: nextMemo,
                        $nickName: nextMemo
                    },
                    stateBucket:
                        friendsById[rosterUserId]?.stateBucket ||
                        friendsById[rosterUserId]?.state
                });
            }
            toast.success(nextMemo ? appI18n.t('dialog.user.generated_toast.memo_saved') : appI18n.t('dialog.user.generated_toast.memo_cleared'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : appI18n.t('dialog.user.generated_toast.failed_to_save_memo')
            );
        }
    }

    async function refreshProfile() {
        setReloadToken((value) => value + 1);
    }

    function applyCurrentUserSnapshot(nextUser) {
        const displayBaseUser = mergeCurrentUserPresenceFields(
            nextUser,
            baseProfile
        );
        const storeUser = mergeCurrentUserPresenceFields(
            nextUser,
            useRuntimeStore.getState().auth.currentUserSnapshot
        );
        setBaseProfile(displayBaseUser);
        if (storeUser?.id) {
            useRuntimeStore.getState().setAuthBootstrap({
                currentUserId: storeUser.id,
                currentUserDisplayName:
                    storeUser.displayName || storeUser.username || storeUser.id,
                currentUserSnapshot: storeUser
            });
        }
    }

    async function saveCurrentUserPatch(
        patch,
        { successMessage, errorMessage }
    ) {
        if (!isCurrentUser || actionStatusRef.current !== 'idle') {
            return false;
        }

        actionStatusRef.current = 'self-profile';
        setActionStatus('self-profile');
        try {
            const nextUser = await userProfileRepository.updateCurrentUser({
                userId: currentUserId,
                endpoint: currentEndpoint,
                params: patch
            });
            applyCurrentUserSnapshot(nextUser);
            toast.success(successMessage);
            return true;
        } catch (error) {
            toast.error(userFacingErrorMessage(error, errorMessage));
            return false;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    function openSelfSocialStatusDialog() {
        if (!isCurrentUser || actionStatusRef.current !== 'idle') {
            return;
        }
        setSocialStatusDraft({
            status: normalizeSelfStatusInput(profile.status) || 'active',
            statusDescription: String(profile.statusDescription || '').slice(
                0,
                32
            )
        });
        setSocialStatusDialogOpen(true);
    }

    async function editSelfStatus() {
        openSelfSocialStatusDialog();
    }

    async function saveSelfSocialStatus() {
        const nextStatus = normalizeSelfStatusInput(socialStatusDraft.status);
        if (
            !nextStatus ||
            (!profile?.$isModerator && nextStatus === 'offline')
        ) {
            toast.warning(appI18n.t('dialog.user.generated.please_choose_a_valid_social_status'));
            return;
        }
        const saved = await saveCurrentUserPatch(
            {
                status: nextStatus,
                statusDescription: String(
                    socialStatusDraft.statusDescription || ''
                ).slice(0, 32)
            },
            {
                successMessage: 'Status updated.',
                errorMessage: 'Failed to update social status.'
            }
        );
        if (saved) {
            setSocialStatusDialogOpen(false);
        }
    }

    async function saveSelfStatusPreset() {
        const nextStatus = normalizeSelfStatusInput(socialStatusDraft.status);
        if (!nextStatus) {
            toast.warning(appI18n.t('dialog.user.generated.please_choose_a_valid_social_status'));
            return;
        }
        const nextPreset = {
            status: nextStatus,
            statusDescription: String(
                socialStatusDraft.statusDescription || ''
            ).slice(0, 32)
        };
        if (
            statusPresets.some(
                (preset) =>
                    preset?.status === nextPreset.status &&
                    String(preset?.statusDescription || '') ===
                        nextPreset.statusDescription
            )
        ) {
            toast.info(appI18n.t('dialog.user.generated.status_preset_already_exists'));
            return;
        }
        if (statusPresets.length >= maxStatusPresets) {
            toast.warning(appI18n.t('dialog.user.generated_dynamic.status_presets_are_limited_to_value', { value: maxStatusPresets }));
            return;
        }

        const nextPresets = [...statusPresets, nextPreset];
        setStatusPresets(nextPresets);
        try {
            await configRepository.setArray(
                statusPresetsConfigKey,
                nextPresets
            );
            toast.success(appI18n.t('dialog.user.generated.status_preset_saved'));
        } catch (error) {
            setStatusPresets(statusPresets);
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_save_status_preset')
            );
        }
    }

    async function removeSelfStatusPreset(index) {
        const nextPresets = statusPresets.filter(
            (_, presetIndex) => presetIndex !== index
        );
        setStatusPresets(nextPresets);
        try {
            await configRepository.setArray(
                statusPresetsConfigKey,
                nextPresets
            );
        } catch (error) {
            setStatusPresets(statusPresets);
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_remove_status_preset')
            );
        }
    }

    async function editSelfLanguages() {
        if (!isCurrentUser || actionStatusRef.current !== 'idle') {
            return;
        }
        setSelectedLanguageToAdd('');
        setLanguageDialogOpen(true);
    }

    async function addSelfLanguage(languageKey) {
        const key = normalizeLanguageKey(languageKey);
        if (!isCurrentUser || actionStatusRef.current !== 'idle' || !key) {
            return;
        }
        if (selectedLanguageKeys.has(key) || currentLanguageRows.length >= 3) {
            return;
        }

        actionStatusRef.current = 'self-profile';
        setActionStatus('self-profile');
        try {
            const nextUser = await userProfileRepository.addCurrentUserTags({
                userId: currentUserId,
                endpoint: currentEndpoint,
                tags: [`language_${key}`]
            });
            applyCurrentUserSnapshot(nextUser);
            setSelectedLanguageToAdd('');
            toast.success(appI18n.t('dialog.user.generated.language_added'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_add_language')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function removeSelfLanguage(languageKey) {
        const key = normalizeLanguageKey(languageKey);
        if (!isCurrentUser || actionStatusRef.current !== 'idle' || !key) {
            return;
        }

        actionStatusRef.current = 'self-profile';
        setActionStatus('self-profile');
        try {
            const nextUser = await userProfileRepository.removeCurrentUserTags({
                userId: currentUserId,
                endpoint: currentEndpoint,
                tags: [`language_${key}`]
            });
            applyCurrentUserSnapshot(nextUser);
            setSelectedLanguageToAdd('');
            toast.success(appI18n.t('dialog.user.generated.language_removed'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_remove_language')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function editSelfBio() {
        const result = await prompt({
            title: appI18n.t('dialog.user.generated_modal.edit_bio'),
            inputValue: profile.bio || '',
            multiline: true,
            confirmText: appI18n.t('common.actions.save'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (result.ok) {
            await saveCurrentUserPatch(
                { bio: result.value },
                {
                    successMessage: 'Bio updated.',
                    errorMessage: 'Failed to update bio.'
                }
            );
        }
    }

    async function editSelfBioLinks() {
        const result = await prompt({
            title: appI18n.t('dialog.user.generated_modal.edit_bio_links'),
            description: appI18n.t('dialog.user.generated_modal.one_link_per_line_up_to_3'),
            inputValue: Array.isArray(profile.bioLinks)
                ? profile.bioLinks.join('\n')
                : '',
            multiline: true,
            confirmText: appI18n.t('common.actions.save'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (result.ok) {
            await saveCurrentUserPatch(
                {
                    bioLinks: String(result.value || '')
                        .split(/\r?\n/)
                        .map((link) => link.trim())
                        .filter(Boolean)
                        .slice(0, 3)
                },
                {
                    successMessage: 'Bio links updated.',
                    errorMessage: 'Failed to update bio links.'
                }
            );
        }
    }

    async function editSelfPronouns() {
        const result = await prompt({
            title: appI18n.t('dialog.user.generated_modal.edit_pronouns'),
            inputValue: Array.isArray(profile.pronouns)
                ? profile.pronouns.join(', ')
                : profile.pronouns || '',
            confirmText: appI18n.t('common.actions.save'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (result.ok) {
            await saveCurrentUserPatch(
                { pronouns: result.value },
                {
                    successMessage: 'Pronouns updated.',
                    errorMessage: 'Failed to update pronouns.'
                }
            );
        }
    }

    async function toggleSelfAvatarCopying() {
        await saveCurrentUserPatch(
            { allowAvatarCopying: !profile.allowAvatarCopying },
            {
                successMessage: 'Avatar cloning setting updated.',
                errorMessage: 'Failed to update avatar cloning setting.'
            }
        );
    }

    async function toggleSelfBooping() {
        await saveCurrentUserPatch(
            { isBoopingEnabled: profile.isBoopingEnabled === false },
            {
                successMessage: 'Booping setting updated.',
                errorMessage: 'Failed to update booping setting.'
            }
        );
    }

    async function toggleSelfSharedConnections() {
        await saveCurrentUserPatch(
            { hasSharedConnectionsOptOut: !profile.hasSharedConnectionsOptOut },
            {
                successMessage: 'Shared connections setting updated.',
                errorMessage: 'Failed to update shared connections setting.'
            }
        );
    }

    async function toggleSelfDiscordConnections() {
        await saveCurrentUserPatch(
            { hasDiscordFriendsOptOut: !profile.hasDiscordFriendsOptOut },
            {
                successMessage: 'Discord connections setting updated.',
                errorMessage: 'Failed to update Discord connections setting.'
            }
        );
    }

    async function toggleBadgeVisibility(badge, hidden) {
        if (
            !isCurrentUser ||
            actionStatusRef.current !== 'idle' ||
            !badge?.badgeId
        ) {
            return;
        }

        actionStatusRef.current = 'self-profile';
        setActionStatus('self-profile');
        try {
            const nextUser = await userProfileRepository.updateCurrentUserBadge(
                {
                    userId: currentUserId,
                    endpoint: currentEndpoint,
                    badgeId: badge.badgeId,
                    hidden,
                    showcased: hidden ? false : Boolean(badge.showcased)
                }
            );
            applyCurrentUserSnapshot(nextUser);
            toast.success(appI18n.t('dialog.user.generated.badge_updated'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_update_badge')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function toggleBadgeShowcased(badge, showcased) {
        if (
            !isCurrentUser ||
            actionStatusRef.current !== 'idle' ||
            !badge?.badgeId
        ) {
            return;
        }

        actionStatusRef.current = 'self-profile';
        setActionStatus('self-profile');
        try {
            const nextUser = await userProfileRepository.updateCurrentUserBadge(
                {
                    userId: currentUserId,
                    endpoint: currentEndpoint,
                    badgeId: badge.badgeId,
                    hidden: showcased ? false : Boolean(badge.hidden),
                    showcased
                }
            );
            applyCurrentUserSnapshot(nextUser);
            toast.success(appI18n.t('dialog.user.generated.badge_updated'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_update_badge')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function unfriendUser() {
        const rosterUserId = normalizeUserId(profile?.id);
        const friend = friendsById[rosterUserId] || profile;
        if (
            !rosterUserId ||
            !isFriend ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        actionStatusRef.current = 'unfriend';
        setActionStatus('unfriend');
        const result = await confirm({
            title: appI18n.t('dialog.user.generated_modal.unfriend_user'),
            description: friend?.displayName || rosterUserId,
            confirmText: appI18n.t('dialog.user.generated_modal.unfriend'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            const deleteResult = await friendRelationshipService.deleteFriend({
                friend,
                userId: rosterUserId,
                endpoint: currentEndpoint,
                currentUserId
            });
            if (deleteResult.stale) {
                toast.info(
                    appI18n.t('dialog.user.generated.unfriend_request_sent_but_the_active_session_changed_before_')
                );
            } else {
                setBaseProfile((currentProfile) =>
                    currentProfile
                        ? {
                              ...currentProfile,
                              isFriend: false,
                              friendRequestStatus: ''
                          }
                        : currentProfile
                );
                toast.success(
                    appI18n.t('dialog.user.generated_dynamic.unfriended_value', { value: friend?.displayName || rosterUserId })
                );
            }
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_unfriend_user')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function updateFriendRequest(action) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }
        const requestEndpoint = currentEndpoint;
        const requestProfile = profile;
        function commitFriendRequestPatch(patch) {
            if (
                activeUserTargetRef.current.userId !== rosterUserId ||
                activeUserTargetRef.current.endpoint !== requestEndpoint
            ) {
                return false;
            }
            setBaseProfile((currentProfile) =>
                normalizeUserId(currentProfile?.id) === rosterUserId
                    ? { ...currentProfile, ...patch }
                    : currentProfile
            );
            return true;
        }

        const isSendAction = action === 'send' || action === 'accept';
        const label =
            action === 'accept'
                ? 'Accept friend request'
                : action === 'decline'
                  ? 'Decline friend request'
                  : action === 'cancel'
                    ? 'Cancel friend request'
                    : 'Send friend request';

        actionStatusRef.current = `friend-request:${action}`;
        setActionStatus(actionStatusRef.current);
        const result = await confirm({
            title: appI18n.t('dialog.user.generated_dynamic.value', { value: label }),
            description: profile?.displayName || rosterUserId,
            confirmText:
                action === 'accept'
                    ? 'Accept'
                    : action === 'decline'
                      ? 'Decline'
                      : action === 'cancel'
                        ? 'Cancel Request'
                        : 'Send Request',
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: action === 'decline' || action === 'cancel'
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        let incomingNotification = null;
        try {
            if (isSendAction) {
                incomingNotification =
                    action === 'accept'
                        ? await findIncomingFriendRequestNotification(
                              rosterUserId
                          )
                        : null;
                if (action === 'accept' && !incomingNotification) {
                    if (
                        !commitFriendRequestPatch({
                            friendRequestStatus: '',
                            incomingRequest: false,
                            outgoingRequest: false
                        })
                    ) {
                        return;
                    }
                    toast.info(appI18n.t('dialog.user.generated.friend_request_is_no_longer_active'));
                    return;
                }
                const response =
                    action === 'accept'
                        ? await notificationRepository.acceptFriendRequest({
                              id: incomingNotification.id,
                              endpoint: requestEndpoint
                          })
                        : await vrchatFriendRepository.sendFriendRequest({
                              userId: rosterUserId,
                              endpoint: requestEndpoint
                          });
                if (incomingNotification) {
                    await notificationRepository.expireNotification({
                        userId: currentUserId,
                        id: incomingNotification.id
                    });
                }
                const isNowFriend = incomingNotification
                    ? true
                    : Boolean(response?.json?.success);
                if (
                    !commitFriendRequestPatch({
                        isFriend: isNowFriend,
                        friendRequestStatus: isNowFriend ? '' : 'outgoing',
                        incomingRequest: false,
                        outgoingRequest: !isNowFriend
                    })
                ) {
                    return;
                }
                if (isNowFriend) {
                    applyFriendPatch({
                        userId: rosterUserId,
                        patch: {
                            ...requestProfile,
                            id: rosterUserId,
                            isFriend: true,
                            friendRequestStatus: '',
                            incomingRequest: false,
                            outgoingRequest: false
                        },
                        stateBucket:
                            requestProfile?.stateBucket ||
                            requestProfile?.state ||
                            'offline'
                    });
                }
                if (action === 'send') {
                    recordDialogRecentAction(
                        rosterUserId,
                        'Send Friend Request'
                    );
                }
                toast.success(
                    isNowFriend
                        ? appI18n.t('dialog.user.generated_toast.friend_request_accepted')
                        : appI18n.t('dialog.user.generated_toast.friend_request_sent')
                );
            } else {
                incomingNotification =
                    action === 'decline'
                        ? await findIncomingFriendRequestNotification(
                              rosterUserId
                          )
                        : null;
                if (action === 'decline' && !incomingNotification) {
                    if (
                        !commitFriendRequestPatch({
                            friendRequestStatus: '',
                            incomingRequest: false,
                            outgoingRequest: false
                        })
                    ) {
                        return;
                    }
                    toast.info(appI18n.t('dialog.user.generated.friend_request_is_no_longer_active'));
                    return;
                }
                if (incomingNotification) {
                    await notificationRepository.hideRemoteNotification({
                        id: incomingNotification.id,
                        version: incomingNotification.version,
                        type: incomingNotification.type,
                        senderUserId: incomingNotification.senderUserId,
                        endpoint: requestEndpoint
                    });
                    await notificationRepository.expireNotification({
                        userId: currentUserId,
                        id: incomingNotification.id
                    });
                } else {
                    await vrchatFriendRepository.cancelFriendRequest({
                        userId: rosterUserId,
                        endpoint: requestEndpoint
                    });
                }
                if (
                    !commitFriendRequestPatch({
                        friendRequestStatus: '',
                        incomingRequest: false,
                        outgoingRequest: false
                    })
                ) {
                    return;
                }
                toast.success(
                    action === 'decline'
                        ? appI18n.t('dialog.user.generated_toast.friend_request_declined')
                        : appI18n.t('dialog.user.generated_toast.friend_request_cancelled')
                );
            }
        } catch (error) {
            if (
                (action === 'accept' || action === 'decline') &&
                incomingNotification &&
                error?.status === 404
            ) {
                await notificationRepository
                    .expireNotification({
                        userId: currentUserId,
                        id: incomingNotification.id
                    })
                    .catch(() => {});
                if (
                    !commitFriendRequestPatch({
                        friendRequestStatus: '',
                        incomingRequest: false,
                        outgoingRequest: false
                    })
                ) {
                    return;
                }
                toast.info(appI18n.t('dialog.user.generated.friend_request_is_no_longer_active'));
                return;
            }
            toast.error(
                error instanceof Error ? error.message : appI18n.t('dialog.user.generated_toast.value_failed', { value: label })
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setUserModeration(type, enabled) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            (enabled && profile?.$isModerator) ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const label =
            type === 'block'
                ? enabled
                    ? 'Block'
                    : 'Unblock'
                : enabled
                  ? 'Mute'
                  : 'Unmute';

        actionStatusRef.current = `${type}:${enabled ? 'enable' : 'disable'}`;
        setActionStatus(actionStatusRef.current);
        const result = await confirm({
            title: appI18n.t('dialog.user.generated_dynamic.value_user', { value: label }),
            description: profile?.displayName || rosterUserId,
            confirmText: label,
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: enabled
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            if (enabled) {
                await vrchatModerationRepository.sendPlayerModeration({
                    endpoint: currentEndpoint,
                    moderated: rosterUserId,
                    type
                });
            } else {
                await vrchatModerationRepository.deletePlayerModeration({
                    endpoint: currentEndpoint,
                    moderated: rosterUserId,
                    type
                });
            }

            moderationRevisionRef.current += 1;
            const nextModerationState = {
                ...moderationState,
                [type]: enabled
            };
            if (currentUserId) {
                await userSessionRepository.ensureUserTables(currentUserId);
            }
            const savedState =
                await vrchatModerationRepository.saveLocalModeration({
                    ownerUserId: currentUserId,
                    userId: rosterUserId,
                    displayName: profile?.displayName || rosterUserId,
                    ...nextModerationState
                });
            setModerationState({
                block: Boolean(savedState.block),
                mute: Boolean(savedState.mute)
            });
            toast.success(appI18n.t('dialog.user.generated_dynamic.value_request_sent', { value: label }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_value_user', { value: label.toLowerCase() })
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setExtendedUserModeration(type, enabled) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const labelMap = {
            interactOff: enabled
                ? 'Disable Avatar Interaction'
                : 'Enable Avatar Interaction',
            muteChat: enabled ? 'Disable Chatbox' : 'Enable Chatbox'
        };
        const label =
            labelMap[type] || (enabled ? `Enable ${type}` : `Disable ${type}`);

        actionStatusRef.current = `${type}:${enabled ? 'enable' : 'disable'}`;
        setActionStatus(actionStatusRef.current);
        const result = await confirm({
            title: appI18n.t('dialog.user.generated_dynamic.value', { value: label }),
            description: profile?.displayName || rosterUserId,
            confirmText: label,
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: enabled
        });

        if (!result.ok) {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
            return;
        }

        try {
            if (enabled) {
                await vrchatModerationRepository.sendPlayerModeration({
                    endpoint: currentEndpoint,
                    moderated: rosterUserId,
                    type
                });
            } else {
                await vrchatModerationRepository.deletePlayerModeration({
                    endpoint: currentEndpoint,
                    moderated: rosterUserId,
                    type
                });
            }
            setExtendedModerationState((current) => ({
                ...current,
                [type]: enabled
            }));
            toast.success(appI18n.t('dialog.user.generated_dynamic.value_request_sent', { value: label }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_value', { value: label.toLowerCase() })
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function setAvatarOverrideModeration(type) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            !normalizedCurrentUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const nextType =
            type === 'hideAvatar'
                ? avatarOverrideState.hideAvatar
                    ? 0
                    : 4
                : avatarOverrideState.showAvatar
                  ? 0
                  : 5;
        const label =
            type === 'hideAvatar'
                ? nextType === 0
                    ? 'Reset Hidden Avatar'
                    : 'Hide Avatar'
                : nextType === 0
                  ? 'Reset Shown Avatar'
                  : 'Show Avatar';

        actionStatusRef.current = `avatar-override:${nextType}`;
        setActionStatus(actionStatusRef.current);
        try {
            const result = await backend.app.SetVRChatUserModeration(
                normalizedCurrentUserId,
                rosterUserId,
                nextType
            );
            if (result === false) {
                throw new Error('Avatar moderation update failed.');
            }
            setAvatarOverrideState({
                hideAvatar: nextType === 4,
                showAvatar: nextType === 5
            });
            toast.success(appI18n.t('dialog.user.generated_dynamic.value_updated', { value: label }));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_update_avatar_moderation')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function reportHacking() {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const result = await confirm({
            title: appI18n.t('dialog.user.generated_modal.report_hacking'),
            description: profile?.displayName || rosterUserId,
            confirmText: appI18n.t('dialog.user.generated_modal.report'),
            cancelText: appI18n.t('common.actions.cancel'),
            destructive: true
        });
        if (!result.ok) {
            return;
        }

        actionStatusRef.current = 'report-hacking';
        setActionStatus('report-hacking');
        try {
            await toolsRepository.reportUser(
                {
                    userId: rosterUserId,
                    contentType: 'user',
                    reason: 'behavior-hacking',
                    type: 'report'
                },
                { endpoint: currentEndpoint }
            );
            toast.success(appI18n.t('dialog.user.generated.report_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_report_user')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    function inviteMessageSlot(row) {
        const value =
            row?.slot ?? row?.messageSlot ?? row?.requestSlot ?? row?.id;
        return Number.parseInt(value, 10);
    }

    function buildInviteContext({ requireCurrentUser = false } = {}) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            !isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return null;
        }

        if (requireCurrentUser && !normalizedCurrentUserId) {
            toast.error(
                appI18n.t('dialog.user.generated.cannot_load_message_templates_no_current_user_session_is_ava')
            );
            return null;
        }

        if (!currentInviteLocation) {
            toast.error(
                appI18n.t('dialog.user.generated.cannot_invite_no_current_vrchat_location_is_available')
            );
            return null;
        }
        if (!canInviteFromCurrentLocation) {
            toast.error(appI18n.t('dialog.user.generated.cannot_invite_from_the_current_instance_type'));
            return null;
        }

        const parsedLocation = parseLocation(currentInviteLocation);
        if (!parsedLocation.worldId || !parsedLocation.instanceId) {
            toast.error(
                appI18n.t('dialog.user.generated.cannot_invite_current_location_is_not_a_concrete_instance')
            );
            return null;
        }

        return {
            rosterUserId,
            endpoint: currentEndpoint,
            messageOwnerUserId: normalizedCurrentUserId,
            parsedLocation,
            inviteLocation: parsedLocation.tag || currentInviteLocation,
            targetLabel: profile?.displayName || rosterUserId
        };
    }

    function buildInviteRequestContext({ requireCurrentUser = false } = {}) {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            !isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return null;
        }

        if (requireCurrentUser && !normalizedCurrentUserId) {
            toast.error(
                appI18n.t('dialog.user.generated.cannot_load_message_templates_no_current_user_session_is_ava')
            );
            return null;
        }

        return {
            rosterUserId,
            endpoint: currentEndpoint,
            messageOwnerUserId: normalizedCurrentUserId,
            targetLabel: profile?.displayName || rosterUserId
        };
    }

    function recordDialogRecentAction(userId, actionType) {
        recordRecentAction(userId, actionType);
    }

    async function performSendUserInvite({
        messageSlot = null,
        context: contextSnapshot = null
    } = {}) {
        const context = contextSnapshot || buildInviteContext();
        if (!context) {
            return false;
        }
        if (actionStatusRef.current !== 'idle') {
            return false;
        }

        actionStatusRef.current = 'invite';
        setActionStatus('invite');
        try {
            const worldResponse = await vrchatSearchRepository.getWorlds(
                {},
                context.parsedLocation.worldId,
                { endpoint: context.endpoint }
            );
            const params = {
                instanceId: context.inviteLocation,
                worldId: context.parsedLocation.worldId,
                worldName:
                    worldResponse.json?.name || context.parsedLocation.worldId,
                rsvp: true
            };
            if (messageSlot !== null) {
                params.messageSlot = messageSlot;
            }
            await notificationRepository.sendInvite({
                receiverUserId: context.rosterUserId,
                endpoint: context.endpoint,
                params
            });
            recordDialogRecentAction(
                context.rosterUserId,
                messageSlot !== null ? 'Invite Message' : 'Invite'
            );
            toast.success(
                messageSlot !== null ? appI18n.t('dialog.user.generated_toast.invite_message_sent') : appI18n.t('dialog.user.generated_toast.invite_sent')
            );
            return true;
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_send_invite')
            );
            return false;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function sendUserInvite({ withMessage = false } = {}) {
        if (withMessage) {
            const context = buildInviteContext({ requireCurrentUser: true });
            if (context) {
                setInviteMessageRequest({
                    kind: 'invite',
                    messageType: 'message',
                    context
                });
            }
            return;
        }

        const context = buildInviteContext();
        if (!context) {
            return;
        }

        const result = await confirm({
            title: appI18n.t('dialog.user.generated_modal.send_invite'),
            description: profile?.displayName || context.rosterUserId,
            confirmText: appI18n.t('dialog.user.generated_modal.invite'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        await performSendUserInvite({ context });
    }

    async function performSendUserInviteRequest({
        requestSlot = null,
        context: contextSnapshot = null
    } = {}) {
        const context = contextSnapshot || buildInviteRequestContext();
        if (!context) {
            return false;
        }
        if (actionStatusRef.current !== 'idle') {
            return false;
        }

        actionStatusRef.current = 'request-invite';
        setActionStatus('request-invite');
        try {
            const params = {
                platform: 'standalonewindows'
            };
            if (requestSlot !== null) {
                params.requestSlot = requestSlot;
            }
            await notificationRepository.sendRequestInvite({
                receiverUserId: context.rosterUserId,
                endpoint: context.endpoint,
                params
            });
            recordDialogRecentAction(
                context.rosterUserId,
                requestSlot !== null
                    ? 'Request Invite Message'
                    : 'Request Invite'
            );
            toast.success(
                requestSlot !== null
                    ? appI18n.t('dialog.user.generated_toast.invite_request_message_sent')
                    : appI18n.t('dialog.user.generated_toast.invite_request_sent')
            );
            return true;
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : appI18n.t('dialog.user.generated_toast.failed_to_request_invite')
            );
            return false;
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function sendUserInviteRequest({ withMessage = false } = {}) {
        if (withMessage) {
            const context = buildInviteRequestContext({
                requireCurrentUser: true
            });
            if (context) {
                setInviteMessageRequest({
                    kind: 'request',
                    messageType: 'request',
                    context
                });
            }
            return;
        }

        const context = buildInviteRequestContext();
        if (!context) {
            return;
        }

        const result = await confirm({
            title: appI18n.t('dialog.user.generated_modal.request_invite'),
            description: profile?.displayName || context.rosterUserId,
            confirmText: appI18n.t('dialog.user.generated_modal.request_invite_2'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }

        await performSendUserInviteRequest({ context });
    }

    async function selectInviteMessage({ row }) {
        const slot = inviteMessageSlot(row);
        if (!Number.isFinite(slot)) {
            toast.error(appI18n.t('dialog.user.generated.invite_message_slot_must_be_a_number'));
            return false;
        }

        const request = inviteMessageRequest;
        const sent =
            request?.kind === 'request'
                ? await performSendUserInviteRequest({
                      requestSlot: slot,
                      context: request.context
                  })
                : await performSendUserInvite({
                      messageSlot: slot,
                      context: request?.context
                  });

        if (sent) {
            setInviteMessageRequest(null);
        }
        return sent;
    }

    async function sendUserBoop() {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            !isFriend ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        actionStatusRef.current = 'boop';
        setActionStatus('boop');
        try {
            const result = await prompt({
                title: appI18n.t('dialog.user.generated_modal.send_boop'),
                description:
                    appI18n.t('dialog.user.generated_modal.optional_emoji_id_leave_blank_to_send_the_defaul'),
                inputValue: '',
                confirmText: appI18n.t('dialog.user.generated_modal.send'),
                cancelText: appI18n.t('common.actions.cancel')
            });
            if (!result.ok) {
                return;
            }

            await dismissBoopNotifications(rosterUserId);
            await notificationRepository.sendBoop({
                userId: rosterUserId,
                emojiId: result.value,
                endpoint: currentEndpoint
            });
            toast.success(appI18n.t('dialog.user.generated.boop_sent'));
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : appI18n.t('dialog.user.generated_toast.failed_to_send_boop')
            );
        } finally {
            actionStatusRef.current = 'idle';
            setActionStatus('idle');
        }
    }

    async function openGroupModerationForUser() {
        const rosterUserId = normalizeUserId(profile?.id);
        if (
            !rosterUserId ||
            isCurrentUser ||
            actionStatusRef.current !== 'idle'
        ) {
            return;
        }

        const result = await prompt({
            title: appI18n.t('dialog.user.generated_modal.group_moderation'),
            description: appI18n.t('dialog.user.generated_dynamic.enter_a_group_id_to_open_moderation_for_value', { value: profile?.displayName || rosterUserId }),
            inputValue: '',
            confirmText: appI18n.t('common.actions.open'),
            cancelText: appI18n.t('common.actions.cancel')
        });
        if (!result.ok) {
            return;
        }
        const groupId = normalizeUserId(result.value);
        if (!groupId) {
            toast.error(appI18n.t('dialog.user.generated.group_id_is_required'));
            return;
        }
        openGroupDialog({ groupId });
    }

    if (loadStatus === 'running' && !profile) {
        return (
            <UserDialogEmptyState
                loading
                title={appI18n.t('dialog.user.generated.loading_user_profile')}
                description={appI18n.t('dialog.user.generated.fetching_the_current_vrchat_user_snapshot_for_this_dialog')}
            />
        );
    }

    if (!profile) {
        return (
            <UserDialogEmptyState
                title={appI18n.t('dialog.user.generated.user_profile_unavailable')}
                description={
                    detail ||
                    'VRCX-0 could not resolve a user snapshot for this dialog.'
                }
            />
        );
    }

    const currentAvatarTarget = normalizeUserId(profile.currentAvatar);
    const homeLocationTarget = normalizeUserId(profile.homeLocation);
    const hasResolvedLocationPanel = Boolean(locationPanel.location);
    const activeLocationPanel =
        hasResolvedLocationPanel &&
        (!presenceLocation ||
            isSameLocationTag(locationPanel.location, presenceLocation))
            ? locationPanel
            : {
                  location: '',
                  instance: null,
                  ownerUser: null,
                  users: [],
                  friendCount: 0,
                  playerCount: 0
              };

    return (
        <>
            <UserDialogTabbedView
                profile={profile}
                memo={memo}
                detail={detail}
                imageUrl={imageUrl}
                loadStatus={loadStatus}
                actionStatus={actionStatus}
                recentActionVersion={recentActionVersion}
                reloadToken={reloadToken}
                moderationState={moderationState}
                extendedModerationState={extendedModerationState}
                avatarOverrideState={avatarOverrideState}
                isCurrentUser={isCurrentUser}
                isFriend={isFriend}
                isFavorite={isFavorite}
                friendRequestState={friendRequestState}
                platform={platform}
                platformIcon={PlatformIcon}
                presenceLocation={presenceLocation}
                currentAvatarTarget={currentAvatarTarget}
                homeLocationTarget={homeLocationTarget}
                canInviteFromCurrentLocation={canInviteFromCurrentLocation}
                currentUserHasSharedConnectionsOptOut={Boolean(
                    currentUserSnapshot?.hasSharedConnectionsOptOut
                )}
                currentUserBoopingEnabled={
                    currentUserSnapshot?.isBoopingEnabled !== false
                }
                userStats={userStats}
                previousInstances={previousInstances}
                representedGroup={representedGroup}
                representedGroupStatus={representedGroupStatus}
                hideUserNotes={appearanceSettings.hideUserNotes}
                hideUserMemos={appearanceSettings.hideUserMemos}
                onPreviousInstancesChange={setPreviousInstances}
                sameInstanceUsers={activeLocationPanel.users}
                locationOwnerUser={activeLocationPanel.ownerUser}
                locationOwnerGroup={activeLocationPanel.ownerGroup}
                locationInstance={activeLocationPanel.instance}
                locationFriendCount={activeLocationPanel.friendCount}
                locationPlayerCount={activeLocationPanel.playerCount}
                onRefreshLocation={refreshLocationPanel}
                onRefresh={() => void refreshProfile()}
                onEditMemo={() => void editMemo()}
                onFriendRequest={(action) => void updateFriendRequest(action)}
                onInvite={() => void sendUserInvite()}
                onInviteMessage={() =>
                    void sendUserInvite({ withMessage: true })
                }
                onInviteRequest={() => void sendUserInviteRequest()}
                onInviteRequestMessage={() =>
                    void sendUserInviteRequest({ withMessage: true })
                }
                onBoop={() => void sendUserBoop()}
                onUnfriend={() => void unfriendUser()}
                onModeration={(type, enabled) =>
                    void setUserModeration(type, enabled)
                }
                onExtendedModeration={(type, enabled) =>
                    void setExtendedUserModeration(type, enabled)
                }
                onAvatarOverride={(type) =>
                    void setAvatarOverrideModeration(type)
                }
                onReportHacking={() => void reportHacking()}
                onGroupModeration={() => void openGroupModerationForUser()}
                onEditSelfStatus={() => void editSelfStatus()}
                onEditSelfLanguages={() => void editSelfLanguages()}
                onEditSelfBio={() => void editSelfBio()}
                onEditSelfBioLinks={() => void editSelfBioLinks()}
                onEditSelfPronouns={() => void editSelfPronouns()}
                onToggleSelfAvatarCopying={() => void toggleSelfAvatarCopying()}
                onToggleSelfBooping={() => void toggleSelfBooping()}
                onToggleSelfSharedConnections={() =>
                    void toggleSelfSharedConnections()
                }
                onToggleSelfDiscordConnections={() =>
                    void toggleSelfDiscordConnections()
                }
                onToggleBadgeVisibility={(badge, hidden) =>
                    void toggleBadgeVisibility(badge, hidden)
                }
                onToggleBadgeShowcased={(badge, showcased) =>
                    void toggleBadgeShowcased(badge, showcased)
                }
            />
            <UserSocialStatusDialog
                open={socialStatusDialogOpen}
                onOpenChange={(nextOpen) => {
                    if (nextOpen || actionStatusRef.current === 'idle') {
                        setSocialStatusDialogOpen(nextOpen);
                    }
                }}
                actionStatus={actionStatus}
                draft={socialStatusDraft}
                setDraft={setSocialStatusDraft}
                statusHistoryRows={statusHistoryRows}
                statusOptions={selfStatusOptions}
                statusPresets={statusPresets}
                statusLabelByValue={selfStatusLabelByValue}
                onSavePreset={() => void saveSelfStatusPreset()}
                onRemovePreset={(index) => void removeSelfStatusPreset(index)}
                onCancel={() => setSocialStatusDialogOpen(false)}
                onSave={() => void saveSelfSocialStatus()}
            />
            <UserLanguageDialog
                open={languageDialogOpen}
                onOpenChange={(nextOpen) => {
                    if (nextOpen || actionStatusRef.current === 'idle') {
                        setLanguageDialogOpen(nextOpen);
                    }
                }}
                actionStatus={actionStatus}
                currentLanguageRows={currentLanguageRows}
                availableLanguageOptions={availableLanguageOptions}
                selectedLanguageToAdd={selectedLanguageToAdd}
                languageOptionsStatus={languageOptionsStatus}
                onSelectedLanguageChange={setSelectedLanguageToAdd}
                onAddLanguage={(value) => void addSelfLanguage(value)}
                onRemoveLanguage={(languageKey) =>
                    void removeSelfLanguage(languageKey)
                }
            />            <InviteMessageDialog
                open={Boolean(inviteMessageRequest)}
                onOpenChange={(nextOpen) => {
                    if (!nextOpen && actionStatusRef.current === 'idle') {
                        setInviteMessageRequest(null);
                    }
                }}
                currentUserId={
                    inviteMessageRequest?.context?.messageOwnerUserId ||
                    normalizedCurrentUserId
                }
                endpoint={
                    inviteMessageRequest?.context?.endpoint || currentEndpoint
                }
                messageType={inviteMessageRequest?.messageType || 'message'}
                mode="select"
                title={
                    inviteMessageRequest?.kind === 'request'
                        ? 'Request With Message'
                        : 'Send With Message'
                }
                targetLabel={
                    inviteMessageRequest?.context?.targetLabel ||
                    profile?.displayName ||
                    profile?.id ||
                    'this user'
                }
                allowEdit={false}
                allowImageUpload={false}
                onUse={selectInviteMessage}
            />
        </>
    );
}

