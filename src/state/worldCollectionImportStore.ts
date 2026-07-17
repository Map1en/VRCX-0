import { create } from 'zustand';

import type {
    SharedCollectionImportState,
    SharedCollectionImportStatus
} from '@/platform/tauri/bindings';

type WorldCollectionImportState = {
    active: boolean;
    runId: string;
    status: SharedCollectionImportState;
    progress: number;
    total: number;
    imported: number;
    failed: number;
    groupName: string;
    lastError: string | null;
    hydrate(status: SharedCollectionImportStatus): void;
    reset(): void;
};

const idleState = {
    active: false,
    runId: '',
    status: 'idle' as const,
    progress: 0,
    total: 0,
    imported: 0,
    failed: 0,
    groupName: '',
    lastError: null
};

export const useWorldCollectionImportStore = create<WorldCollectionImportState>(
    (set) => ({
        ...idleState,
        hydrate(status) {
            set({
                active:
                    status.status === 'running' ||
                    status.status === 'cancelling',
                runId: status.runId,
                status: status.status,
                progress: status.processed,
                total: status.total,
                imported: status.imported,
                failed: status.failed,
                groupName: status.groupName,
                lastError: status.lastError
            });
        },
        reset() {
            set(idleState);
        }
    })
);
