import { backend } from '@/platform/index.js';
import {
    configRepository,
    groupProfileRepository,
    vrchatAuthRepository
} from '@/repositories/index.js';
import { clearFavoriteRemoteDetailsCache } from '@/services/favoriteRemoteDetailsCacheService.js';
import { isHostCapabilityAvailable } from '@/services/hostCapabilityService.js';
import i18n from '@/services/i18nService.js';
import {
    canInstallUpdatesOnPlatform,
    checkInstallableUpdate,
    defaultBranchForVersion,
    fetchLatestBranchRelease,
    formatReleaseDisplayVersion,
    hasUpdateForBranch,
    sanitizeBranch
} from '@/services/updateService.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useModalStore } from '@/state/modalStore.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import {
    buildAvatarWearSnapshotUpdate,
    persistAvatarWearTransition
} from './avatarWearTimeService.js';
import {
    recordBackendBackgroundJob,
    runRecordedBackendJob
} from './backendBackgroundJobService.js';
import { refreshBackendModerations } from './backendModerationService.js';
import {
    recordCurrentUserSnapshot,
    recordLocationHintsFromInstances
} from './domainIngestionService.js';
import { runDiscordPresenceMaintenanceTick } from './discordPresenceService.js';
import { bootstrapFavorites } from './favoriteBootstrapService.js';
import {
    bootstrapFriendRoster,
    syncFriendRosterStateFromCurrentUserSnapshot
} from './friendBootstrapService.js';
import {
    resetPresenceAutomationExecutor,
    runPresenceAutomation
} from './presence-automation/index.js';

// 3hr
const APP_UPDATE_CHECK_INTERVAL_SECONDS = 3 * 3600;

const timers = {
    friendsRefresh: 3600,
    groupInstanceRefresh: 0,
    appUpdateCheck: APP_UPDATE_CHECK_INTERVAL_SECONDS,
    clearVRCXCacheCheck: 86400,
    discordUpdate: 0,
    autoStateChange: 0,
    moderationRefresh: 3600
};
const groupInstanceProfileCache = new Map();

function groupInstanceProfileCacheKey(endpoint, groupId) {
    const normalizedEndpoint = String(endpoint || '')
        .trim()
        .replace(/\/+$/, '');
    return normalizedEndpoint ? `${normalizedEndpoint}:${groupId}` : groupId;
}

let lastTickAt = Date.now();
let running = false;

function resetTimers() {
    timers.friendsRefresh = 3600;
    timers.groupInstanceRefresh = 0;
    timers.appUpdateCheck = APP_UPDATE_CHECK_INTERVAL_SECONDS;
    timers.clearVRCXCacheCheck = 86400;
    timers.discordUpdate = 0;
    timers.autoStateChange = 0;
    timers.moderationRefresh = 3600;
    lastTickAt = Date.now();
}

function setUpdaterCheckResult(hasAvailableUpdate, detail = '') {
    useRuntimeStore.getState().setUpdateLoopState({
        hasAvailableUpdate: Boolean(hasAvailableUpdate),
        lastUpdaterCheckAt: new Date().toISOString(),
        lastUpdaterCheckDetail: detail
    });
}

function safeJsonParse(value, fallback) {
    if (!value) {
        return fallback;
    }
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function extractFirstJsonValue(input) {
    const trimmed = String(input || '').trimStart();
    if (!trimmed) {
        return null;
    }
    const firstChar = trimmed[0];
    if (firstChar !== '[' && firstChar !== '{') {
        return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = 0; index < trimmed.length; index += 1) {
        const char = trimmed[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '[' || char === '{') {
            depth += 1;
            continue;
        }
        if (char === ']' || char === '}') {
            depth -= 1;
            if (depth === 0) {
                return trimmed.slice(0, index + 1);
            }
        }
    }

    return null;
}

function parseInGameGroupOrder(value) {
    if (Array.isArray(value)) {
        return value.filter(Boolean);
    }
    if (typeof value !== 'string') {
        return [];
    }
    const parsed = safeJsonParse(value, null);
    if (Array.isArray(parsed)) {
        return parsed.filter(Boolean);
    }
    const recovered = extractFirstJsonValue(value);
    if (!recovered) {
        return [];
    }
    const recoveredParsed = safeJsonParse(recovered, null);
    return Array.isArray(recoveredParsed)
        ? recoveredParsed.filter(Boolean)
        : [];
}

function firstGroupId(...values) {
    for (const value of values) {
        const text =
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim();
        if (text.startsWith('grp_')) {
            return text;
        }
    }
    return '';
}

function normalizeGroupInstanceGroupId(instance) {
    const location = instance?.location || instance?.instance?.location || '';
    const parsedLocation = parseLocation(location);
    return firstGroupId(
        instance?.group?.groupId ||
            instance?.group?.id ||
            instance?.instance?.group?.groupId ||
            instance?.instance?.group?.id,
        instance?.groupId,
        instance?.group_id,
        instance?.instance?.groupId,
        instance?.instance?.group_id,
        instance?.ownerId,
        instance?.owner_id,
        instance?.instance?.ownerId,
        instance?.instance?.owner_id,
        parsedLocation.groupId
    );
}

function getGroupInstanceGroup(instance) {
    return instance?.group || instance?.instance?.group || null;
}

function createGroupInstanceFallback(groupId) {
    return groupId ? { id: groupId, groupId, name: groupId } : null;
}

function resolveGroupInstanceName(group, groupId = '') {
    const name = String(group?.name || group?.displayName || '').trim();
    if (!name || name === groupId) {
        return '';
    }
    return name;
}

function hasCompleteGroupInstanceGroup(instance) {
    const group = getGroupInstanceGroup(instance);
    return Boolean(
        group &&
        (group.id || group.groupId) &&
        group.name &&
        (group.iconUrl || group.icon || group.thumbnailUrl || group.imageUrl)
    );
}

function mergeGroupInstanceGroup(existingGroup, fetchedGroup) {
    if (!existingGroup) {
        return fetchedGroup;
    }
    if (!fetchedGroup) {
        return existingGroup;
    }
    return {
        ...fetchedGroup,
        ...existingGroup,
        id:
            existingGroup.id ||
            existingGroup.groupId ||
            fetchedGroup.id ||
            fetchedGroup.groupId,
        groupId:
            existingGroup.groupId ||
            existingGroup.id ||
            fetchedGroup.groupId ||
            fetchedGroup.id,
        name:
            resolveGroupInstanceName(
                existingGroup,
                existingGroup.groupId || existingGroup.id
            ) ||
            resolveGroupInstanceName(
                fetchedGroup,
                fetchedGroup.groupId || fetchedGroup.id
            ) ||
            existingGroup.name ||
            fetchedGroup.name,
        iconUrl: existingGroup.iconUrl || fetchedGroup.iconUrl,
        icon: existingGroup.icon || fetchedGroup.icon,
        thumbnailUrl: existingGroup.thumbnailUrl || fetchedGroup.thumbnailUrl,
        imageUrl: existingGroup.imageUrl || fetchedGroup.imageUrl
    };
}

async function hydrateGroupInstances(instances, endpoint) {
    const groupIds = Array.from(
        new Set(
            (instances || [])
                .filter((instance) => !hasCompleteGroupInstanceGroup(instance))
                .map((instance) => normalizeGroupInstanceGroupId(instance))
                .filter(Boolean)
        )
    );
    if (!groupIds.length) {
        return instances || [];
    }

    const results = await Promise.allSettled(
        groupIds
            .filter(
                (groupId) =>
                    !groupInstanceProfileCache.has(
                        groupInstanceProfileCacheKey(endpoint, groupId)
                    )
            )
            .map(async (groupId) => [
                groupId,
                await groupProfileRepository.getGroupProfile({
                    groupId,
                    endpoint,
                    includeRoles: false
                })
            ])
    );
    const groupsById = new Map();
    for (const groupId of groupIds) {
        const cacheKey = groupInstanceProfileCacheKey(endpoint, groupId);
        if (groupInstanceProfileCache.has(cacheKey)) {
            groupsById.set(groupId, groupInstanceProfileCache.get(cacheKey));
        }
    }
    for (const result of results) {
        if (result.status === 'fulfilled') {
            groupInstanceProfileCache.set(
                groupInstanceProfileCacheKey(endpoint, result.value[0]),
                result.value[1]
            );
            groupsById.set(result.value[0], result.value[1]);
        }
    }

    return (instances || []).map((instance) => {
        const groupId = normalizeGroupInstanceGroupId(instance);
        const group = mergeGroupInstanceGroup(
            getGroupInstanceGroup(instance) ||
                createGroupInstanceFallback(groupId),
            groupsById.get(groupId)
        );
        return group ? { ...instance, group } : instance;
    });
}

function getElapsedSeconds() {
    const now = Date.now();
    const elapsed = Math.max(1, Math.round((now - lastTickAt) / 1000));
    lastTickAt = now;
    return elapsed;
}

function getRuntimeAuth() {
    const runtimeState = useRuntimeStore.getState();
    return {
        currentUserId: runtimeState.auth.currentUserId,
        currentUserEndpoint: runtimeState.auth.currentUserEndpoint,
        currentUserWebsocket: runtimeState.auth.currentUserWebsocket,
        currentUserSnapshot: runtimeState.auth.currentUserSnapshot
    };
}

function normalizeRuntimeAuthValue(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function getRuntimeAuthTargetKey(target) {
    return `${target.currentUserEndpoint}\u0000${target.currentUserId}\u0000${target.currentUserWebsocket}`;
}

const currentUserRefreshes = new Map();
const CURRENT_USER_LOCAL_AUTHORITY_FIELDS = [
    'friends',
    'onlineFriends',
    'activeFriends',
    'offlineFriends',
    'status',
    'statusDescription',
    'state',
    'stateBucket',
    'pendingOffline',
    'location',
    '$location',
    '$location_at',
    'locationUpdatedAt',
    'worldId',
    'instanceId',
    'travelingToLocation',
    'travelingToWorld',
    'travelingToInstance',
    '$travelingToLocation',
    '$travelingToTime',
    'travelingToTime',
    '$previousLocation',
    '$previousLocation_at'
];

function mergeCurrentUserRefreshOverlayPatch(record, patch) {
    if (!patch || typeof patch !== 'object') {
        return;
    }

    record.overlayPatch = {
        ...(record.overlayPatch || {}),
        ...patch
    };
}

function areCurrentUserSnapshotValuesEqual(left, right) {
    if (Object.is(left, right)) {
        return true;
    }

    if (
        (left && typeof left === 'object') ||
        (right && typeof right === 'object')
    ) {
        try {
            return JSON.stringify(left) === JSON.stringify(right);
        } catch {
            return false;
        }
    }

    return false;
}

function hasCurrentUserSnapshotField(source, field) {
    return (
        source &&
        typeof source === 'object' &&
        Object.prototype.hasOwnProperty.call(source, field)
    );
}

function mergeCurrentUserRefreshSnapshot({
    responseUser,
    baseSnapshot,
    currentSnapshot,
    overlayPatch
}) {
    let user =
        currentSnapshot && typeof currentSnapshot === 'object'
            ? { ...currentSnapshot, ...responseUser }
            : { ...responseUser };

    for (const field of CURRENT_USER_LOCAL_AUTHORITY_FIELDS) {
        if (hasCurrentUserSnapshotField(currentSnapshot, field)) {
            user[field] = currentSnapshot[field];
        }
    }

    if (
        baseSnapshot &&
        typeof baseSnapshot === 'object' &&
        currentSnapshot &&
        typeof currentSnapshot === 'object' &&
        normalizeRuntimeAuthValue(baseSnapshot.id) ===
            normalizeRuntimeAuthValue(currentSnapshot.id)
    ) {
        const keys = new Set([
            ...Object.keys(baseSnapshot),
            ...Object.keys(currentSnapshot)
        ]);
        keys.delete('id');
        for (const key of keys) {
            if (
                !areCurrentUserSnapshotValuesEqual(
                    baseSnapshot[key],
                    currentSnapshot[key]
                )
            ) {
                user[key] = currentSnapshot[key];
            }
        }
    }

    if (overlayPatch && typeof overlayPatch === 'object') {
        user = { ...user, ...overlayPatch };
    }

    return user;
}

export async function refreshCurrentUser({
    expectedUserId = '',
    expectedEndpoint = '',
    expectedWebsocket = '',
    overlayPatch = null
} = {}) {
    const initialAuth = getRuntimeAuth();
    const target = {
        currentUserId: normalizeRuntimeAuthValue(
            expectedUserId || initialAuth.currentUserId
        ),
        currentUserEndpoint: normalizeRuntimeAuthValue(
            expectedEndpoint || initialAuth.currentUserEndpoint
        ),
        currentUserWebsocket: normalizeRuntimeAuthValue(
            expectedWebsocket || initialAuth.currentUserWebsocket
        )
    };

    if (!target.currentUserId) {
        return null;
    }

    const key = getRuntimeAuthTargetKey(target);
    const activeRecord = currentUserRefreshes.get(key);
    if (activeRecord) {
        mergeCurrentUserRefreshOverlayPatch(activeRecord, overlayPatch);
        return activeRecord.promise;
    }

    const record = {
        target,
        overlayPatch: null,
        promise: null
    };
    mergeCurrentUserRefreshOverlayPatch(record, overlayPatch);
    record.promise = refreshCurrentUserForTarget({
        target,
        record
    }).finally(() => {
        if (currentUserRefreshes.get(key) === record) {
            currentUserRefreshes.delete(key);
        }
    });
    currentUserRefreshes.set(key, record);

    return record.promise;
}

async function refreshCurrentUserForTarget({ target, record }) {
    const {
        currentUserId,
        currentUserEndpoint,
        currentUserWebsocket,
        currentUserSnapshot: baseSnapshot
    } = getRuntimeAuth();
    if (
        target.currentUserEndpoint !==
            normalizeRuntimeAuthValue(currentUserEndpoint) ||
        target.currentUserId !== normalizeRuntimeAuthValue(currentUserId) ||
        target.currentUserWebsocket !==
            normalizeRuntimeAuthValue(currentUserWebsocket)
    ) {
        return null;
    }

    const response = await vrchatAuthRepository.getCurrentUser({
        endpoint: target.currentUserEndpoint
    });
    const responseUser =
        response.json && typeof response.json === 'object'
            ? (response.json as Record<string, any>)
            : null;
    if (!responseUser?.id) {
        return null;
    }
    if (normalizeRuntimeAuthValue(responseUser.id) !== target.currentUserId) {
        return null;
    }

    const runtimeStore = useRuntimeStore.getState();
    if (
        normalizeRuntimeAuthValue(runtimeStore.auth.currentUserId) !==
            target.currentUserId ||
        normalizeRuntimeAuthValue(runtimeStore.auth.currentUserEndpoint) !==
            target.currentUserEndpoint ||
        normalizeRuntimeAuthValue(runtimeStore.auth.currentUserWebsocket) !==
            target.currentUserWebsocket
    ) {
        return null;
    }
    const user = mergeCurrentUserRefreshSnapshot({
        responseUser,
        baseSnapshot,
        currentSnapshot: runtimeStore.auth.currentUserSnapshot,
        overlayPatch: record.overlayPatch
    });

    const { snapshot: nextSnapshot, transition } =
        buildAvatarWearSnapshotUpdate({
            previousSnapshot: runtimeStore.auth.currentUserSnapshot,
            nextSnapshot: user,
            isGameRunning: runtimeStore.gameState.isGameRunning,
            userId: user.id
        }) as any;

    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: nextSnapshot.id,
        currentUserDisplayName:
            nextSnapshot.displayName ||
            nextSnapshot.username ||
            nextSnapshot.id,
        currentUserEndpoint: target.currentUserEndpoint,
        currentUserWebsocket: target.currentUserWebsocket,
        currentUserSnapshot: nextSnapshot
    });
    recordCurrentUserSnapshot(nextSnapshot, {
        endpoint: target.currentUserEndpoint
    });
    persistAvatarWearTransition(transition);
    syncFriendRosterStateFromCurrentUserSnapshot(
        nextSnapshot,
        `Friend roster states refreshed for ${nextSnapshot.displayName || nextSnapshot.username || nextSnapshot.id}.`
    );
    return nextSnapshot;
}

async function refreshFriendsAndFavorites() {
    const auth = getRuntimeAuth();
    if (!auth.currentUserId || !auth.currentUserSnapshot) {
        return;
    }

    const results = await Promise.allSettled([
        bootstrapFriendRoster({
            userId: auth.currentUserId,
            endpoint: auth.currentUserEndpoint,
            currentUserSnapshot: auth.currentUserSnapshot
        }),
        bootstrapFavorites({
            userId: auth.currentUserId,
            endpoint: auth.currentUserEndpoint,
            currentUserSnapshot: auth.currentUserSnapshot
        })
    ]);
    const failed = results.find((result) => result.status === 'rejected') as
        | PromiseRejectedResult
        | undefined;
    if (failed) {
        throw failed.reason;
    }
}

export async function refreshFriendAndFavoriteSnapshots({
    syncRealtime = true
}: { syncRealtime?: boolean } = {}) {
    let refreshError: unknown = null;
    let syncError: unknown = null;
    try {
        await refreshFriendsAndFavorites();
    } catch (error) {
        refreshError = error;
    } finally {
        if (syncRealtime) {
            try {
                const { syncBackendRealtimeFriendSnapshot } = await import(
                    './realtimeTransportService.js'
                );
                await syncBackendRealtimeFriendSnapshot();
            } catch (error) {
                syncError = error;
            }
        }
    }
    if (refreshError) {
        throw refreshError;
    }
    if (syncError) {
        throw syncError;
    }
}

export async function refreshPlayerModerations({ isCurrent = null } = {}) {
    const { currentUserId, currentUserEndpoint } = getRuntimeAuth();
    if (!currentUserId) {
        return;
    }

    await refreshBackendModerations({
        userId: currentUserId,
        endpoint: currentUserEndpoint
    });

    const latestAuth = getRuntimeAuth();
    if (
        latestAuth.currentUserId !== currentUserId ||
        latestAuth.currentUserEndpoint !== currentUserEndpoint ||
        (typeof isCurrent === 'function' && !isCurrent())
    ) {
        return;
    }

}

async function refreshGroupUserInstances() {
    const auth = getRuntimeAuth();
    if (!auth.currentUserId) {
        return;
    }

    const runtimeStore = useRuntimeStore.getState();
    runtimeStore.setGroupInstancesState({
        status: 'running',
        error: ''
    });

    try {
        const response = await groupProfileRepository.getUsersGroupInstances({
            userId: auth.currentUserId,
            endpoint: auth.currentUserEndpoint
        });
        const instances = Array.isArray(response.json)
            ? response.json
            : Array.isArray(response.json?.instances)
              ? response.json.instances
              : [];
        const hydratedInstances = await hydrateGroupInstances(
            instances,
            auth.currentUserEndpoint
        );
        const groupOrder = await backend.app
            .GetVRChatRegistryKey(`VRC_GROUP_ORDER_${auth.currentUserId}`)
            .then(parseInGameGroupOrder)
            .catch(() => []);
        const fetchedAt = response.json?.fetchedAt || new Date().toISOString();
        runtimeStore.setGroupInstancesState({
            status: 'ready',
            endpoint: auth.currentUserEndpoint,
            instances: hydratedInstances,
            groupOrder,
            fetchedAt,
            lastLoadedAt: new Date().toISOString(),
            error: ''
        });
        recordLocationHintsFromInstances({
            endpoint: auth.currentUserEndpoint,
            instances: hydratedInstances
        });
    } catch (error) {
        runtimeStore.setGroupInstancesState({
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
            lastLoadedAt: new Date().toISOString()
        });
        throw error;
    }
}

async function runGroupUserInstancesIfDue() {
    if (timers.groupInstanceRefresh > 0) {
        return;
    }

    if (!useSessionStore.getState().isFriendsLoaded) {
        timers.groupInstanceRefresh = 30;
        return;
    }

    timers.groupInstanceRefresh = 300;
    await refreshGroupUserInstances();
}

async function runClearVrcxCacheIfDue() {
    if (timers.clearVRCXCacheCheck > 0) {
        return;
    }

    const frequency = Number(
        await configRepository.getInt('clearVRCXCacheFrequency', 172800)
    );
    if (!frequency || frequency <= 0) {
        timers.clearVRCXCacheCheck = 3600;
        return;
    }

    timers.clearVRCXCacheCheck = Math.max(60, Math.floor(frequency / 2));
    const cleared = clearFavoriteRemoteDetailsCache();
    useRuntimeStore.getState().setUpdateLoopState({
        lastCacheCleanupAt: new Date().toISOString(),
        lastCacheCleanupDetail: `Cleared ${cleared.detailCacheCount} remote favorite detail cache entries.`
    });
}

async function refreshDiscordPresence() {
    await runDiscordPresenceMaintenanceTick();
}

async function updateAutoStateChange() {
    await runPresenceAutomation();
}

async function backupVrcRegistry(name) {
    if (!isHostCapabilityAvailable('registryPrefs')) {
        return false;
    }

    let regJson;
    try {
        regJson = await backend.app.GetVRChatRegistry();
    } catch (error) {
        console.warn('Failed to get VRChat registry for backup:', error);
        return false;
    }
    if (
        !regJson ||
        typeof regJson !== 'object' ||
        Object.keys(regJson).length === 0
    ) {
        return false;
    }

    const backup = {
        name,
        date: new Date().toJSON(),
        data: regJson
    };
    const backups = safeJsonParse(
        await configRepository.getString('VRChatRegistryBackups', '[]'),
        []
    ) as Record<string, any>[];
    backups.push(backup);
    await configRepository.setString(
        'VRChatRegistryBackups',
        JSON.stringify(backups)
    );
    return true;
}

async function tryAutoBackupVrcRegistry() {
    if (!isHostCapabilityAvailable('registryPrefs')) {
        return;
    }

    if (!(await configRepository.getBool('vrcRegistryAutoBackup', true))) {
        return;
    }

    let hasRegistryFolder = false;
    try {
        hasRegistryFolder = Boolean(
            await backend.app.HasVRChatRegistryFolder()
        );
    } catch (error) {
        console.warn(
            'Failed to check VRChat registry folder before backup:',
            error
        );
        return;
    }
    if (!hasRegistryFolder) {
        return;
    }

    const now = new Date();
    const lastBackupDate = await configRepository.getString(
        'VRChatRegistryLastBackupDate',
        ''
    );
    if (lastBackupDate) {
        const lastBackup = Date.parse(String(lastBackupDate || ''));
        if (
            Number.isFinite(lastBackup) &&
            now.getTime() - lastBackup < 3 * 24 * 60 * 60 * 1000
        ) {
            return;
        }
    }

    const backups = safeJsonParse(
        await configRepository.getString('VRChatRegistryBackups', '[]'),
        []
    ) as Record<string, any>[];
    const freshBackups = backups.filter((backup) => {
        if (backup?.name !== 'Auto Backup') {
            return true;
        }
        const backupDate = Date.parse(backup.date || '');
        return (
            Number.isFinite(backupDate) &&
            backupDate >= now.getTime() - 14 * 24 * 60 * 60 * 1000
        );
    });
    await configRepository.setString(
        'VRChatRegistryBackups',
        JSON.stringify(freshBackups)
    );
    if (await backupVrcRegistry('Auto Backup')) {
        await configRepository.setString(
            'VRChatRegistryLastBackupDate',
            now.toJSON()
        );
    }
}

async function checkAutoBackupRestoreVrcRegistry() {
    if (!isHostCapabilityAvailable('registryPrefs')) {
        return;
    }

    if (!(await configRepository.getBool('vrcRegistryAutoBackup', true))) {
        return;
    }

    if (!(await configRepository.getBool('vrcRegistryAskRestore', true))) {
        await tryAutoBackupVrcRegistry();
        return;
    }

    let hasRegistryFolder = true;
    try {
        hasRegistryFolder = Boolean(
            await backend.app.HasVRChatRegistryFolder()
        );
    } catch (error) {
        console.warn('Failed to check VRChat registry folder:', error);
    }

    if (hasRegistryFolder) {
        await tryAutoBackupVrcRegistry();
        return;
    }

    const lastBackupDate = await configRepository.getString(
        'VRChatRegistryLastBackupDate',
        ''
    );
    const lastRestoreCheck = await configRepository.getString(
        'VRChatRegistryLastRestoreCheck',
        ''
    );
    if (!lastBackupDate || lastRestoreCheck === lastBackupDate) {
        return;
    }

    await useModalStore.getState().alert({
        title: i18n.t(
            'service.background_maintenance.label.vrchat_registry_backup'
        ),
        description: i18n.t(
            'service.background_maintenance.description.registry_backup_restore_description'
        )
    });
    useRuntimeStore.getState().setSystemHostOpen('registryBackupOpen', true);
    await backend.app.FocusWindow().catch(() => {});
    await configRepository.setString(
        'VRChatRegistryLastRestoreCheck',
        lastBackupDate
    );
}

async function checkForAppUpdate({ includeRegistryBackup = true } = {}) {
    const hostCapabilities = useRuntimeStore.getState().hostCapabilities;
    const hostPlatform = hostCapabilities.platform;
    const hostArch = hostCapabilities.arch;
    const linuxPackageKind = hostCapabilities.linuxPackageKind;
    const canInstallUpdates = canInstallUpdatesOnPlatform(hostPlatform);
    let autoUpdateMode = await configRepository.getString(
        'autoUpdateVRCX',
        'Auto Download'
    );
    if (
        autoUpdateMode === 'Auto Install' ||
        autoUpdateMode === 'Auto Download'
    ) {
        autoUpdateMode = 'Notify';
        await configRepository.setString('autoUpdateVRCX', autoUpdateMode);
    }

    if (autoUpdateMode === 'Off') {
        useRuntimeStore.getState().setUpdateLoopState({
            hasAvailableUpdate: false
        });
    } else {
        try {
            const savedBranch = await configRepository.getString('branch', '');
            const defaultBranch = defaultBranchForVersion(VERSION || '');
            const sanitizedSavedBranch = sanitizeBranch(savedBranch);
            const branch =
                defaultBranch !== 'Stable'
                    ? defaultBranch
                    : savedBranch
                      ? sanitizedSavedBranch
                      : defaultBranch;
            if (branch !== savedBranch) {
                await configRepository.setString('branch', branch);
            }

            if (canInstallUpdates) {
                const update = (await checkInstallableUpdate(branch, {
                    hostArch,
                    linuxPackageKind,
                    hostPlatform
                })) as Record<string, any> | null;
                if (update) {
                    const displayVersion = formatReleaseDisplayVersion(
                        update.version
                    );
                    const message = i18n.t(
                        'service.background_maintenance_service.dynamic.version_value_is_available_on_the_value_branch',
                        { value: displayVersion, value2: branch }
                    );
                    useNotificationStore.getState().pushNotification({
                        level: 'info',
                        title: i18n.t(
                            'service.background_maintenance.label.vrcx_update_available'
                        ),
                        message
                    });
                    setUpdaterCheckResult(true, message);
                    useRuntimeStore
                        .getState()
                        .setSystemHostOpen('updaterOpen', true);
                } else {
                    setUpdaterCheckResult(false);
                }
            } else {
                const latestRelease = (await fetchLatestBranchRelease(branch, {
                    hostArch,
                    linuxPackageKind,
                    hostPlatform,
                    requireInstallerAsset: false
                })) as Record<string, any> | null;
                const hasUpdate =
                    latestRelease &&
                    hasUpdateForBranch(
                        branch,
                        VERSION || '',
                        latestRelease.canonicalVersion
                    );
                if (hasUpdate) {
                    const displayVersion = formatReleaseDisplayVersion(
                        latestRelease.canonicalVersion
                    );
                    const message = i18n.t(
                        'service.background_maintenance_service.dynamic.version_value_is_available_on_the_value_branch',
                        { value: displayVersion, value2: branch }
                    );
                    useNotificationStore.getState().pushNotification({
                        level: 'info',
                        title: i18n.t(
                            'service.background_maintenance.label.vrcx_update_available'
                        ),
                        message
                    });
                    setUpdaterCheckResult(true, message);
                    useRuntimeStore
                        .getState()
                        .setSystemHostOpen('updaterOpen', true);
                } else {
                    setUpdaterCheckResult(false);
                }
            }
        } catch (error) {
            console.warn('Failed to check for VRCX-0 updates:', error);
            useRuntimeStore.getState().setUpdateLoopState({
                lastUpdaterCheckAt: new Date().toISOString(),
                lastUpdaterCheckDetail:
                    error instanceof Error ? error.message : String(error)
            });
        }
    }

    if (includeRegistryBackup) {
        await tryAutoBackupVrcRegistry();
    }
}

export async function runStartupMaintenance() {
    await runRecordedBackendJob(
        {
            name: 'startupMaintenance',
            detail: 'Running startup update and registry maintenance.'
        },
        () =>
            Promise.all([
                checkForAppUpdate({ includeRegistryBackup: false }),
                checkAutoBackupRestoreVrcRegistry()
            ])
    );
}

async function runDueTask(timerName, intervalSeconds, task) {
    if (timers[timerName] > 0) {
        return;
    }

    timers[timerName] = intervalSeconds;
    await runRecordedBackendJob(
        {
            name: timerName,
            cadenceSeconds: intervalSeconds,
            detail: `Running frontend-owned maintenance task ${timerName}.`
        },
        task
    );
}

export async function runBackgroundMaintenanceTick() {
    if (running || !useSessionStore.getState().isLoggedIn) {
        return;
    }

    running = true;
    const elapsed = getElapsedSeconds();

    for (const key of Object.keys(timers)) {
        timers[key] -= elapsed;
    }
    void recordBackendBackgroundJob({
        name: 'backgroundMaintenanceTick',
        owner: 'frontend',
        status: 'running',
        detail: 'Frontend maintenance tick is active.'
    });

    try {
        await runDueTask(
            'friendsRefresh',
            3600,
            refreshFriendAndFavoriteSnapshots
        );
        await runGroupUserInstancesIfDue();
        await runDueTask('moderationRefresh', 3600, refreshPlayerModerations);
        await runDueTask(
            'appUpdateCheck',
            APP_UPDATE_CHECK_INTERVAL_SECONDS,
            checkForAppUpdate
        );
        await runClearVrcxCacheIfDue();
        await runDueTask('discordUpdate', 3, refreshDiscordPresence);
        await runDueTask('autoStateChange', 3, updateAutoStateChange);
    } finally {
        running = false;
        void recordBackendBackgroundJob({
            name: 'backgroundMaintenanceTick',
            owner: 'frontend',
            status: 'completed',
            detail: 'Frontend maintenance tick completed.'
        });
    }
}

export function resetBackgroundMaintenance() {
    resetTimers();
    resetPresenceAutomationExecutor();
}
