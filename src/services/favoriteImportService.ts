import avatarCacheRepository from '@/repositories/avatarCacheRepository';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import favoritePersistenceRepository from '@/repositories/favoritePersistenceRepository';
import userProfileRepository from '@/repositories/userProfileRepository';
import vrchatFavoriteRepository from '@/repositories/vrchatFavoriteRepository';
import worldProfileRepository from '@/repositories/worldProfileRepository';
import i18n from '@/services/i18nService';
import { normalizeString } from '@/shared/utils/string';
import { useFavoriteImportStore } from '@/state/favoriteImportStore';
import { useFavoriteStore } from '@/state/favoriteStore';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { bootstrapFavorites } from './favoriteBootstrapService';

type FavoriteRemoteGroupsKey =
    | 'favoriteAvatarGroups'
    | 'favoriteWorldGroups'
    | 'favoriteFriendGroups';
type FavoriteLocalGroupsKey =
    | 'localAvatarFavoriteGroups'
    | 'localWorldFavoriteGroups'
    | 'localFriendFavoriteGroups';
type FavoriteLocalFavoritesKey =
    | 'localAvatarFavorites'
    | 'localWorldFavorites'
    | 'localFriendFavorites';

interface FavoriteTypeConfig {
    label: string;
    regex: RegExp;
    remoteGroupsKey: FavoriteRemoteGroupsKey;
    localGroupsKey: FavoriteLocalGroupsKey;
    localFavoritesKey: FavoriteLocalFavoritesKey;
    getProfile(id: string, endpoint: string): Promise<any>;
    addLocal(id: string, groupName: string): Promise<void>;
}

const TYPE_CONFIG: Record<string, FavoriteTypeConfig> = {
    avatar: {
        label: 'Avatar',
        regex: /avtr_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g,
        remoteGroupsKey: 'favoriteAvatarGroups',
        localGroupsKey: 'localAvatarFavoriteGroups',
        localFavoritesKey: 'localAvatarFavorites',
        async getProfile(id: any, endpoint: any) {
            const profile = await avatarProfileRepository.getAvatarProfile({
                avatarId: id,
                endpoint
            });
            await avatarCacheRepository.addAvatarToCache(profile);
            return profile;
        },
        async addLocal(id: any, groupName: any) {
            await favoritePersistenceRepository.addAvatarToFavorites(
                id,
                groupName
            );
        }
    },
    world: {
        label: 'World',
        regex: /wrld_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g,
        remoteGroupsKey: 'favoriteWorldGroups',
        localGroupsKey: 'localWorldFavoriteGroups',
        localFavoritesKey: 'localWorldFavorites',
        async getProfile(id: any, endpoint: any) {
            const profile = await worldProfileRepository.getWorldProfile({
                worldId: id,
                endpoint
            });
            await favoritePersistenceRepository.addWorldToCache({
                ...profile,
                created_at: profile.created_at || profile.createdAt || '',
                updated_at: profile.updated_at || profile.updatedAt || ''
            });
            return profile;
        },
        async addLocal(id: any, groupName: any) {
            await favoritePersistenceRepository.addWorldToFavorites(
                id,
                groupName
            );
        }
    },
    friend: {
        label: 'Friend',
        regex: /usr_[0-9A-Fa-f]{8}-(?:[0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/g,
        remoteGroupsKey: 'favoriteFriendGroups',
        localGroupsKey: 'localFriendFavoriteGroups',
        localFavoritesKey: 'localFriendFavorites',
        async getProfile(id: any, endpoint: any) {
            return userProfileRepository.getUserProfile({
                userId: id,
                endpoint
            });
        },
        async addLocal(id: any, groupName: any) {
            await favoritePersistenceRepository.addFriendToLocalFavorites(
                id,
                groupName
            );
        }
    }
};

function normalizeType(type: unknown): string {
    const normalized = normalizeString(type);
    return TYPE_CONFIG[normalized] ? normalized : '';
}

function getRuntimeAuth() {
    const runtimeState = useRuntimeStore.getState();
    return {
        endpoint: runtimeState.auth.currentUserEndpoint || '',
        currentUserId: runtimeState.auth.currentUserId || '',
        currentUserSnapshot: runtimeState.auth.currentUserSnapshot || null
    };
}

function extractIds(type: string, input: unknown) {
    const config = TYPE_CONFIG[type];
    if (!config) {
        return [];
    }

    return Array.from(
        new Set(normalizeString(input).match(config.regex) || [])
    );
}

function getFavoriteGroups(type: string) {
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

function getLocalFavoriteGroup(type: string, groupName: string) {
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
    }).catch((error: any) => {
        console.warn('Failed to refresh favorites after import:', error);
    });
}

function buildError(type: string, id: string, error: unknown) {
    const label = TYPE_CONFIG[type]?.label || 'Favorite';
    const message = error instanceof Error ? error.message : String(error);
    return `${label}Id: ${id}\n${message}\n\n`;
}

export function openFavoriteImportDialog({
    type,
    input = ''
}: {
    type?: unknown;
    input?: unknown;
} = {}) {
    const normalizedType = normalizeType(type);
    if (!normalizedType) {
        throw new Error(`Unsupported favorite import type: ${type}`);
    }

    useFavoriteImportStore.getState().openDialog({
        type: normalizedType,
        input
    });

    if (normalizeString(input)) {
        processFavoriteImportList();
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
    const existingIds = new Set(store.rows.map((row: any) => row.id));
    const pendingIds = ids.filter((id: any) => !existingIds.has(id));
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
        if (
            currentState.type === type &&
            currentState.sessionId === sessionId
        ) {
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
        ? remoteGroups.find(
              (group: any) => group.name === state.remoteGroupName
          ) || null
        : null;
    const localGroupName = state.localGroupName || '';

    if (!remoteGroup && !localGroupName) {
        return;
    }

    const endpoint = getRuntimeAuth().endpoint;
    const remoteFavoritesByObjectId =
        useFavoriteStore.getState().remoteFavoritesByObjectId || {};
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
                    if (
                        remoteFavoritesByObjectId[row.id] ||
                        remotelyAdded.has(row.id)
                    ) {
                        throw new Error(
                            `${config.label} is already in favorites.`
                        );
                    }
                    await vrchatFavoriteRepository.addFavorite({
                        endpoint,
                        type: remoteGroup.type,
                        favoriteId: row.id,
                        tags: remoteGroup.name
                    });
                    remotelyAdded.add(row.id);
                } else {
                    const groupIds = getLocalFavoriteGroup(
                        type,
                        localGroupName
                    );
                    if (groupIds.includes(row.id) || locallyAdded.has(row.id)) {
                        throw new Error(
                            `${config.label} is already in local favorites.`
                        );
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
                useFavoriteImportStore
                    .getState()
                    .appendError(buildError(type, row.id, error));
            }
            if (!isActiveSession()) {
                break;
            }
            useFavoriteImportStore
                .getState()
                .setImportProgress(index + 1, rows.length);
        }
    } finally {
        const currentState = useFavoriteImportStore.getState();
        if (
            currentState.type === type &&
            currentState.sessionId === sessionId
        ) {
            currentState.setLoading(false);
            currentState.setImportProgress(0, 0);
        }
        if (locallyAdded.size + remotelyAdded.size > 0) {
            await refreshFavoritesSnapshot();
        }
    }

    const imported = locallyAdded.size + remotelyAdded.size;
    if (
        imported > 0 &&
        useFavoriteImportStore.getState().sessionId === sessionId
    ) {
        useNotificationStore.getState().pushNotification({
            level: 'success',
            title: i18n.t(
                'service.favorite_import_service.dynamic.value_import_complete',
                { value: TYPE_CONFIG[type].label }
            ),
            message: i18n.t(
                'service.favorite_import_service.dynamic.value_item_s_imported',
                { value: imported }
            )
        });
    }
}

export function clearFavoriteImportRows() {
    useFavoriteImportStore.getState().clearRows();
}

export function cancelFavoriteImport() {
    useFavoriteImportStore.getState().cancelActiveWork();
}

export function getFavoriteImportTypeConfig(type: unknown) {
    return TYPE_CONFIG[normalizeType(type)] || null;
}

export function getFavoriteImportGroups(type: unknown) {
    return getFavoriteGroups(normalizeType(type));
}
