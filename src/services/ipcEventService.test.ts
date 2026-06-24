import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appFocusWindow: vi.fn(),
    addGamelogEventToDatabase: vi.fn(),
    addGamelogExternalToDatabase: vi.fn(),
    pushNotification: vi.fn(),
    openWorldDialog: vi.fn(),
    openAvatarDialog: vi.fn(),
    openUserDialog: vi.fn(),
    openGroupDialog: vi.fn()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appFocusWindow: mocks.appFocusWindow
    }
}));

vi.mock('@/repositories/avatarProfileRepository', () => ({
    default: {
        selectAvatar: vi.fn()
    }
}));

vi.mock('@/repositories/avatarSearchProviderRepository', () => ({
    default: {
        getConfig: vi.fn(),
        saveConfig: vi.fn()
    }
}));

vi.mock('@/repositories/configRepository', () => ({
    default: {
        getBool: vi.fn()
    }
}));

vi.mock('@/repositories/favoritePersistenceRepository', () => ({
    default: {
        addWorldToFavorites: vi.fn(),
        addAvatarToFavorites: vi.fn()
    }
}));

vi.mock('@/repositories/gameLogRepository', () => ({
    default: {
        addGamelogEventToDatabase: mocks.addGamelogEventToDatabase,
        addGamelogExternalToDatabase: mocks.addGamelogExternalToDatabase
    }
}));

vi.mock('@/services/i18nService', () => ({
    default: {
        t: (key: string) => key
    }
}));

vi.mock('@/state/notificationStore', () => ({
    useNotificationStore: {
        getState: () => ({
            pushNotification: mocks.pushNotification
        })
    }
}));

vi.mock('./dialogService', () => ({
    openAvatarDialog: mocks.openAvatarDialog,
    openGroupDialog: mocks.openGroupDialog,
    openUserDialog: mocks.openUserDialog,
    openWorldDialog: mocks.openWorldDialog
}));

vi.mock('./favoriteBootstrapService', () => ({
    bootstrapFavorites: vi.fn()
}));

vi.mock('./favoriteImportService', () => ({
    openFavoriteImportDialog: vi.fn()
}));

import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { handleIpcEvent, parseIpcEventPayload } from './ipcEventService';

describe('ipcEventService payload parsing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        useRuntimeStore.getState().resetRuntimeState();
        useSessionStore.getState().resetSessionState();
        useSessionStore.getState().setLoggedIn(true);
    });

    it('narrows known IPC payloads from JSON strings and objects', () => {
        expect(parseIpcEventPayload('{"type":"Ping"}')).toEqual({
            type: 'Ping'
        });
        expect(
            parseIpcEventPayload({
                type: 'MsgPing',
                version: '24'
            })
        ).toEqual({
            type: 'MsgPing',
            version: '24'
        });
        expect(
            parseIpcEventPayload({
                type: 'LaunchCommand',
                command: 'world/wrld_1'
            })
        ).toEqual({
            type: 'LaunchCommand',
            command: 'world/wrld_1'
        });
    });

    it('rejects invalid or incomplete IPC payloads', () => {
        expect(parseIpcEventPayload('not-json')).toBeNull();
        expect(parseIpcEventPayload({})).toBeNull();
        expect(parseIpcEventPayload({ type: 'LaunchCommand' })).toBeNull();
        expect(parseIpcEventPayload({ type: 'MsgPing' })).toBeNull();
    });

    it('keeps unknown typed IPC payloads as records for compatibility', () => {
        expect(parseIpcEventPayload({ type: 'FutureEvent', value: 1 })).toEqual({
            type: 'FutureEvent',
            value: 1
        });
    });

    it('handles Ping and MsgPing without accepting arbitrary records', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        await handleIpcEvent({ type: 'Ping' });
        await handleIpcEvent({ hello: 'world' });
        await handleIpcEvent('{"type":"MsgPing","version":"42"}');

        expect(useRuntimeStore.getState().transport.ipcAnnounced).toBe(true);
        expect(
            useRuntimeStore.getState().gameState.externalNotifierVersion
        ).toBe(42);
        expect(warn).toHaveBeenCalledWith(
            'IPC invalid payload:',
            { hello: 'world' }
        );

        warn.mockRestore();
    });

    it('persists VrcxMessage payloads through typed fields', async () => {
        useRuntimeStore.getState().setGameState({
            currentLocation: 'wrld_test:1'
        });

        await handleIpcEvent({
            type: 'VrcxMessage',
            MsgType: 'Noty',
            Data: 'notice'
        });
        await handleIpcEvent({
            type: 'VrcxMessage',
            MsgType: 'External',
            Data: 'message',
            DisplayName: 'Ava',
            UserId: 'usr_ava',
            notify: true
        });

        expect(mocks.addGamelogEventToDatabase).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'Event',
                data: 'notice'
            })
        );
        expect(mocks.addGamelogExternalToDatabase).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'External',
                message: 'message',
                displayName: 'Ava',
                userId: 'usr_ava',
                location: 'wrld_test:1'
            })
        );
    });
});
