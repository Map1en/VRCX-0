import { commands } from '@/platform/tauri/bindings';
import avatarProfileRepository from '@/repositories/avatarProfileRepository';
import avatarSearchProviderRepository from '@/repositories/avatarSearchProviderRepository';
import configRepository from '@/repositories/configRepository';
import favoritePersistenceRepository from '@/repositories/favoritePersistenceRepository';
import gameLogRepository from '@/repositories/gameLogRepository';
import i18n from '@/services/i18nService';
import { useModalStore } from '@/state/modalStore';
import { useNotificationStore } from '@/state/notificationStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import {
    openAvatarDialog,
    openGroupDialog,
    openUserDialog,
    openWorldDialog
} from './dialogService';
import { bootstrapFavorites } from './favoriteBootstrapService';
import { openFavoriteImportDialog } from './favoriteImportService';

let ipcTimeoutId = null;

type IpcRecord = Record<string, unknown>;
type IpcPingPayload = { type: 'Ping' };
type IpcMsgPingPayload = { type: 'MsgPing'; version: string };
type IpcVrcxMessagePayload = IpcRecord & {
    type: 'VrcxMessage';
    MsgType: string;
};
type IpcLaunchCommandPayload = { type: 'LaunchCommand'; command: string };
type IpcVrcxLaunchPayload = IpcRecord & { type: 'VRCXLaunch' };
type IpcUnknownTypedPayload = IpcRecord & { type: string };

type IpcKnownEventPayload =
    | IpcPingPayload
    | IpcMsgPingPayload
    | IpcVrcxMessagePayload
    | IpcLaunchCommandPayload
    | IpcVrcxLaunchPayload;

export type IpcEventPayload = IpcKnownEventPayload | IpcUnknownTypedPayload;

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

function isRecord(value: unknown): value is IpcRecord {
    return Boolean(value && typeof value === 'object');
}

function parseIpcPayload(payload: unknown): IpcRecord | null {
    try {
        if (typeof payload === 'string') {
            const parsed = JSON.parse(payload);
            return isRecord(parsed) ? parsed : null;
        }
        return isRecord(payload) ? payload : null;
    } catch {
        return null;
    }
}

function normalizeString(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function isKnownIpcEventPayload(
    payload: IpcEventPayload
): payload is IpcKnownEventPayload {
    switch (payload.type) {
        case 'Ping':
        case 'MsgPing':
        case 'VrcxMessage':
        case 'LaunchCommand':
        case 'VRCXLaunch':
            return true;
        default:
            return false;
    }
}

export function parseIpcEventPayload(payload: unknown): IpcEventPayload | null {
    const record = parseIpcPayload(payload);
    const type = normalizeString(record?.type);
    if (!record || !type) {
        return null;
    }

    switch (type) {
        case 'Ping':
            return { type };
        case 'MsgPing': {
            const version = normalizeString(record.version);
            return version ? { type, version } : null;
        }
        case 'VrcxMessage': {
            const MsgType = normalizeString(record.MsgType);
            return MsgType ? { ...record, type, MsgType } : null;
        }
        case 'LaunchCommand': {
            const command = normalizeString(record.command);
            return command ? { type, command } : null;
        }
        case 'VRCXLaunch':
            return { ...record, type };
        default:
            return { ...record, type };
    }
}

async function persistVrcxMessage(data: IpcVrcxMessagePayload) {
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

            const entry: any = {
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
            const entry: any = {
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

async function handleLaunchCommand(input: unknown) {
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
            await favoritePersistenceRepository.addWorldToFavorites(
                worldId,
                groupName
            );
            openWorldDialog({ worldId });
            bootstrapFavorites({
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
            await favoritePersistenceRepository.addAvatarToFavorites(
                avatarId,
                groupName
            );
            openAvatarDialog({ avatarId });
            bootstrapFavorites({
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
                    title: i18n.t('common.actions.confirm'),
                    description: i18n.t(
                        'service.ipc_event_service.modal.select_avatar_value',
                        { value: avatarId }
                    ),
                    confirmText: i18n.t('common.actions.select'),
                    cancelText: i18n.t('common.actions.cancel')
                });
                if (!result.ok) {
                    break;
                }
                shouldFocusWindow = true;
            } else {
                shouldFocusWindow = false;
            }
            const response = await avatarProfileRepository.selectAvatar({
                avatarId,
                endpoint
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
        await commands.appFocusWindow().catch(() => {});
    }
}

export async function handleIpcEvent(payload: unknown) {
    if (!useSessionStore.getState().isLoggedIn) {
        return;
    }

    const data = parseIpcEventPayload(payload);
    if (!data) {
        console.warn('IPC invalid payload:', payload);
        return;
    }

    if (!isKnownIpcEventPayload(data)) {
        console.log('IPC:', data);
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
                externalNotifierVersion:
                    Number.parseInt(data.version, 10) || 0
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
    }
}
