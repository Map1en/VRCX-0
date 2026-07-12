import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    appDrainPendingDeepLinks:
        vi.fn<
            () => Promise<import('@/platform/tauri/bindings').DeepLinkAction[]>
        >(),
    eventHandler: null as ((payload: unknown) => void) | null,
    confirm: vi.fn(),
    openWorldDialog: vi.fn(),
    previewSharedCollection: vi.fn(),
    importSharedCollection: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    unsubscribe: vi.fn(),
    subscribe:
        vi.fn<
            (
                name: string,
                handler: (payload: unknown) => void
            ) => Promise<() => void>
        >()
}));

vi.mock('@/platform/tauri/bindings', () => ({
    commands: {
        appDrainPendingDeepLinks: mocks.appDrainPendingDeepLinks
    }
}));

vi.mock('@/platform/tauri/client', () => ({
    tauriClient: {
        events: {
            subscribe: mocks.subscribe
        }
    }
}));

vi.mock('@/repositories/shareCollectionRepository', () => ({
    default: {
        previewSharedCollection: mocks.previewSharedCollection,
        importSharedCollection: mocks.importSharedCollection
    }
}));

vi.mock('@/services/dialogService', () => ({
    openWorldDialog: mocks.openWorldDialog
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: {
        getState: () => ({
            confirm: mocks.confirm
        })
    }
}));

vi.mock('sonner', () => ({
    toast: {
        success: mocks.toastSuccess,
        error: mocks.toastError
    }
}));

vi.mock('./i18nService', () => ({
    default: {
        t: (key: string, params?: Record<string, unknown>) =>
            params ? `${key}:${JSON.stringify(params)}` : key
    }
}));

import {
    bindDeepLinkEvents,
    drainPendingDeepLinks,
    handleDeepLinkAction
} from './deepLinkService';

const WORLD_ID = 'wrld_12345678-1234-1234-1234-1234567890ab';

describe('deepLinkService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.eventHandler = null;
        mocks.appDrainPendingDeepLinks.mockResolvedValue([]);
        mocks.subscribe.mockImplementation(async (name, handler) => {
            expect(name).toBe('deepLinkArrived');
            mocks.eventHandler = handler;
            return mocks.unsubscribe;
        });
    });

    it('subscribes without draining queued links during binding', async () => {
        const unbind = await bindDeepLinkEvents();

        expect(mocks.appDrainPendingDeepLinks).not.toHaveBeenCalled();
        unbind();
        expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('drains queued links when the wake event arrives', async () => {
        await bindDeepLinkEvents();
        expect(mocks.appDrainPendingDeepLinks).not.toHaveBeenCalled();
        mocks.appDrainPendingDeepLinks.mockResolvedValueOnce([
            { type: 'importCollection', collectionId: 'AbC123z' }
        ]);
        mocks.previewSharedCollection.mockResolvedValueOnce({
            title: 'Scenic picks',
            authorName: 'Someone',
            worldCount: 2,
            worlds: [
                { worldId: 'wrld_a', name: 'A', imageUrl: '' },
                { worldId: 'wrld_b', name: 'B', imageUrl: '' }
            ]
        });
        mocks.confirm.mockResolvedValueOnce({ ok: false, reason: 'cancel' });

        mocks.eventHandler?.({});

        await vi.waitFor(() => {
            expect(mocks.previewSharedCollection).toHaveBeenCalledWith(
                'AbC123z'
            );
        });
        await vi.waitFor(() => {
            expect(mocks.confirm).toHaveBeenCalled();
        });
        expect(mocks.importSharedCollection).not.toHaveBeenCalled();
    });

    it('imports the collection after confirmation and shows a success toast', () => {
        mocks.previewSharedCollection.mockResolvedValueOnce({
            title: 'Scenic picks',
            authorName: 'Someone',
            worldCount: 1,
            worlds: [{ worldId: 'wrld_a', name: 'A', imageUrl: '' }]
        });
        mocks.confirm.mockResolvedValueOnce({ ok: true, reason: 'ok' });
        mocks.importSharedCollection.mockResolvedValueOnce({
            groupKey: 'Scenic picks',
            importedCount: 1
        });

        handleDeepLinkAction({
            type: 'importCollection',
            collectionId: 'Z9xY12'
        });

        return vi.waitFor(() => {
            expect(mocks.importSharedCollection).toHaveBeenCalledWith('Z9xY12');
            expect(mocks.toastSuccess).toHaveBeenCalled();
        });
    });

    it('opens worlds from actions', () => {
        handleDeepLinkAction({ type: 'openWorld', worldId: WORLD_ID });

        expect(mocks.openWorldDialog).toHaveBeenCalledWith({
            worldId: WORLD_ID
        });
    });

    it('shows a toast when a shared collection has no importable worlds', () => {
        mocks.previewSharedCollection.mockResolvedValueOnce({
            title: 'Empty',
            authorName: '',
            worldCount: 0,
            worlds: []
        });

        handleDeepLinkAction({
            type: 'importCollection',
            collectionId: 'EmptyId'
        });

        return vi.waitFor(() => {
            expect(mocks.toastError).toHaveBeenCalled();
            expect(mocks.confirm).not.toHaveBeenCalled();
        });
    });

    it('ignores malformed action payloads defensively', async () => {
        handleDeepLinkAction({ type: 'openWorld', worldId: 'bad' });
        handleDeepLinkAction({
            type: 'importCollection',
            collectionId: 'bad/value'
        });
        mocks.appDrainPendingDeepLinks.mockRejectedValueOnce(
            new Error('drain failed')
        );

        await drainPendingDeepLinks();

        expect(mocks.openWorldDialog).not.toHaveBeenCalled();
        expect(mocks.previewSharedCollection).not.toHaveBeenCalled();
    });
});
