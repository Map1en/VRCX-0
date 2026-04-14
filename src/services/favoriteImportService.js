import {
    avatarProfileRepository,
    userProfileRepository,
    vrchatFavoriteRepository,
    worldProfileRepository
} from '@/repositories/index.js';
import { useFavoriteImportStore } from '@/state/favoriteImportStore.js';
import { useFavoriteStore } from '@/state/favoriteStore.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { database } from '@/services/database/index.js';

import { bootstrapFavorites } from './favoriteBootstrapService.js';

const TYPE_CONFIG = {
    avatar: {
        label: 'Avatar',
        regex: /avtr_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g,
        remoteGroupsKey: 'favoriteAvatarGroups',
        localGroupsKey: 'localAvatarFavoriteGroups',
        localFavoritesKey: 'localAvatarFavorites',
        async getProfile(id, endpoint) {
            const profile = await avatarProfileRepository.getAvatarProfile({ avatarId: id, endpoint });
            await database.addAvatarToCache(profile);
            return profile;
        },
        async addLocal(id, groupName) {
            await database.addAvatarToFavorites(id, groupName);
        }
    },
    world: {
        label: 'World',
        regex: /wrld_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g,
        remoteGroupsKey: 'favoriteWorldGroups',
        localGroupsKey: 'localWorldFavoriteGroups',
        localFavoritesKey: 'localWorldFavorites',
        async getProfile(id, endpoint) {
            const profile = await worldProfileRepository.getWorldProfile({ worldId: id, endpoint });
            await database.addWorldToCache({
                ...profile,
                created_at: profile.created_at || profile.createdAt || '',
                updated_at: profile.updated_at || profile.updatedAt || ''
            });
            return profile;
        },
        async addLocal(id, groupName) {
            await database.addWorldToFavorites(id, groupName);
        }
    },
    friend: {
        label: 'Friend',
        regex: /usr_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g,
        remoteGroupsKey: 'favoriteFriendGroups',
        localGroupsKey: 'localFriendFavoriteGroups',
        localFavoritesKey: 'localFriendFavorites',
        async getProfile(id, endpoint) {
            return userProfileRepository.getUserProfile({ userId: id, endpoint });
        },
        async addLocal(id, groupName) {
            await database.addFriendToLocalFavorites(id, groupName);
        }
    }
};

function normalizeType(type) {
    return TYPE_CONFIG[type] ? type : '';
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : String(value ?? '').trim();
}

function getRuntimeAuth() {
    const runtimeState = useRuntimeStore.getState();
    return {
        endpoint: runtimeState.auth.currentUserEndpoint || '',
        currentUserId: runtimeState.auth.currentUserId || '',
        currentUserSnapshot: runtimeState.auth.currentUserSnapshot || null
    };
}

function extractIds(type, input) {
    const config = TYPE_CONFIG[type];
    if (!config) {
        return [];
    }

    return Array.from(new Set(normalizeString(input).match(config.regex) || []));
}

function getFavoriteGroups(type) {
    const config = TYPE_CONFIG[type];
    const favoriteState = useFavoriteStore.getState();

    return {
        remoteGroups: Array.isArray(favoriteState[config.remoteGroupsKey])
            ? favoriteState[config.remoteGroupsKey]
            : [],
        localGroups: Array.isArray(favoriteState[config.localGroupsKey])
            ? favoriteState[config.localGroupsKey]
            : []
    };
}

function getLocalFavoriteGroup(type, groupName) {
    const config = TYPE_CONFIG[type];
    const favoriteState = useFavoriteStore.getState();
    const groups = favoriteState[config.localFavoritesKey] || {};
    return Array.isArray(groups[groupName]) ? groups[groupName] : [];
}

function refreshFavoritesSnapshot() {
    const auth = getRuntimeAuth();
    if (!auth.currentUserId || !auth.currentUserSnapshot) {
        return Promise.resolve();
    }

    return bootstrapFavorites({
        userId: auth.currentUserId,
        endpoint: auth.endpoint,
        currentUserSnapshot: auth.currentUserSnapshot
    }).catch((error) => {
        console.warn('Failed to refresh favorites after import:', error);
    });
}

function buildError(type, id, error) {
    const label = TYPE_CONFIG[type]?.label || 'Favorite';
    const message = error instanceof Error ? error.message : String(error);
    return `${label}Id: ${id}\n${message}\n\n`;
}

export function openFavoriteImportDialog({ type, input = '' } = {}) {
    const normalizedType = normalizeType(type);
    if (!normalizedType) {
        throw new Error(`Unsupported favorite import type: ${type}`);
    }

    useFavoriteImportStore.getState().openDialog({
        type: normalizedType,
        input
    });

    if (normalizeString(input)) {
        void processFavoriteImportList();
    }
}

export async function processFavoriteImportList() {
    const store = useFavoriteImportStore.getState();
    const type = normalizeType(store.type);
    const config = TYPE_CONFIG[type];
    if (!config) {
        return;
    }

    const ids = extractIds(type, store.input);
    const existingIds = new Set(store.rows.map((row) => row.id));
    const pendingIds = ids.filter((id) => !existingIds.has(id));
    const auth = getRuntimeAuth();
    const sessionId = store.sessionId;

    store.setLoading(true);
    store.setErrors('');
    store.setInput('');
    store.setProgress(0, pendingIds.length);

    try {
        for (let index = 0; index < pendingIds.length; index += 1) {
            const currentState = useFavoriteImportStore.getState();
            if (
                !currentState.open ||
                !currentState.loading ||
                currentState.type !== type ||
                currentState.sessionId !== sessionId
            ) {
                break;
            }

            const id = pendingIds[index];
            try {
                const profile = await config.getProfile(id, auth.endpoint);
                const nextState = useFavoriteImportStore.getState();
                if (
                    !nextState.open ||
                    !nextState.loading ||
                    nextState.type !== type ||
                    nextState.sessionId !== sessionId
                ) {
                    break;
                }
                nextState.addRow({
                    ...profile,
                    id
                });
            } catch (error) {
                const nextState = useFavoriteImportStore.getState();
                if (
                    !nextState.open ||
                    !nextState.loading ||
                    nextState.type !== type ||
                    nextState.sessionId !== sessionId
                ) {
                    break;
                }
                nextState.appendError(buildError(type, id, error));
            }
            const progressState = useFavoriteImportStore.getState();
            if (
                !progressState.open ||
                !progressState.loading ||
                progressState.type !== type ||
                progressState.sessionId !== sessionId
            ) {
                break;
            }
            progressState.setProgress(index + 1, pendingIds.length);
        }
    } finally {
        const currentState = useFavoriteImportStore.getState();
        if (currentState.type === type && currentState.sessionId === sessionId) {
            currentState.setLoading(false);
            currentState.setProgress(0, 0);
        }
    }
}

export async function importFavoriteImportRows() {
    const state = useFavoriteImportStore.getState();
    const type = normalizeType(state.type);
    const config = TYPE_CONFIG[type];
    if (!config || state.rows.length === 0) {
        return;
    }
    const sessionId = state.sessionId;

    const { remoteGroups } = getFavoriteGroups(type);
    const remoteGroup = state.remoteGroupName
        ? remoteGroups.find((group) => group.name === state.remoteGroupName) || null
        : null;
    const localGroupName = state.localGroupName || '';

    if (!remoteGroup && !localGroupName) {
        return;
    }

    const endpoint = getRuntimeAuth().endpoint;
    const remoteFavoritesByObjectId = useFavoriteStore.getState().remoteFavoritesByObjectId || {};
    const locallyAdded = new Set();
    const remotelyAdded = new Set();
    const rows = [...state.rows];

    useFavoriteImportStore.getState().setLoading(true);
    useFavoriteImportStore.getState().setImportProgress(0, rows.length);

    const isActiveSession = () => {
        const currentState = useFavoriteImportStore.getState();
        return (
            currentState.open &&
            currentState.loading &&
            currentState.type === type &&
            currentState.sessionId === sessionId
        );
    };

    try {
        for (let index = 0; index < rows.length; index += 1) {
            if (!isActiveSession()) {
                break;
            }

            const row = rows[index];
            try {
                if (remoteGroup) {
                    if (remoteFavoritesByObjectId[row.id] || remotelyAdded.has(row.id)) {
                        throw new Error(`${config.label} is already in favorites.`);
                    }
                    await vrchatFavoriteRepository.addFavorite({
                        endpoint,
                        type: remoteGroup.type,
                        favoriteId: row.id,
                        tags: remoteGroup.name
                    });
                    remotelyAdded.add(row.id);
                } else {
                    const groupIds = getLocalFavoriteGroup(type, localGroupName);
                    if (groupIds.includes(row.id) || locallyAdded.has(row.id)) {
                        throw new Error(`${config.label} is already in local favorites.`);
                    }
                    await config.addLocal(row.id, localGroupName);
                    locallyAdded.add(row.id);
                }
                if (!isActiveSession()) {
                    break;
                }
                useFavoriteImportStore.getState().removeRow(row.id);
            } catch (error) {
                if (!isActiveSession()) {
                    break;
                }
                useFavoriteImportStore.getState().appendError(buildError(type, row.id, error));
            }
            if (!isActiveSession()) {
                break;
            }
            useFavoriteImportStore.getState().setImportProgress(index + 1, rows.length);
        }
    } finally {
        const currentState = useFavoriteImportStore.getState();
        if (currentState.type === type && currentState.sessionId === sessionId) {
            currentState.setLoading(false);
            currentState.setImportProgress(0, 0);
        }
        if (locallyAdded.size + remotelyAdded.size > 0) {
            await refreshFavoritesSnapshot();
        }
    }

    const imported = locallyAdded.size + remotelyAdded.size;
    if (imported > 0 && useFavoriteImportStore.getState().sessionId === sessionId) {
        useNotificationStore.getState().pushNotification({
            level: 'success',
            title: `${TYPE_CONFIG[type].label} import complete`,
            message: `${imported} item(s) imported.`
        });
    }
}

export function clearFavoriteImportRows() {
    useFavoriteImportStore.getState().clearRows();
}

export function cancelFavoriteImport() {
    useFavoriteImportStore.getState().cancelActiveWork();
}

export function getFavoriteImportTypeConfig(type) {
    return TYPE_CONFIG[type] || null;
}

export function getFavoriteImportGroups(type) {
    return getFavoriteGroups(type);
}
