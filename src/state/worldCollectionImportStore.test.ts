import { beforeEach, describe, expect, it } from 'vitest';

import { useWorldCollectionImportStore } from './worldCollectionImportStore';

describe('worldCollectionImportStore', () => {
    beforeEach(() => {
        useWorldCollectionImportStore.getState().reset();
    });

    it('hydrates the backend-owned import status', () => {
        useWorldCollectionImportStore.getState().hydrate({
            runId: 'run-1',
            status: 'running',
            total: 80,
            processed: 12,
            imported: 10,
            failed: 2,
            groupName: 'Shared worlds',
            startedAt: '2026-07-16T00:00:00Z',
            finishedAt: null,
            lastError: null
        });

        expect(useWorldCollectionImportStore.getState()).toMatchObject({
            active: true,
            runId: 'run-1',
            status: 'running',
            progress: 12,
            total: 80,
            imported: 10,
            failed: 2,
            groupName: 'Shared worlds'
        });

        useWorldCollectionImportStore.getState().hydrate({
            runId: 'run-1',
            status: 'completed',
            total: 80,
            processed: 80,
            imported: 78,
            failed: 2,
            groupName: 'Shared worlds',
            startedAt: '2026-07-16T00:00:00Z',
            finishedAt: '2026-07-16T00:10:00Z',
            lastError: null
        });
        expect(useWorldCollectionImportStore.getState()).toMatchObject({
            active: false,
            status: 'completed',
            progress: 80,
            imported: 78,
            failed: 2
        });

        useWorldCollectionImportStore.getState().reset();
        expect(useWorldCollectionImportStore.getState()).toMatchObject({
            active: false,
            runId: '',
            status: 'idle',
            progress: 0,
            total: 0
        });
    });
});
