import { backend } from '@/platform/index.js';
import {
    avatarSearchProviderRepository,
    configRepository,
    gameLogRepository,
    localFavoritesRepository,
    webRepository
} from '@/repositories/index.js';
import { useModalStore } from '@/state/modalStore.js';
import { useNotificationStore } from '@/state/notificationStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';

import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from './dialogService.js';
import { bootstrapFavorites } from './favoriteBootstrapService.js';
import { openFavoriteImportDialog } from './favoriteImportService.js';

let ipcTimeoutId = null;

function scheduleIpcTimeout() {
    if (ipcTimeoutId) {
        globalThis.clearTimeout(ipcTimeoutId);
    }

    ipcTimeoutId = globalThis.setTimeout(() => {
        useRuntimeStore.getState().setTransportState({
            ipcAnnounced: false
        });
        ipcTimeoutId = null;
    }, 60_000);
}

function parseIpcPayload(payload) {
    if (typeof payload === 'string') {
        return JSON.parse(payload);
    }
    if (payload && typeof payload === 'object') {
        return payload;
    }
    throw new Error('Unsupported IPC payload shape.');
}

function normalizeString(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

async function persistVrcxMessage(data) {
    const runtimeState = useRuntimeStore.getState();
    const location =
        runtimeState.gameState.currentLocation ||
        runtimeState.auth.currentUserSnapshot?.location ||
        '';

    switch (data.MsgType) {
        case 'Noty': {
            if (Number(runtimeState.gameState.externalNotifierVersion) > 21) {
                return;
            }

            const entry = {
                created_at: new Date().toJSON(),
                type: 'Event',
                data: normalizeString(data.Data)
            };
            await gameLogRepository.addGamelogEventToDatabase(entry);
            useNotificationStore.getState().pushNotification({
                level: 'info',
                title: 'External notifier',
                message: entry.data
            });
            break;
        }
        case 'External': {
            const entry = {
                created_at: new Date().toJSON(),
                type: 'External',
                message: normalizeString(data.Data),
                displayName: normalizeString(data.DisplayName),
                userId: normalizeString(data.UserId),
                location
            };
            await gameLogRepository.addGamelogExternalToDatabase(entry);
            if (data.notify ?? true) {
                useNotificationStore.getState().pushNotification({
                    level: 'info',
                    title: entry.displayName || 'External',
                    message: entry.message
                });
            }
            break;
        }
        default:
            console.log('VRCXMessage:', data);
            break;
    }
}

async function handleLaunchCommand(input) {
    const commandInput = normalizeString(input);
    if (!commandInput) {
        return;
    }

    const args = commandInput.split('/');
    const command = args[0];
    const commandArg = args[1]?.trim();
    let shouldFocusWindow = true;
    const runtimeState = useRuntimeStore.getState();
    const endpoint =
        runtimeState.auth.currentUserEndpoint ||
        'https://api.vrchat.cloud/api/1';

    switch (command) {
        case 'world':
            openWorldDialog({ worldId: commandArg });
            break;
        case 'avatar':
            openAvatarDialog({ avatarId: commandArg });
            break;
        case 'user':
            openUserDialog({ userId: commandArg });
            break;
        case 'group':
            openGroupDialog({ groupId: commandArg });
            break;
        case 'local-favorite-world': {
            const [worldId, groupName] = normalizeString(commandArg).split(':');
            if (!worldId || !groupName) {
                throw new Error('Invalid local favorite world command.');
            }
            await localFavoritesRepository.addWorldToFavorites(
                worldId,
                groupName
            );
            openWorldDialog({ worldId });
            void bootstrapFavorites({
                userId: runtimeState.auth.currentUserId,
                endpoint: runtimeState.auth.currentUserEndpoint,
                currentUserSnapshot: runtimeState.auth.currentUserSnapshot
            });
            break;
        }
        case 'local-favorite-avatar': {
            const [avatarId, groupName] =
                normalizeString(commandArg).split(':');
            if (!avatarId || !groupName) {
                throw new Error('Invalid local favorite avatar command.');
            }
            await localFavoritesRepository.addAvatarToFavorites(
                avatarId,
                groupName
            );
            openAvatarDialog({ avatarId });
            void bootstrapFavorites({
                userId: runtimeState.auth.currentUserId,
                endpoint: runtimeState.auth.currentUserEndpoint,
                currentUserSnapshot: runtimeState.auth.currentUserSnapshot
            });
            break;
        }
        case 'addavatardb': {
            const provider = commandInput.replace('addavatardb/', '').trim();
            if (!provider) {
                throw new Error('Invalid avatar database provider command.');
            }
            const config = await avatarSearchProviderRepository.getConfig();
            await avatarSearchProviderRepository.saveConfig({
                enabled: true,
                providerList: Array.from(
                    new Set([...config.providerList, provider])
                )
            });
            useNotificationStore.getState().pushNotification({
                level: 'info',
                title: 'Avatar provider added',
                message: provider
            });
            break;
        }
        case 'switchavatar': {
            const avatarId = commandArg;
            const regexAvatarId =
                /avtr_[0-9A-Fa-f]{8}-([0-9A-Fa-f]{4}-){3}[0-9A-Fa-f]{12}/;
            if (!regexAvatarId.test(avatarId) || avatarId.length !== 41) {
                throw new Error('Invalid Avatar ID.');
            }
            const shouldConfirm = await configRepository.getBool(
                'showConfirmationOnSwitchAvatar',
                true
            );
            if (shouldConfirm) {
                const result = await useModalStore.getState().confirm({
                    title: 'Confirm',
                    description: `Select avatar?\n${avatarId}`,
                    confirmText: 'Select',
                    cancelText: 'Cancel'
                });
                if (!result.ok) {
                    break;
                }
                shouldFocusWindow = true;
            } else {
                shouldFocusWindow = false;
            }
            const url = new URL(
                `avatars/${encodeURIComponent(avatarId)}/select`,
                endpoint.replace(/\/?$/, '/')
            );
            const response = await webRepository.execute({
                url: url.toString(),
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json;charset=utf-8'
                }
            });
            if (response.status >= 400) {
                throw new Error(`Avatar switch failed (${response.status}).`);
            }
            openAvatarDialog({ avatarId });
            useNotificationStore.getState().pushNotification({
                level: 'success',
                title: 'Avatar changed',
                message: avatarId
            });
            break;
        }
        case 'import': {
            const importType = args[1]?.trim();
            if (!['avatar', 'world', 'friend'].includes(importType)) {
                throw new Error('Invalid import command type.');
            }
            const data = commandInput.replace(`import/${importType}/`, '');
            openFavoriteImportDialog({
                type: importType,
                input: data
            });
            break;
        }
        default:
            shouldFocusWindow = false;
            console.log('Unhandled launch command:', input);
            break;
    }

    if (shouldFocusWindow) {
        await backend.app.FocusWindow().catch(() => {});
    }
}

export async function handleIpcEvent(payload) {
    if (!useSessionStore.getState().isLoggedIn) {
        return;
    }

    let data;
    try {
        data = parseIpcPayload(payload);
    } catch (error) {
        console.warn('IPC invalid payload:', payload, error);
        return;
    }

    switch (data.type) {
        case 'Ping':
            useRuntimeStore.getState().setTransportState({
                ipcAnnounced: true,
                lastIpcAnnouncedAt: new Date().toISOString()
            });
            scheduleIpcTimeout();
            break;
        case 'MsgPing':
            useRuntimeStore.getState().setGameState({
                externalNotifierVersion: Number.parseInt(data.version, 10) || 0
            });
            break;
        case 'VrcxMessage':
            await persistVrcxMessage(data);
            break;
        case 'LaunchCommand':
            await handleLaunchCommand(data.command);
            break;
        case 'VRCXLaunch':
            console.log('VRCXLaunch:', data);
            break;
        case 'OnEvent':
        case 'OnOperationResponse':
        case 'OnOperationRequest':
        case 'VRCEvent':
        case 'Event7List':
            useRuntimeStore
                .getState()
                .recordTransportMessage(data.type, JSON.stringify(data).length);
            break;
        default:
            console.log('IPC:', data);
            break;
    }
}
