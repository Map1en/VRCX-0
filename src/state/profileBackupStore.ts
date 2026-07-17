import { create } from 'zustand';

import type {
    ProfileBackupStatus,
    ProfileRestoreProgress,
    ProfileRestoreResult,
    ProfileRestoreRollbackState,
    ProfileRestoreValidation
} from '@/services/profileBackupService';

const NOTIFIED_OUTCOME_REVISION_KEY =
    'vrcx-0.profile-backup.notified-outcome-revision';

function readNotifiedOutcomeRevision(): number {
    if (typeof window === 'undefined') {
        return -1;
    }
    try {
        const revision = Number.parseInt(
            window.sessionStorage.getItem(NOTIFIED_OUTCOME_REVISION_KEY) || '',
            10
        );
        return Number.isSafeInteger(revision) && revision >= 0 ? revision : -1;
    } catch {
        return -1;
    }
}

function writeNotifiedOutcomeRevision(revision: number) {
    if (typeof window === 'undefined') {
        return;
    }
    try {
        window.sessionStorage.setItem(
            NOTIFIED_OUTCOME_REVISION_KEY,
            String(revision)
        );
    } catch {
        return;
    }
}

type ProfileRestoreFlow = 'idle' | 'validating' | 'confirm' | 'preparing';

function restoreOperationForFlow(
    flow: ProfileRestoreFlow
): ProfileRestoreProgress['operation'] | null {
    switch (flow) {
        case 'validating':
            return 'validate';
        case 'preparing':
            return 'prepare';
        default:
            return null;
    }
}

type ProfileBackupStore = {
    status: ProfileBackupStatus;
    lastAppliedRevision: number;
    lastNotifiedOutcomeRevision: number;
    restoreFlow: ProfileRestoreFlow;
    restoreValidation: ProfileRestoreValidation | null;
    restoreProgress: ProfileRestoreProgress | null;
    lastRestoreProgressRevision: number;
    startupRestoreResult: ProfileRestoreResult | null;
    startupRestoreResultChecked: boolean;
    restoreRollbackState: ProfileRestoreRollbackState | null;
    restoreRollbackStateRequestRevision: number;
    restoreRollbackCleanupRunning: boolean;
    applyStatus(status: ProfileBackupStatus): void;
    claimOutcomeNotification(revision: number): boolean;
    beginRestoreValidation(): void;
    showRestoreConfirmation(validation: ProfileRestoreValidation): void;
    beginRestorePreparation(): void;
    applyRestoreProgress(progress: ProfileRestoreProgress): void;
    closeRestoreFlow(): void;
    beginStartupRestoreResultCheck(): boolean;
    setStartupRestoreResult(result: ProfileRestoreResult | null): void;
    clearStartupRestoreResult(): void;
    beginRestoreRollbackStateRefresh(): number;
    completeRestoreRollbackStateRefresh(
        revision: number,
        state: ProfileRestoreRollbackState | null
    ): boolean;
    setRestoreRollbackState(state: ProfileRestoreRollbackState): void;
    beginRestoreRollbackCleanup(): boolean;
    finishRestoreRollbackCleanup(): void;
    resetProfileBackupState(): void;
};

function createIdleStatus(): ProfileBackupStatus {
    return {
        revision: 0,
        state: 'idle',
        kind: null,
        phase: null,
        percent: null,
        error: null,
        lastOutcome: null
    };
}

export const useProfileBackupStore = create<ProfileBackupStore>((set, get) => ({
    status: createIdleStatus(),
    lastAppliedRevision: -1,
    lastNotifiedOutcomeRevision: readNotifiedOutcomeRevision(),
    restoreFlow: 'idle',
    restoreValidation: null,
    restoreProgress: null,
    lastRestoreProgressRevision: -1,
    startupRestoreResult: null,
    startupRestoreResultChecked: false,
    restoreRollbackState: null,
    restoreRollbackStateRequestRevision: 0,
    restoreRollbackCleanupRunning: false,
    applyStatus(status) {
        set((current) => {
            if (status.revision <= current.lastAppliedRevision) {
                return current;
            }
            return {
                status,
                lastAppliedRevision: status.revision
            };
        });
    },
    claimOutcomeNotification(revision) {
        if (revision <= get().lastNotifiedOutcomeRevision) {
            return false;
        }
        writeNotifiedOutcomeRevision(revision);
        set({ lastNotifiedOutcomeRevision: revision });
        return true;
    },
    beginRestoreValidation() {
        set({
            restoreFlow: 'validating',
            restoreValidation: null,
            restoreProgress: null
        });
    },
    showRestoreConfirmation(restoreValidation) {
        set({
            restoreFlow: 'confirm',
            restoreValidation,
            restoreProgress: null
        });
    },
    beginRestorePreparation() {
        set({ restoreFlow: 'preparing', restoreProgress: null });
    },
    applyRestoreProgress(restoreProgress) {
        set((state) => {
            if (
                restoreProgress.revision <= state.lastRestoreProgressRevision ||
                restoreProgress.operation !==
                    restoreOperationForFlow(state.restoreFlow)
            ) {
                return state;
            }
            return {
                restoreProgress,
                lastRestoreProgressRevision: restoreProgress.revision
            };
        });
    },
    closeRestoreFlow() {
        set({
            restoreFlow: 'idle',
            restoreValidation: null,
            restoreProgress: null
        });
    },
    beginStartupRestoreResultCheck() {
        if (get().startupRestoreResultChecked) {
            return false;
        }
        set({ startupRestoreResultChecked: true });
        return true;
    },
    setStartupRestoreResult(startupRestoreResult) {
        set({ startupRestoreResult });
    },
    clearStartupRestoreResult() {
        set({ startupRestoreResult: null });
    },
    beginRestoreRollbackStateRefresh() {
        const revision = get().restoreRollbackStateRequestRevision + 1;
        set({
            restoreRollbackState: null,
            restoreRollbackStateRequestRevision: revision
        });
        return revision;
    },
    completeRestoreRollbackStateRefresh(revision, restoreRollbackState) {
        if (revision !== get().restoreRollbackStateRequestRevision) {
            return false;
        }
        set({ restoreRollbackState });
        return true;
    },
    setRestoreRollbackState(restoreRollbackState) {
        set((state) => ({
            restoreRollbackState,
            restoreRollbackStateRequestRevision:
                state.restoreRollbackStateRequestRevision + 1
        }));
    },
    beginRestoreRollbackCleanup() {
        if (get().restoreRollbackCleanupRunning) {
            return false;
        }
        set({ restoreRollbackCleanupRunning: true });
        return true;
    },
    finishRestoreRollbackCleanup() {
        set({ restoreRollbackCleanupRunning: false });
    },
    resetProfileBackupState() {
        set((state) => ({
            status: createIdleStatus(),
            lastAppliedRevision: -1,
            lastNotifiedOutcomeRevision: readNotifiedOutcomeRevision(),
            restoreFlow: 'idle',
            restoreValidation: null,
            restoreProgress: null,
            lastRestoreProgressRevision: -1,
            startupRestoreResult: null,
            startupRestoreResultChecked: false,
            restoreRollbackState: null,
            restoreRollbackStateRequestRevision:
                state.restoreRollbackStateRequestRevision + 1,
            restoreRollbackCleanupRunning: false
        }));
    }
}));
