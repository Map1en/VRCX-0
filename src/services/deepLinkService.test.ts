import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SharedCollectionImportStatus } from '@/platform/tauri/bindings';

const mocks = vi.hoisted(() => ({
    appDrainPendingDeepLinks:
        vi.fn<
            () => Promise<import('@/platform/tauri/bindings').DeepLinkAction[]>
        >(),
    appSharedCollectionImportStart:
        vi.fn<
            (
                input: import('@/platform/tauri/bindings').SharedCollectionImportStartInput
            ) => Promise<
                import('@/platform/tauri/bindings').SharedCollectionImportStatus
            >
        >(),
    appSharedCollectionImportStatus:
        vi.fn<
            () => Promise<
                import('@/platform/tauri/bindings').SharedCollectionImportStatus
            >
        >(),
    appSharedCollectionImportCancel:
        vi.fn<
            () => Promise<
                import('@/platform/tauri/bindings').SharedCollectionImportStatus
            >
        >(),
    eventHandlers: new Map<string, (payload: unknown) => void>(),
    prompt: vi.fn(),
    openWorldDialog: vi.fn(),
    previewSharedCollection: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    unsubscribeDeepLink: vi.fn(),
    unsubscribeStatus: vi.fn(),
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
        appDrainPendingDeepLinks: mocks.appDrainPendingDeepLinks,
        appSharedCollectionImportStart: mocks.appSharedCollectionImportStart,
        appSharedCollectionImportStatus: mocks.appSharedCollectionImportStatus,
        appSharedCollectionImportCancel: mocks.appSharedCollectionImportCancel
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
        previewSharedCollection: mocks.previewSharedCollection
    }
}));

vi.mock('@/services/dialogService', () => ({
    openWorldDialog: mocks.openWorldDialog
}));

vi.mock('@/state/modalStore', () => ({
    useModalStore: {
        getState: () => ({
            prompt: mocks.prompt
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

import { useWorldCollectionImportStore } from '@/state/worldCollectionImportStore';

import {
    bindDeepLinkEvents,
    cancelSharedCollectionImport,
    drainPendingDeepLinks,
    handleDeepLinkAction
} from './deepLinkService';

const WORLD_ID = 'wrld_12345678-1234-1234-1234-1234567890ab';

function importStatus(
    overrides: Partial<SharedCollectionImportStatus> = {}
): SharedCollectionImportStatus {
    return {
        runId: '',
        status: 'idle',
        total: 0,
        processed: 0,
        imported: 0,
        failed: 0,
        groupName: '',
        startedAt: null,
        finishedAt: null,
        lastError: null,
        ...overrides
    };
}

describe('deepLinkService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.eventHandlers.clear();
        useWorldCollectionImportStore.getState().reset();
        mocks.appDrainPendingDeepLinks.mockResolvedValue([]);
        mocks.appSharedCollectionImportStatus.mockResolvedValue(importStatus());
        mocks.appSharedCollectionImportCancel.mockResolvedValue(
            importStatus({ status: 'cancelled' })
        );
        mocks.subscribe.mockImplementation(async (name, handler) => {
            mocks.eventHandlers.set(name, handler);
            return name === 'deepLinkArrived'
                ? mocks.unsubscribeDeepLink
                : mocks.unsubscribeStatus;
        });
    });

    it('subscribes and hydrates status without draining queued links', async () => {
        const unbind = await bindDeepLinkEvents();

        expect(mocks.subscribe).toHaveBeenCalledWith(
            'deepLinkArrived',
            expect.any(Function)
        );
        expect(mocks.subscribe).toHaveBeenCalledWith(
            'sharedCollectionImportStatus',
            expect.any(Function)
        );
        expect(mocks.appSharedCollectionImportStatus).toHaveBeenCalledOnce();
        expect(mocks.appDrainPendingDeepLinks).not.toHaveBeenCalled();
        unbind();
        expect(mocks.unsubscribeDeepLink).toHaveBeenCalledOnce();
        expect(mocks.unsubscribeStatus).toHaveBeenCalledOnce();
    });

    it('hydrates a running backend import during WebView binding', async () => {
        mocks.appSharedCollectionImportStatus.mockResolvedValueOnce(
            importStatus({
                runId: 'run-recovered',
                status: 'running',
                total: 9,
                processed: 4,
                imported: 3,
                failed: 1,
                groupName: 'Recovered'
            })
        );

        const unbind = await bindDeepLinkEvents();

        expect(useWorldCollectionImportStore.getState()).toMatchObject({
            active: true,
            runId: 'run-recovered',
            progress: 4,
            imported: 3,
            failed: 1
        });
        unbind();
    });

    it('drains queued links when the wake event arrives', async () => {
        const unbind = await bindDeepLinkEvents();
        mocks.appDrainPendingDeepLinks.mockResolvedValueOnce([
            { type: 'importCollection', collectionId: 'AbC123z' }
        ]);
        mocks.previewSharedCollection.mockResolvedValueOnce({
            title: 'Scenic picks',
            worldIds: [WORLD_ID, WORLD_ID.replace(/ab$/, 'ac')]
        });
        mocks.prompt.mockResolvedValueOnce({ ok: false, reason: 'cancel' });

        mocks.eventHandlers.get('deepLinkArrived')?.({});

        await vi.waitFor(() => {
            expect(mocks.prompt).toHaveBeenCalled();
        });
        expect(mocks.appSharedCollectionImportStart).not.toHaveBeenCalled();
        unbind();
    });

    it('starts the backend import and reports a partial success', async () => {
        const secondWorldId = WORLD_ID.replace(/ab$/, 'ac');
        const running = importStatus({
            runId: 'run-success',
            status: 'running',
            total: 2,
            groupName: 'My local worlds'
        });
        mocks.previewSharedCollection.mockResolvedValueOnce({
            title: 'Scenic picks',
            worldIds: [WORLD_ID, secondWorldId]
        });
        mocks.prompt.mockResolvedValueOnce({
            ok: true,
            reason: 'ok',
            value: ' My local worlds '
        });
        mocks.appSharedCollectionImportStart.mockResolvedValueOnce(running);
        mocks.appSharedCollectionImportStatus.mockResolvedValue(running);
        const unbind = await bindDeepLinkEvents();

        handleDeepLinkAction({
            type: 'importCollection',
            collectionId: 'Z9xY12'
        });
        await vi.waitFor(() => {
            expect(mocks.appSharedCollectionImportStart).toHaveBeenCalledWith({
                worldIds: [WORLD_ID, secondWorldId],
                groupName: 'My local worlds'
            });
        });
        mocks.eventHandlers.get('sharedCollectionImportStatus')?.(
            importStatus({
                ...running,
                status: 'completed',
                processed: 2,
                imported: 1,
                failed: 1,
                finishedAt: '2026-07-16T00:01:00Z'
            })
        );

        await vi.waitFor(() => {
            expect(mocks.toastSuccess).toHaveBeenCalled();
            expect(mocks.toastError).toHaveBeenCalledWith(
                'deep_link.import_collection.toast.import_partial_failed:{"count":1}'
            );
        });
        unbind();
    });

    it('serializes collection prompts until the backend run is terminal', async () => {
        let activeStatus = importStatus();
        mocks.previewSharedCollection
            .mockResolvedValueOnce({
                title: 'First collection',
                worldIds: [WORLD_ID]
            })
            .mockResolvedValueOnce({
                title: 'Second collection',
                worldIds: [WORLD_ID.replace(/ab$/, 'ac')]
            });
        mocks.prompt
            .mockResolvedValueOnce({
                ok: true,
                reason: 'ok',
                value: 'First local group'
            })
            .mockResolvedValueOnce({
                ok: true,
                reason: 'ok',
                value: 'Second local group'
            });
        mocks.appSharedCollectionImportStart.mockImplementation(
            async ({ groupName }) => {
                activeStatus = importStatus({
                    runId: `run-${groupName}`,
                    status: 'running',
                    total: 1,
                    groupName
                });
                return activeStatus;
            }
        );
        mocks.appSharedCollectionImportStatus.mockImplementation(
            async () => activeStatus
        );
        const unbind = await bindDeepLinkEvents();

        handleDeepLinkAction({
            type: 'importCollection',
            collectionId: 'First12'
        });
        handleDeepLinkAction({
            type: 'importCollection',
            collectionId: 'Second2'
        });

        await vi.waitFor(() => {
            expect(mocks.appSharedCollectionImportStart).toHaveBeenCalledTimes(
                1
            );
        });
        expect(mocks.previewSharedCollection).toHaveBeenCalledTimes(1);

        activeStatus = importStatus({
            ...activeStatus,
            status: 'completed',
            processed: 1,
            imported: 1
        });
        mocks.eventHandlers.get('sharedCollectionImportStatus')?.(activeStatus);

        await vi.waitFor(() => {
            expect(mocks.appSharedCollectionImportStart).toHaveBeenCalledTimes(
                2
            );
        });
        expect(mocks.previewSharedCollection).toHaveBeenNthCalledWith(
            2,
            'Second2'
        );

        activeStatus = importStatus({
            ...activeStatus,
            status: 'completed',
            processed: 1,
            imported: 1
        });
        mocks.eventHandlers.get('sharedCollectionImportStatus')?.(activeStatus);
        await vi.waitFor(() => {
            expect(mocks.toastSuccess).toHaveBeenCalledTimes(2);
        });
        unbind();
    });

    it('cancels through the typed backend command and hydrates its result', async () => {
        const cancelled = importStatus({
            runId: 'run-cancel',
            status: 'cancelling',
            total: 3,
            processed: 1,
            groupName: 'Cancelled'
        });
        mocks.appSharedCollectionImportCancel.mockResolvedValueOnce(cancelled);

        await cancelSharedCollectionImport();

        expect(mocks.appSharedCollectionImportCancel).toHaveBeenCalledOnce();
        expect(useWorldCollectionImportStore.getState()).toMatchObject({
            active: true,
            runId: 'run-cancel',
            status: 'cancelling',
            progress: 1
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
            worldIds: []
        });

        handleDeepLinkAction({
            type: 'importCollection',
            collectionId: 'EmptyId'
        });

        return vi.waitFor(() => {
            expect(mocks.toastError).toHaveBeenCalled();
            expect(mocks.prompt).not.toHaveBeenCalled();
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
