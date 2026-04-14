import { backend } from '@/platform/index.js';
import { clearFavoriteRemoteDetailsCache } from '@/features/favorites/useFavoriteRemoteDetails.js';
import {
    configRepository,
    groupProfileRepository,
    playerListRepository,
    userProfileRepository,
    vrchatAuthRepository,
    vrchatModerationRepository
} from '@/repositories/index.js';
import { parseLocation } from '@/shared/utils/locationParser.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useFriendRosterStore } from '@/state/friendRosterStore.js';
import { useModalStore } from '@/state/modalStore.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { bootstrapFavorites } from './favoriteBootstrapService.js';
import { bootstrapFriendRoster } from './friendBootstrapService.js';
import { refreshDiscordPresence as updateDiscordPresence } from './discordPresenceService.js';
import { database } from '@/services/database/index.js';
import {
    defaultBranchForVersion,
    downloadUpdateAndWait,
    fetchLatestBranchRelease,
    formatReleaseDisplayVersion,
    hasUpdateForBranch,
    sanitizeBranch
} from '@/services/updateService.js';

const timers = {
    currentUserRefresh: 300,
    friendsRefresh: 3600,
    groupInstanceRefresh: 0,
    appUpdateCheck: 3600,
    clearVRCXCacheCheck: 86400,
    discordUpdate: 0,
    autoStateChange: 0,
    databaseOptimize: 3600,
    moderationRefresh: 3600
};
const groupInstanceProfileCache = new Map();

function groupInstanceProfileCacheKey(endpoint, groupId) {
    const normalizedEndpoint = String(endpoint || '').trim().replace(/\/+$/, '');
    return normalizedEndpoint ? `${normalizedEndpoint}:${groupId}` : groupId;
}

let lastTickAt = Date.now();
let running = false;

function resetTimers() {
    timers.currentUserRefresh = 300;
    timers.friendsRefresh = 3600;
    timers.groupInstanceRefresh = 0;
    timers.appUpdateCheck = 3600;
    timers.clearVRCXCacheCheck = 86400;
    timers.discordUpdate = 0;
    timers.autoStateChange = 0;
    timers.databaseOptimize = 3600;
    timers.moderationRefresh = 3600;
    lastTickAt = Date.now();
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
    return Array.isArray(recoveredParsed) ? recoveredParsed.filter(Boolean) : [];
}

function normalizeGroupInstanceGroupId(instance) {
    const explicitGroupId =
        instance?.group?.groupId ||
        instance?.group?.id ||
        instance?.instance?.group?.groupId ||
        instance?.instance?.group?.id;
    if (typeof explicitGroupId === 'string' && explicitGroupId.startsWith('grp_')) {
        return explicitGroupId;
    }

    const ownerId = instance?.ownerId || instance?.instance?.ownerId;
    return typeof ownerId === 'string' && ownerId.startsWith('grp_') ? ownerId : '';
}

function getGroupInstanceGroup(instance) {
    return instance?.group || instance?.instance?.group || null;
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
        id: existingGroup.id || existingGroup.groupId || fetchedGroup.id || fetchedGroup.groupId,
        groupId: existingGroup.groupId || existingGroup.id || fetchedGroup.groupId || fetchedGroup.id,
        name: existingGroup.name || fetchedGroup.name,
        iconUrl: existingGroup.iconUrl || fetchedGroup.iconUrl,
        icon: existingGroup.icon || fetchedGroup.icon,
        thumbnailUrl: existingGroup.thumbnailUrl || fetchedGroup.thumbnailUrl,
        imageUrl: existingGroup.imageUrl || fetchedGroup.imageUrl
    };
}

async function hydrateGroupInstances(instances, endpoint) {
    const groupIds = Array.from(new Set(
        (instances || [])
            .filter((instance) => !hasCompleteGroupInstanceGroup(instance))
            .map((instance) => normalizeGroupInstanceGroupId(instance))
            .filter(Boolean)
    ));
    if (!groupIds.length) {
        return instances || [];
    }

    const results = await Promise.allSettled(
        groupIds
            .filter((groupId) => !groupInstanceProfileCache.has(groupInstanceProfileCacheKey(endpoint, groupId)))
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
            groupInstanceProfileCache.set(groupInstanceProfileCacheKey(endpoint, result.value[0]), result.value[1]);
            groupsById.set(result.value[0], result.value[1]);
        }
    }

    return (instances || []).map((instance) => {
        const groupId = normalizeGroupInstanceGroupId(instance);
        const group = mergeGroupInstanceGroup(
            getGroupInstanceGroup(instance),
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

async function refreshCurrentUser() {
    const { currentUserEndpoint, currentUserWebsocket } = getRuntimeAuth();
    const response = await vrchatAuthRepository.getCurrentUser({
        endpoint: currentUserEndpoint
    });
    const user = response.json;
    if (!user?.id) {
        return;
    }

    useRuntimeStore.getState().setAuthBootstrap({
        currentUserId: user.id,
        currentUserDisplayName: user.displayName || user.username || user.id,
        currentUserEndpoint,
        currentUserWebsocket,
        currentUserSnapshot: user
    });
}

async function refreshFriendsAndFavorites() {
    const auth = getRuntimeAuth();
    if (!auth.currentUserId || !auth.currentUserSnapshot) {
        return;
    }

    await Promise.all([
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
}

export async function refreshPlayerModerations({ isCurrent = null } = {}) {
    const { currentUserId, currentUserEndpoint } = getRuntimeAuth();
    if (!currentUserId) {
        return;
    }

    const response = await vrchatModerationRepository.getPlayerModerations({
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

    await vrchatModerationRepository.syncLocalModerationSnapshot(response.json);
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

    const frequency = await configRepository.getInt('clearVRCXCacheFrequency', 172800);
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
    await updateDiscordPresence();
}

function isLiveLocation(location) {
    const normalized = typeof location === 'string' ? location.trim() : '';
    return Boolean(normalized && normalized !== 'traveling' && normalized !== 'offline');
}

function hasSelectedFriendInInstance(players, selectedGroups) {
    const friendIds = new Set();
    const favoriteState = useFavoriteStore.getState();

    for (const groupKey of selectedGroups) {
        if (groupKey.startsWith('local:')) {
            const groupName = groupKey.slice(6);
            const localIds = favoriteState.localFriendFavorites[groupName] || [];
            for (const userId of localIds) {
                friendIds.add(userId);
            }
            continue;
        }

        const remoteIds = favoriteState.groupedFavoriteFriendIdsByGroupKey[groupKey] || [];
        for (const userId of remoteIds) {
            friendIds.add(userId);
        }
    }

    return players.some((player) => player.userId && friendIds.has(player.userId));
}

async function updateAutoStateChange() {
    if (!(await configRepository.getBool('autoStateChangeEnabled', false))) {
        return;
    }

    const runtimeState = useRuntimeStore.getState();
    const auth = getRuntimeAuth();
    const currentUser = auth.currentUserSnapshot;
    const currentLocation = runtimeState.gameState.currentLocation || currentUser?.location || '';

    if (
        !runtimeState.gameState.isGameRunning ||
        !currentUser?.id ||
        !isLiveLocation(currentLocation)
    ) {
        return;
    }

    const location = parseLocation(currentLocation);
    let instanceType = location.accessType || '';
    if (instanceType === 'group') {
        if (location.groupAccessType === 'members') {
            instanceType = 'groupOnly';
        } else if (location.groupAccessType === 'plus') {
            instanceType = 'groupPlus';
        } else {
            instanceType = 'groupPublic';
        }
    }

    const selectedInstanceTypes = safeJsonParse(
        await configRepository.getString('autoStateChangeInstanceTypes', '[]'),
        []
    );
    if (
        Array.isArray(selectedInstanceTypes) &&
        selectedInstanceTypes.length > 0 &&
        !selectedInstanceTypes.includes(instanceType)
    ) {
        return;
    }

    const snapshot = await playerListRepository.getCurrentInstanceSnapshot({
        currentUserId: auth.currentUserId,
        currentLocation
    });
    let withCompany = snapshot.players.length > 0;

    if (await configRepository.getBool('autoStateChangeNoFriends', false)) {
        const selectedGroups = safeJsonParse(
            await configRepository.getString('autoStateChangeGroups', '[]'),
            []
        );
        if (Array.isArray(selectedGroups) && selectedGroups.length > 0) {
            withCompany = hasSelectedFriendInInstance(snapshot.players, selectedGroups);
        } else {
            const friendsById = useFriendRosterStore.getState().friendsById;
            withCompany = snapshot.players.some((player) => player.userId && friendsById[player.userId]);
        }
    }

    const nextStatus = withCompany
        ? await configRepository.getString('autoStateChangeCompanyStatus', 'busy')
        : await configRepository.getString('autoStateChangeAloneStatus', 'join me');
    if (!nextStatus || currentUser.status === nextStatus) {
        return;
    }

    const params = { status: nextStatus };
    if (withCompany && (await configRepository.getBool('autoStateChangeCompanyDescEnabled', false))) {
        params.statusDescription = await configRepository.getString('autoStateChangeCompanyDesc', '');
    } else if (!withCompany && (await configRepository.getBool('autoStateChangeAloneDescEnabled', false))) {
        params.statusDescription = await configRepository.getString('autoStateChangeAloneDesc', '');
    }

    const updatedUser = await userProfileRepository.updateCurrentUser({
        userId: currentUser.id,
        endpoint: auth.currentUserEndpoint,
        params
    });
    useRuntimeStore.getState().setAuthBootstrap({
        currentUserSnapshot: {
            ...currentUser,
            ...updatedUser
        }
    });
    useNotificationStore.getState().pushNotification({
        level: 'info',
        title: 'Status automatically changed',
        message: nextStatus
    });
}

async function backupVrcRegistry(name) {
    let regJson;
    try {
        regJson = await backend.app.GetVRChatRegistry();
    } catch (error) {
        console.warn('Failed to get VRChat registry for backup:', error);
        return false;
    }
    if (!regJson || typeof regJson !== 'object' || Object.keys(regJson).length === 0) {
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
    );
    backups.push(backup);
    await configRepository.setString('VRChatRegistryBackups', JSON.stringify(backups));
    return true;
}

async function tryAutoBackupVrcRegistry() {
    if (!(await configRepository.getBool('vrcRegistryAutoBackup', false))) {
        return;
    }

    let hasRegistryFolder = false;
    try {
        hasRegistryFolder = Boolean(await backend.app.HasVRChatRegistryFolder());
    } catch (error) {
        console.warn('Failed to check VRChat registry folder before backup:', error);
        return;
    }
    if (!hasRegistryFolder) {
        return;
    }

    const now = new Date();
    const lastBackupDate = await configRepository.getString('VRChatRegistryLastBackupDate', '');
    if (lastBackupDate) {
        const lastBackup = Date.parse(lastBackupDate);
        if (Number.isFinite(lastBackup) && now.getTime() - lastBackup < 3 * 24 * 60 * 60 * 1000) {
            return;
        }
    }

    const backups = safeJsonParse(
        await configRepository.getString('VRChatRegistryBackups', '[]'),
        []
    );
    const freshBackups = backups.filter((backup) => {
        if (backup?.name !== 'Auto Backup') {
            return true;
        }
        const backupDate = Date.parse(backup.date || '');
        return Number.isFinite(backupDate) && backupDate >= now.getTime() - 14 * 24 * 60 * 60 * 1000;
    });
    await configRepository.setString('VRChatRegistryBackups', JSON.stringify(freshBackups));
    if (await backupVrcRegistry('Auto Backup')) {
        await configRepository.setString('VRChatRegistryLastBackupDate', now.toJSON());
    }
}

async function checkAutoBackupRestoreVrcRegistry() {
    if (!(await configRepository.getBool('vrcRegistryAutoBackup', false))) {
        return;
    }

    if (!(await configRepository.getBool('vrcRegistryAskRestore', false))) {
        await tryAutoBackupVrcRegistry();
        return;
    }

    let hasRegistryFolder = true;
    try {
        hasRegistryFolder = Boolean(await backend.app.HasVRChatRegistryFolder());
    } catch (error) {
        console.warn('Failed to check VRChat registry folder:', error);
    }

    if (hasRegistryFolder) {
        await tryAutoBackupVrcRegistry();
        return;
    }

    const lastBackupDate = await configRepository.getString('VRChatRegistryLastBackupDate', '');
    const lastRestoreCheck = await configRepository.getString('VRChatRegistryLastRestoreCheck', '');
    if (!lastBackupDate || lastRestoreCheck === lastBackupDate) {
        return;
    }

    await useModalStore.getState().alert({
        title: 'VRChat Registry Backup',
        description:
            'The VRChat registry folder is missing and a saved registry backup is available. Restore a backup before starting VRChat.'
    });
    useRuntimeStore.getState().setSystemHostOpen('registryBackupOpen', true);
    await backend.app.FocusWindow().catch(() => {});
    await configRepository.setString('VRChatRegistryLastRestoreCheck', lastBackupDate);
}

async function checkForAppUpdate({ includeRegistryBackup = true } = {}) {
    let autoUpdateMode = await configRepository.getString('autoUpdateVRCX', 'Auto Download');
    if (autoUpdateMode === 'Auto Install') {
        autoUpdateMode = 'Auto Download';
        await configRepository.setString('autoUpdateVRCX', autoUpdateMode);
    }

    if (autoUpdateMode !== 'Off') {
        const available = await backend.app.CheckForUpdateExe().catch(() => false);
        if (available) {
            useNotificationStore.getState().pushNotification({
                level: 'info',
                title: 'VRCX update available',
                message: 'An update is downloaded and ready to install.'
            });
            useRuntimeStore.getState().setSystemHostOpen('updaterOpen', true);
        } else {
            try {
                const savedBranch = await configRepository.getString('branch', '');
                const branch = sanitizeBranch(savedBranch || defaultBranchForVersion(VERSION || ''));
                if (branch !== savedBranch) {
                    await configRepository.setString('branch', branch);
                }

                const latestRelease = await fetchLatestBranchRelease(branch);
                if (
                    latestRelease &&
                    hasUpdateForBranch(branch, VERSION || '', latestRelease.canonicalVersion)
                ) {
                    const displayVersion = formatReleaseDisplayVersion(latestRelease.canonicalVersion);
                    useNotificationStore.getState().pushNotification({
                        level: 'info',
                        title: 'VRCX update available',
                        message: `Version ${displayVersion} is available on the ${branch} branch.`
                    });

                    if (autoUpdateMode === 'Auto Download') {
                        useRuntimeStore.getState().setUpdateLoopState({
                            lastUpdaterCheckAt: new Date().toISOString(),
                            lastUpdaterCheckDetail: `Downloading ${displayVersion}.`
                        });
                        await downloadUpdateAndWait(latestRelease, {
                            onProgress: (progress) => {
                                useRuntimeStore.getState().setUpdateLoopState({
                                    lastUpdaterCheckAt: new Date().toISOString(),
                                    lastUpdaterCheckDetail: `Downloading ${displayVersion}: ${progress}%`
                                });
                            }
                        });
                        useNotificationStore.getState().pushNotification({
                            level: 'info',
                            title: 'VRCX update downloaded',
                            message: `Version ${displayVersion} is ready to install.`
                        });
                        useRuntimeStore.getState().setSystemHostOpen('updaterOpen', true);
                    }
                }
            } catch (error) {
                console.warn('Failed to check for VRCX updates:', error);
                useRuntimeStore.getState().setUpdateLoopState({
                    lastUpdaterCheckAt: new Date().toISOString(),
                    lastUpdaterCheckDetail: error instanceof Error ? error.message : String(error)
                });
            }
        }
    }

    if (includeRegistryBackup) {
        await tryAutoBackupVrcRegistry();
    }
}

export async function runStartupMaintenance() {
    await Promise.all([
        checkForAppUpdate({ includeRegistryBackup: false }),
        checkAutoBackupRestoreVrcRegistry()
    ]);
}

async function runDueTask(timerName, intervalSeconds, task) {
    if (timers[timerName] > 0) {
        return;
    }

    timers[timerName] = intervalSeconds;
    await task();
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

    try {
        await runDueTask('currentUserRefresh', 300, refreshCurrentUser);
        await runDueTask('friendsRefresh', 3600, refreshFriendsAndFavorites);
        await runGroupUserInstancesIfDue();
        await runDueTask('moderationRefresh', 3600, refreshPlayerModerations);
        await runDueTask('appUpdateCheck', 3600, checkForAppUpdate);
        await runClearVrcxCacheIfDue();
        await runDueTask('discordUpdate', 3, refreshDiscordPresence);
        await runDueTask('autoStateChange', 3, updateAutoStateChange);
        await runDueTask('databaseOptimize', 86400, () => database.optimize());
    } finally {
        running = false;
    }
}

export function resetBackgroundMaintenance() {
    resetTimers();
}
