import { getKnownUserFact } from '@/domain/users/userFactAccess';
import { tauriClient } from '@/platform/tauri/client';
import configRepository from '@/repositories/configRepository';
import memoPersistenceRepository from '@/repositories/memoPersistenceRepository';
import { userImage as resolveUserImageUrl } from '@/services/entityMediaService';
import {
    normalizeOverlayActivityFilterProfile,
    OVERLAY_ACTIVITY_TYPE_DEFINITIONS,
    parseOverlayActivityFilterProfile,
    type OverlayActivityRule,
    type OverlayActivityTypeDefinition
} from '@/shared/constants/overlayActivityFilters';
import i18n from '@/services/i18nService';
import { onPreferenceChanged } from '@/shared/events/preferenceEvents';
import { extractFileId, extractFileVersion } from '@/shared/utils/fileUtils';
import { displayLocation } from '@/shared/utils/locationParser';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useFriendRosterStore } from '@/state/friendRosterStore';
import { useRuntimeStore } from '@/state/runtimeStore';

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
    desktopToast: 'Never',
    afkDesktopToast: false,
    desktopNotificationSound: false,
    notificationTTS: 'Never',
    notificationTTSVoice: '0',
    notificationTTSNickName: false,
    xsNotifications: true,
    ovrtHudNotifications: true,
    ovrtWristNotifications: false,
    imageNotifications: true,
    notificationTimeout: 3000,
    notificationOpacity: 100,
    vrNotificationActivityFilters: normalizeOverlayActivityFilterProfile()
});

const NOTIFICATION_PREFERENCE_KEYS = Object.keys(
    DEFAULT_NOTIFICATION_PREFERENCES
);
const BODY_ONLY_TYPES = new Set([
    'boop',
    'group.announcement',
    'group.informative',
    'group.invite',
    'group.joinRequest',
    'group.transfer',
    'group.queueReady',
    'instance.closed',
    'Event',
    'External'
]);
const COLON_SEPARATOR_TYPES = new Set(['groupChange', 'VideoPlay']);
const OVERLAY_ACTIVITY_DEFINITION_BY_NOTIFICATION_TYPE = Object.fromEntries(
    OVERLAY_ACTIVITY_TYPE_DEFINITIONS.flatMap((definition) => [
        [definition.key, definition],
        ...(definition.aliases || []).map((alias) => [alias, definition])
    ])
) as Record<string, OverlayActivityTypeDefinition>;
type NotificationPreferenceKey = keyof typeof DEFAULT_NOTIFICATION_PREFERENCES;

let cachedPreferences: Record<
    NotificationPreferenceKey,
    string | boolean | number | object
> = {
    ...DEFAULT_NOTIFICATION_PREFERENCES
};
let preferencesLoaded = false;
let preferencesLoadPromise = null;
let unsubscribePreferences = null;
let preferenceRevision = 0;
const changedPreferenceKeys = new Set<NotificationPreferenceKey>();
const LEGACY_OVERLAY_NOTIFICATION_KEYS = Object.freeze({
    xsNotifications: 'VRCX-0_xsNotifications',
    ovrtHudNotifications: 'VRCX-0_ovrtHudNotifications',
    ovrtWristNotifications: 'VRCX-0_ovrtWristNotifications',
    imageNotifications: 'VRCX-0_imageNotifications',
    notificationTimeout: 'VRCX-0_notificationTimeout',
    notificationOpacity: 'VRCX-0_notificationOpacity'
});

function normalizeInteger(
    value: any,
    fallback: any,
    min: any = Number.MIN_SAFE_INTEGER,
    max: any = Number.MAX_SAFE_INTEGER
) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function normalizeNotificationPreference(
    key: NotificationPreferenceKey,
    value: unknown
) {
    switch (key) {
        case 'afkDesktopToast':
        case 'desktopNotificationSound':
        case 'notificationTTSNickName':
        case 'xsNotifications':
        case 'ovrtHudNotifications':
        case 'ovrtWristNotifications':
        case 'imageNotifications':
            return Boolean(value);
        case 'notificationTimeout':
            return normalizeInteger(value, 3000, 0, 600000);
        case 'notificationOpacity':
            return normalizeInteger(value, 100, 0, 100);
        case 'vrNotificationActivityFilters':
            return parseOverlayActivityFilterProfile(value);
        default:
            return typeof value === 'string'
                ? value
                : String(value ?? DEFAULT_NOTIFICATION_PREFERENCES[key] ?? '');
    }
}

async function getBoolPreferenceWithLegacy(key: string, defaultValue: boolean) {
    if ((await configRepository.getRawValue(key)) !== null) {
        return configRepository.getBool(key, defaultValue);
    }
    const legacyKey = getLegacyOverlayNotificationKey(key);
    if (legacyKey && (await configRepository.getRawValue(legacyKey)) !== null) {
        return configRepository.getBool(legacyKey, defaultValue);
    }
    return defaultValue;
}

async function getIntPreferenceWithLegacy(key: string, defaultValue: number) {
    if ((await configRepository.getRawValue(key)) !== null) {
        return configRepository.getInt(key, defaultValue);
    }
    const legacyKey = getLegacyOverlayNotificationKey(key);
    if (legacyKey && (await configRepository.getRawValue(legacyKey)) !== null) {
        return configRepository.getInt(legacyKey, defaultValue);
    }
    return defaultValue;
}

function getLegacyOverlayNotificationKey(key: string) {
    return LEGACY_OVERLAY_NOTIFICATION_KEYS[
        key as keyof typeof LEGACY_OVERLAY_NOTIFICATION_KEYS
    ];
}

function initNotificationPreferenceSubscription() {
    if (unsubscribePreferences) {
        return;
    }
    unsubscribePreferences = onPreferenceChanged(
        NOTIFICATION_PREFERENCE_KEYS,
        (value: any, detail: any) => {
            const key = detail.normalizedKey as NotificationPreferenceKey;
            if (
                !Object.prototype.hasOwnProperty.call(
                    DEFAULT_NOTIFICATION_PREFERENCES,
                    key
                )
            ) {
                return;
            }
            cachedPreferences = {
                ...cachedPreferences,
                [key]: normalizeNotificationPreference(key, value)
            };
            preferenceRevision += 1;
            changedPreferenceKeys.add(key);
            if (preferencesLoaded) {
                preferencesLoadPromise = null;
            }
        }
    );
}

function applyLoadedNotificationPreferences(
    loadedPreferences: any,
    loadRevision: any
) {
    const nextPreferences: any = { ...loadedPreferences };
    if (preferenceRevision !== loadRevision) {
        for (const key of changedPreferenceKeys) {
            nextPreferences[key] = cachedPreferences[key];
        }
    }
    cachedPreferences = nextPreferences;
    changedPreferenceKeys.clear();
    preferencesLoaded = true;
    preferencesLoadPromise = null;
    return cachedPreferences;
}

async function loadNotificationPreferences() {
    initNotificationPreferenceSubscription();
    if (preferencesLoaded) {
        return cachedPreferences;
    }
    if (!preferencesLoadPromise) {
        const loadRevision = preferenceRevision;
        preferencesLoadPromise = Promise.all([
            configRepository.getString(
                'desktopToast',
                DEFAULT_NOTIFICATION_PREFERENCES.desktopToast
            ),
            configRepository.getBool(
                'afkDesktopToast',
                DEFAULT_NOTIFICATION_PREFERENCES.afkDesktopToast
            ),
            configRepository.getBool(
                'desktopNotificationSound',
                DEFAULT_NOTIFICATION_PREFERENCES.desktopNotificationSound
            ),
            configRepository.getString(
                'notificationTTS',
                DEFAULT_NOTIFICATION_PREFERENCES.notificationTTS
            ),
            configRepository.getString(
                'notificationTTSVoice',
                DEFAULT_NOTIFICATION_PREFERENCES.notificationTTSVoice
            ),
            configRepository.getBool(
                'notificationTTSNickName',
                DEFAULT_NOTIFICATION_PREFERENCES.notificationTTSNickName
            ),
            getBoolPreferenceWithLegacy(
                'xsNotifications',
                DEFAULT_NOTIFICATION_PREFERENCES.xsNotifications
            ),
            getBoolPreferenceWithLegacy(
                'ovrtHudNotifications',
                DEFAULT_NOTIFICATION_PREFERENCES.ovrtHudNotifications
            ),
            getBoolPreferenceWithLegacy(
                'ovrtWristNotifications',
                DEFAULT_NOTIFICATION_PREFERENCES.ovrtWristNotifications
            ),
            getBoolPreferenceWithLegacy(
                'imageNotifications',
                DEFAULT_NOTIFICATION_PREFERENCES.imageNotifications
            ),
            getIntPreferenceWithLegacy(
                'notificationTimeout',
                DEFAULT_NOTIFICATION_PREFERENCES.notificationTimeout
            ),
            getIntPreferenceWithLegacy(
                'notificationOpacity',
                DEFAULT_NOTIFICATION_PREFERENCES.notificationOpacity
            ),
            configRepository.getString(
                'vrNotificationActivityFilters',
                JSON.stringify(
                    DEFAULT_NOTIFICATION_PREFERENCES.vrNotificationActivityFilters
                )
            )
        ])
            .then(
                ([
                    desktopToast,
                    afkDesktopToast,
                    desktopNotificationSound,
                    notificationTTS,
                    notificationTTSVoice,
                    notificationTTSNickName,
                    xsNotifications,
                    ovrtHudNotifications,
                    ovrtWristNotifications,
                    imageNotifications,
                    notificationTimeout,
                    notificationOpacity,
                    vrNotificationActivityFilters
                ]: any) => {
                    return applyLoadedNotificationPreferences(
                        {
                            desktopToast: normalizeNotificationPreference(
                                'desktopToast',
                                desktopToast
                            ),
                            afkDesktopToast: normalizeNotificationPreference(
                                'afkDesktopToast',
                                afkDesktopToast
                            ),
                            desktopNotificationSound:
                                normalizeNotificationPreference(
                                    'desktopNotificationSound',
                                    desktopNotificationSound
                                ),
                            notificationTTS: normalizeNotificationPreference(
                                'notificationTTS',
                                notificationTTS
                            ),
                            notificationTTSVoice:
                                normalizeNotificationPreference(
                                    'notificationTTSVoice',
                                    notificationTTSVoice
                                ),
                            notificationTTSNickName:
                                normalizeNotificationPreference(
                                    'notificationTTSNickName',
                                    notificationTTSNickName
                                ),
                            xsNotifications: normalizeNotificationPreference(
                                'xsNotifications',
                                xsNotifications
                            ),
                            ovrtHudNotifications:
                                normalizeNotificationPreference(
                                    'ovrtHudNotifications',
                                    ovrtHudNotifications
                                ),
                            ovrtWristNotifications:
                                normalizeNotificationPreference(
                                    'ovrtWristNotifications',
                                    ovrtWristNotifications
                                ),
                            imageNotifications: normalizeNotificationPreference(
                                'imageNotifications',
                                imageNotifications
                            ),
                            notificationTimeout:
                                normalizeNotificationPreference(
                                    'notificationTimeout',
                                    notificationTimeout
                                ),
                            notificationOpacity:
                                normalizeNotificationPreference(
                                    'notificationOpacity',
                                    notificationOpacity
                                ),
                            vrNotificationActivityFilters:
                                normalizeNotificationPreference(
                                    'vrNotificationActivityFilters',
                                    vrNotificationActivityFilters
                                )
                        },
                        loadRevision
                    );
                }
            )
            .catch(() => {
                return applyLoadedNotificationPreferences(
                    { ...DEFAULT_NOTIFICATION_PREFERENCES },
                    loadRevision
                );
            });
    }
    return preferencesLoadPromise;
}

function getNotificationUserId(notification: any) {
    return (
        notification?.userId ||
        notification?.senderUserId ||
        notification?.sourceUserId ||
        ''
    );
}

function normalizeUserId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function arrayContainsUserId(values: unknown, userId: string) {
    return Array.isArray(values)
        ? values.some((value) => normalizeUserId(value) === userId)
        : false;
}

function localFavoriteGroupContainsUser(
    localFriendFavorites: Record<string, string[]>,
    groupKey: string,
    userId: string
) {
    const localGroupName = groupKey.startsWith('local:')
        ? groupKey.slice(6)
        : groupKey;
    return arrayContainsUserId(localFriendFavorites?.[localGroupName], userId);
}

function remoteFavoriteGroupContainsUser(
    groupedFavoriteFriendIdsByGroupKey: Record<string, string[]>,
    groupKey: string,
    userId: string
) {
    return arrayContainsUserId(groupedFavoriteFriendIdsByGroupKey?.[groupKey], userId);
}

function isUserInSelectedFavoriteGroups(
    favoriteState: any,
    groupKeys: unknown,
    userId: string
) {
    const selectedGroupKeys = Array.isArray(groupKeys) ? groupKeys : [];
    if (!selectedGroupKeys.length) {
        return isUserInAnyFavoriteGroup(favoriteState, userId);
    }
    return selectedGroupKeys.some((groupKey) => {
        const normalizedGroupKey = String(groupKey || '').trim();
        if (!normalizedGroupKey) {
            return false;
        }
        if (normalizedGroupKey.startsWith('local:')) {
            return localFavoriteGroupContainsUser(
                favoriteState.localFriendFavorites || {},
                normalizedGroupKey,
                userId
            );
        }
        return remoteFavoriteGroupContainsUser(
            favoriteState.groupedFavoriteFriendIdsByGroupKey || {},
            normalizedGroupKey,
            userId
        );
    });
}

function isUserInAnyFavoriteGroup(favoriteState: any, userId: string) {
    if (arrayContainsUserId(favoriteState.favoriteFriendIds, userId)) {
        return true;
    }
    if (arrayContainsUserId(favoriteState.localFriendFavoritesList, userId)) {
        return true;
    }
    if (
        Object.values(favoriteState.localFriendFavorites || {}).some(
            (groupIds) => arrayContainsUserId(groupIds, userId)
        )
    ) {
        return true;
    }
    return Object.values(
        favoriteState.groupedFavoriteFriendIdsByGroupKey || {}
    ).some((groupIds) => arrayContainsUserId(groupIds, userId));
}

function isUserInCurrentInstance(gameState: any, userId: string) {
    if (arrayContainsUserId(gameState.currentLocationPlayerIds, userId)) {
        return true;
    }
    return Array.isArray(gameState.currentLocationPlayers)
        ? gameState.currentLocationPlayers.some(
              (player: any) =>
                  normalizeUserId(player?.id || player?.userId) === userId
          )
        : false;
}

function shouldDeliverVrNotificationForRule(
    rule: OverlayActivityRule,
    notification: any,
    gameState: any
) {
    const userId = normalizeUserId(getNotificationUserId(notification));
    switch (rule.scope) {
        case 'off':
            return false;
        case 'on':
            return true;
        case 'friends':
            return Boolean(
                userId && useFriendRosterStore.getState().friendsById?.[userId]
            );
        case 'selectedFavorites':
            return Boolean(
                userId &&
                    isUserInSelectedFavoriteGroups(
                        useFavoriteStore.getState(),
                        rule.favoriteGroupKeys,
                        userId
                    )
            );
        case 'allFavorites':
            return Boolean(
                userId &&
                    isUserInAnyFavoriteGroup(useFavoriteStore.getState(), userId)
            );
        case 'everyoneInInstance':
            return Boolean(userId && isUserInCurrentInstance(gameState, userId));
        default:
            return true;
    }
}

function shouldDeliverVrNotification(
    notification: any,
    preferences: any,
    gameState: any
) {
    const type = String(notification?.type || '').trim();
    const definition = OVERLAY_ACTIVITY_DEFINITION_BY_NOTIFICATION_TYPE[type];
    if (!definition) {
        return true;
    }
    const filters = normalizeOverlayActivityFilterProfile(
        preferences.vrNotificationActivityFilters
    );
    const rule = filters.types[definition.key] || {
        scope: definition.defaultScope,
        favoriteGroupKeys: 'all'
    };
    return shouldDeliverVrNotificationForRule(rule, notification, gameState);
}

function getDisplayName(notification: any, override: any = '') {
    return (
        override ||
        notification?.displayName ||
        notification?.senderUsername ||
        notification?.senderUserId ||
        notification?.userId ||
        ''
    );
}

function getDetailMessage(notification: any) {
    const details = notification?.details || {};
    return (
        details.inviteMessage ||
        details.requestMessage ||
        details.responseMessage ||
        notification?.message ||
        ''
    );
}

async function translated(key: any, params: any, fallback: any) {
    const value = await i18n.t(key, params);
    return value && value !== key ? value : fallback;
}

async function buildNotificationMessage(
    notification: any,
    displayNameOverride: any = ''
) {
    const type = notification?.type || '';
    const name = getDisplayName(notification, displayNameOverride);
    const sender = displayNameOverride || notification?.senderUsername || name;
    const detailMessage = getDetailMessage(notification);

    switch (type) {
        case 'OnPlayerJoined':
            return {
                title: name,
                body: await translated(
                    'notifications.has_joined',
                    {},
                    'has joined'
                )
            };
        case 'OnPlayerLeft':
            return {
                title: name,
                body: await translated('notifications.has_left', {}, 'has left')
            };
        case 'OnPlayerJoining':
            return {
                title: name,
                body: await translated(
                    'notifications.is_joining',
                    {},
                    'is joining'
                )
            };
        case 'GPS': {
            const location = displayLocation(
                notification.location,
                notification.worldName,
                notification.groupName
            );
            return {
                title: name,
                body: await translated(
                    'notifications.gps',
                    { location },
                    `GPS ${location}`
                )
            };
        }
        case 'Online': {
            if (notification.worldName) {
                const location = displayLocation(
                    notification.location,
                    notification.worldName,
                    notification.groupName
                );
                return {
                    title: name,
                    body: await translated(
                        'notifications.online_location',
                        { location },
                        `online in ${location}`
                    )
                };
            }
            return {
                title: name,
                body: await translated('notifications.online', {}, 'online')
            };
        }
        case 'Offline':
            return {
                title: name,
                body: await translated('notifications.offline', {}, 'offline')
            };
        case 'Status':
            return {
                title: name,
                body: await translated(
                    'notifications.status_update',
                    {
                        status: notification.status,
                        description: notification.statusDescription
                    },
                    `status: ${[notification.status, notification.statusDescription].filter(Boolean).join(' - ')}`
                )
            };
        case 'invite': {
            const location = displayLocation(
                notification.details?.worldId,
                notification.details?.worldName
            );
            return {
                title: sender,
                body: await translated(
                    'notifications.invite',
                    { location, message: detailMessage },
                    `invite ${location} ${detailMessage}`.trim()
                )
            };
        }
        case 'requestInvite':
            return {
                title: sender,
                body: await translated(
                    'notifications.request_invite',
                    { message: detailMessage },
                    `request invite ${detailMessage}`.trim()
                )
            };
        case 'inviteResponse':
            return {
                title: sender,
                body: await translated(
                    'notifications.invite_response',
                    { message: detailMessage },
                    `invite response ${detailMessage}`.trim()
                )
            };
        case 'requestInviteResponse':
            return {
                title: sender,
                body: await translated(
                    'notifications.request_invite_response',
                    { message: detailMessage },
                    `request invite response ${detailMessage}`.trim()
                )
            };
        case 'friendRequest':
            return {
                title: sender,
                body: await translated(
                    'notifications.friend_request',
                    {},
                    'friend request'
                )
            };
        case 'Friend':
            return {
                title: name,
                body: await translated('notifications.friend', {}, 'friend')
            };
        case 'Unfriend':
            return {
                title: name,
                body: await translated('notifications.unfriend', {}, 'unfriend')
            };
        case 'TrustLevel':
            return {
                title: name,
                body: await translated(
                    'notifications.trust_level',
                    { trustLevel: notification.trustLevel },
                    `trust level ${notification.trustLevel || ''}`.trim()
                )
            };
        case 'DisplayName':
            return {
                title:
                    displayNameOverride ||
                    notification.previousDisplayName ||
                    name,
                body: await translated(
                    'notifications.display_name',
                    { displayName: notification.displayName },
                    `display name ${notification.displayName || ''}`.trim()
                )
            };
        case 'boop':
        case 'groupChange':
            return { title: sender, body: notification.message || '' };
        case 'group.announcement':
            return {
                title: await translated(
                    'notifications.group_announcement_title',
                    {},
                    'Group announcement'
                ),
                body: notification.message || ''
            };
        case 'group.informative':
            return {
                title: await translated(
                    'notifications.group_informative_title',
                    {},
                    'Group informative'
                ),
                body: notification.message || ''
            };
        case 'group.invite':
            return {
                title: await translated(
                    'notifications.group_invite_title',
                    {},
                    'Group invite'
                ),
                body: notification.message || ''
            };
        case 'group.joinRequest':
            return {
                title: await translated(
                    'notifications.group_join_request_title',
                    {},
                    'Group join request'
                ),
                body: notification.message || ''
            };
        case 'group.transfer':
            return {
                title: await translated(
                    'notifications.group_transfer_request_title',
                    {},
                    'Group transfer request'
                ),
                body: notification.message || ''
            };
        case 'group.queueReady':
            return {
                title: await translated(
                    'notifications.group_queue_ready_title',
                    {},
                    'Group queue ready'
                ),
                body: notification.message || ''
            };
        case 'instance.closed':
            return {
                title: await translated(
                    'notifications.instance_closed_title',
                    {},
                    'Instance closed'
                ),
                body: notification.message || ''
            };
        case 'AvatarChange':
            return {
                title: name,
                body: await translated(
                    'notifications.avatar_change',
                    { avatar: notification.name },
                    `changed avatar to ${notification.name || ''}`.trim()
                )
            };
        case 'Bio':
            return {
                title: name,
                body: await translated(
                    'dashboard.widget.feed_bio',
                    {},
                    'updated bio'
                )
            };
        case 'ChatBoxMessage':
            return {
                title: name,
                body: await translated(
                    'notifications.chat_message',
                    { message: notification.text },
                    notification.text || ''
                )
            };
        case 'Event':
            return {
                title: 'Event',
                body: notification.data || notification.message || ''
            };
        case 'External':
            return { title: 'External', body: notification.message || '' };
        case 'VideoPlay':
            return {
                title: 'Now playing',
                body: notification.notyName || notification.message || ''
            };
        case 'BlockedOnPlayerJoined':
            return {
                title: name,
                body: await translated(
                    'notifications.blocked_player_joined',
                    {},
                    'has joined'
                )
            };
        case 'BlockedOnPlayerLeft':
            return {
                title: name,
                body: await translated(
                    'notifications.blocked_player_left',
                    {},
                    'has left'
                )
            };
        case 'MutedOnPlayerJoined':
            return {
                title: name,
                body: await translated(
                    'notifications.muted_player_joined',
                    {},
                    'has joined'
                )
            };
        case 'MutedOnPlayerLeft':
            return {
                title: name,
                body: await translated(
                    'notifications.muted_player_left',
                    {},
                    'has left'
                )
            };
        case 'Blocked':
            return {
                title: name,
                body: await translated('notifications.blocked', {}, 'blocked')
            };
        case 'Unblocked':
            return {
                title: name,
                body: await translated(
                    'notifications.unblocked',
                    {},
                    'unblocked'
                )
            };
        case 'Muted':
            return {
                title: name,
                body: await translated('notifications.muted', {}, 'muted')
            };
        case 'Unmuted':
            return {
                title: name,
                body: await translated('notifications.unmuted', {}, 'unmuted')
            };
        default:
            if (notification?.title || notification?.message) {
                return {
                    title:
                        notification.title || sender || type || 'Notification',
                    body: notification.message || ''
                };
            }
            return null;
    }
}

function toNotificationText({ title, body }: any, type: any) {
    if (BODY_ONLY_TYPES.has(type)) {
        return body;
    }
    if (COLON_SEPARATOR_TYPES.has(type)) {
        return title ? `${title}: ${body}` : body;
    }
    switch (type) {
        case 'BlockedOnPlayerJoined':
            return `Blocked user ${title} has joined`;
        case 'BlockedOnPlayerLeft':
            return `Blocked user ${title} has left`;
        case 'MutedOnPlayerJoined':
            return `Muted user ${title} has joined`;
        case 'MutedOnPlayerLeft':
            return `Muted user ${title} has left`;
        default:
            return title ? `${title} ${body}` : body;
    }
}

function shouldPlayForCondition(condition: any, gameState: any) {
    switch (condition) {
        case 'Always':
            return true;
        case 'Inside VR':
            return Boolean(gameState.isSteamVRRunning);
        case 'Outside VR':
            return !gameState.isSteamVRRunning;
        case 'Game Closed':
            return !gameState.isGameRunning;
        case 'Game Running':
            return Boolean(gameState.isGameRunning);
        case 'Desktop Mode':
            return Boolean(gameState.isGameNoVR && gameState.isGameRunning);
        default:
            return false;
    }
}

function shouldPlayAfkDesktopToast(preferences: any, gameState: any) {
    return Boolean(
        preferences.afkDesktopToast &&
        gameState.isHmdAfk &&
        gameState.isGameRunning &&
        !gameState.isGameNoVR
    );
}

function getNotificationImageUrl(notification: any) {
    return (
        notification?.thumbnailImageUrl ||
        notification?.details?.imageUrl ||
        notification?.imageUrl ||
        ''
    );
}

async function getNotificationUserImageUrl(notification: any) {
    const userId = getNotificationUserId(notification);
    if (!userId || String(userId).startsWith('grp_')) {
        return '';
    }
    const runtimeState = useRuntimeStore.getState();
    const endpoint = runtimeState.auth.currentUserEndpoint;
    const currentUserSnapshot = runtimeState.auth.currentUserSnapshot;
    const user =
        (String(currentUserSnapshot?.id || '') === String(userId)
            ? currentUserSnapshot
            : null) ||
        useFriendRosterStore.getState().friendsById?.[userId] ||
        getKnownUserFact(endpoint, userId);
    return resolveUserImageUrl(user, true, '128');
}

async function resolveNotificationImage(notification: any) {
    const imageUrl =
        getNotificationImageUrl(notification) ||
        (await getNotificationUserImageUrl(notification));
    if (!imageUrl || !String(imageUrl).startsWith('http')) {
        return '';
    }
    try {
        let fileId = extractFileId(imageUrl);
        let fileVersion = extractFileVersion(imageUrl);
        if (!fileId || !fileVersion) {
            fileVersion = String(imageUrl).split('/').pop() || '';
            fileId = fileVersion.split('.').shift() || '';
        }
        if (!fileId || !fileVersion) {
            return '';
        }
        return await tauriClient.app.GetImage(imageUrl, fileId, fileVersion);
    } catch (error) {
        console.warn('Failed to resolve notification image:', error);
        return '';
    }
}

async function resolveTtsDisplayName(notification: any, preferences: any) {
    if (!preferences.notificationTTSNickName) {
        return '';
    }
    const userId = getNotificationUserId(notification);
    if (!userId) {
        return '';
    }
    const memo = await memoPersistenceRepository
        .getUserMemo(userId)
        .catch(() => null);
    const nickName =
        typeof memo?.memo === 'string' ? memo.memo.split('\n')[0]?.trim() : '';
    return nickName || '';
}

function speakNotification(text: any, preferences: any) {
    if (
        !text ||
        typeof window === 'undefined' ||
        !window.speechSynthesis ||
        !window.SpeechSynthesisUtterance
    ) {
        return;
    }
    const voices = window.speechSynthesis.getVoices();
    const utterance = new window.SpeechSynthesisUtterance();
    const voiceIndex = normalizeInteger(
        preferences.notificationTTSVoice,
        0,
        0,
        Math.max(0, voices.length - 1)
    );
    if (voices[voiceIndex]) {
        utterance.voice = voices[voiceIndex];
    }
    utterance.text = text;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
}

export async function deliverRuntimeNotification(notification: any) {
    const preferences = await loadNotificationPreferences();
    const gameState: any = useRuntimeStore.getState().gameState || {};
    const playNotificationTTS = shouldPlayForCondition(
        preferences.notificationTTS,
        gameState
    );
    const playDesktopToast =
        shouldPlayForCondition(preferences.desktopToast, gameState) ||
        shouldPlayAfkDesktopToast(preferences, gameState);
    const playVrNotification =
        Boolean(gameState.isSteamVRRunning) &&
        shouldDeliverVrNotification(notification, preferences, gameState);
    const playXSNotification = Boolean(
        preferences.xsNotifications && playVrNotification
    );
    const playOvrtHudNotifications = Boolean(
        preferences.ovrtHudNotifications && playVrNotification
    );
    const playOvrtWristNotifications = Boolean(
        preferences.ovrtWristNotifications && playVrNotification
    );

    if (
        !playNotificationTTS &&
        !playDesktopToast &&
        !playXSNotification &&
        !playOvrtHudNotifications &&
        !playOvrtWristNotifications
    ) {
        return;
    }

    const message = await buildNotificationMessage(notification);
    if (!message || (!message.title && !message.body)) {
        return;
    }

    if (playNotificationTTS) {
        const ttsName = await resolveTtsDisplayName(notification, preferences);
        const ttsMessage = ttsName
            ? await buildNotificationMessage(notification, ttsName)
            : message;
        if (ttsMessage) {
            speakNotification(
                toNotificationText(ttsMessage, notification?.type),
                preferences
            );
        }
    }

    const playVisualNotification =
        playDesktopToast ||
        playXSNotification ||
        playOvrtHudNotifications ||
        playOvrtWristNotifications;
    if (!playVisualNotification) {
        return;
    }

    const image = preferences.imageNotifications
        ? await resolveNotificationImage(notification)
        : '';
    const overlayText = toNotificationText(message, notification?.type);
    const overlayTimeout = Math.floor(
        normalizeInteger(preferences.notificationTimeout, 3000, 0, 600000) /
            1000
    );
    const overlayOpacity =
        normalizeInteger(preferences.notificationOpacity, 100, 0, 100) / 100;

    const deliveries = [];
    if (playDesktopToast) {
        deliveries.push(
            tauriClient.app.DesktopNotification(
                message.title,
                message.body,
                image,
                Boolean(preferences.desktopNotificationSound)
            )
        );
    }
    if (playXSNotification) {
        deliveries.push(
            tauriClient.app.XSNotification(
                'VRCX',
                overlayText,
                overlayTimeout,
                overlayOpacity,
                image
            )
        );
    }
    if (playOvrtHudNotifications || playOvrtWristNotifications) {
        deliveries.push(
            tauriClient.app.OVRTNotification(
                playOvrtHudNotifications,
                playOvrtWristNotifications,
                'VRCX',
                overlayText,
                overlayTimeout,
                overlayOpacity,
                image
            )
        );
    }

    const results = await Promise.allSettled(deliveries);
    for (const result of results) {
        if (result.status === 'rejected') {
            console.warn('Notification delivery failed:', result.reason);
        }
    }
}
