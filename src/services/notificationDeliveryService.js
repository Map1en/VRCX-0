import { onPreferenceChanged } from '@/lib/preferenceEvents.js';
import { backend } from '@/platform/index.js';
import { configRepository, memoRepository } from '@/repositories/index.js';
import i18n from '@/services/i18nService.js';
import { extractFileId, extractFileVersion } from '@/shared/utils/fileUtils.js';
import { displayLocation } from '@/shared/utils/locationParser.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
    desktopToast: 'Never',
    afkDesktopToast: false,
    notificationTTS: 'Never',
    notificationTTSVoice: '0',
    notificationTTSNickName: false
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
let cachedPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };
let preferencesLoaded = false;
let preferencesLoadPromise = null;
let unsubscribePreferences = null;
let preferenceRevision = 0;
const changedPreferenceKeys = new Set();

function normalizeInteger(
    value,
    fallback,
    min = Number.MIN_SAFE_INTEGER,
    max = Number.MAX_SAFE_INTEGER
) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

function normalizeNotificationPreference(key, value) {
    switch (key) {
        case 'afkDesktopToast':
        case 'notificationTTSNickName':
            return Boolean(value);
        default:
            return typeof value === 'string'
                ? value
                : String(value ?? DEFAULT_NOTIFICATION_PREFERENCES[key] ?? '');
    }
}

function initNotificationPreferenceSubscription() {
    if (unsubscribePreferences) {
        return;
    }
    unsubscribePreferences = onPreferenceChanged(
        NOTIFICATION_PREFERENCE_KEYS,
        (value, detail) => {
            const key = detail.normalizedKey;
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

function applyLoadedNotificationPreferences(loadedPreferences, loadRevision) {
    const nextPreferences = { ...loadedPreferences };
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
            )
        ])
            .then(
                ([
                    desktopToast,
                    afkDesktopToast,
                    notificationTTS,
                    notificationTTSVoice,
                    notificationTTSNickName
                ]) => {
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

function getNotificationUserId(notification) {
    return (
        notification?.userId ||
        notification?.senderUserId ||
        notification?.sourceUserId ||
        ''
    );
}

function getDisplayName(notification, override = '') {
    return (
        override ||
        notification?.displayName ||
        notification?.senderUsername ||
        notification?.senderUserId ||
        notification?.userId ||
        ''
    );
}

function getDetailMessage(notification) {
    const details = notification?.details || {};
    return (
        details.inviteMessage ||
        details.requestMessage ||
        details.responseMessage ||
        notification?.message ||
        ''
    );
}

async function translated(key, params, fallback) {
    const value = await i18n.t(key, params);
    return value && value !== key ? value : fallback;
}

async function buildNotificationMessage(
    notification,
    displayNameOverride = ''
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

function toNotificationText({ title, body }, type) {
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

function shouldPlayForCondition(condition, gameState) {
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

function shouldPlayAfkDesktopToast(preferences, gameState) {
    return Boolean(
        preferences.afkDesktopToast &&
        gameState.isHmdAfk &&
        gameState.isGameRunning &&
        !gameState.isGameNoVR
    );
}

function getNotificationImageUrl(notification) {
    return (
        notification?.thumbnailImageUrl ||
        notification?.details?.imageUrl ||
        notification?.imageUrl ||
        ''
    );
}

async function resolveNotificationImage(notification) {
    const imageUrl = getNotificationImageUrl(notification);
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
        return await backend.app.GetImage(imageUrl, fileId, fileVersion);
    } catch (error) {
        console.warn('Failed to resolve notification image:', error);
        return '';
    }
}

async function resolveTtsDisplayName(notification, preferences) {
    if (!preferences.notificationTTSNickName) {
        return '';
    }
    const userId = getNotificationUserId(notification);
    if (!userId) {
        return '';
    }
    const memo = await memoRepository.getUserMemo(userId).catch(() => null);
    const nickName =
        typeof memo?.memo === 'string' ? memo.memo.split('\n')[0]?.trim() : '';
    return nickName || '';
}

function speakNotification(text, preferences) {
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

export async function deliverRuntimeNotification(notification) {
    const preferences = await loadNotificationPreferences();
    const gameState = useRuntimeStore.getState().gameState || {};
    const playNotificationTTS = shouldPlayForCondition(
        preferences.notificationTTS,
        gameState
    );
    const playDesktopToast =
        shouldPlayForCondition(preferences.desktopToast, gameState) ||
        shouldPlayAfkDesktopToast(preferences, gameState);

    if (!playNotificationTTS && !playDesktopToast) {
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

    if (!playDesktopToast) {
        return;
    }

    const image = await resolveNotificationImage(notification);

    const deliveries = [];
    deliveries.push(
        backend.app.DesktopNotification(message.title, message.body, image)
    );

    const results = await Promise.allSettled(deliveries);
    for (const result of results) {
        if (result.status === 'rejected') {
            console.warn('Notification delivery failed:', result.reason);
        }
    }
}
