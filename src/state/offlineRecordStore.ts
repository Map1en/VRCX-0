import { create } from 'zustand';

import type { FeedLoggerProbe } from '@/platform/tauri/bindings';

export type OfflineRecordSyncProgress = {
    phase: 'pulling' | 'writing';
    frames: number;
};

type OfflineRecordState = {
    health: FeedLoggerProbe | null;
    syncProgress: OfflineRecordSyncProgress | null;
    syncOutcome: 'finished' | 'failed' | null;
    backfillRevision: number;
    riskAcknowledged: boolean;
    applyHealth(health: FeedLoggerProbe): void;
    setSyncProgress(progress: OfflineRecordSyncProgress | null): void;
    finishSync(outcome: 'finished' | 'failed'): void;
    markBackfilled(): void;
    setRiskAcknowledged(riskAcknowledged: boolean): void;
};

export const useOfflineRecordStore = create<OfflineRecordState>((set) => ({
    health: null,
    syncProgress: null,
    syncOutcome: null,
    backfillRevision: 0,
    riskAcknowledged: false,
    applyHealth(health) {
        set({ health });
    },
    setSyncProgress(syncProgress) {
        set({ syncProgress, syncOutcome: null });
    },
    finishSync(syncOutcome) {
        set({ syncProgress: null, syncOutcome });
    },
    markBackfilled() {
        set((state) => ({ backfillRevision: state.backfillRevision + 1 }));
    },
    setRiskAcknowledged(riskAcknowledged) {
        set({ riskAcknowledged });
    }
}));
