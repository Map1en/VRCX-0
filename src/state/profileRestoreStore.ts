import { create } from 'zustand';

import type { ProfileRestoreState } from '@/platform/tauri/bindings';

export type ProfileRestoreBusyAction =
    | 'loading'
    | 'restore'
    | 'confirm'
    | 'rollback'
    | 'acknowledge'
    | null;

export const IDLE_PROFILE_RESTORE_STATE: ProfileRestoreState = {
    status: 'idle',
    updatedAt: null,
    backupCreatedAt: null,
    backupAppVersion: null,
    backupDatabaseSchemaVersion: null,
    message: null,
    requiresRestart: false,
    canConfirm: false,
    canRollback: false,
    canAcknowledge: false
};

type ProfileRestoreStore = {
    state: ProfileRestoreState;
    loaded: boolean;
    busy: ProfileRestoreBusyAction;
    error: unknown;
    applyState(state: ProfileRestoreState): void;
    setBusy(busy: ProfileRestoreBusyAction): void;
    setError(error: unknown): void;
    reset(): void;
};

export const useProfileRestoreStore = create<ProfileRestoreStore>((set) => ({
    state: IDLE_PROFILE_RESTORE_STATE,
    loaded: false,
    busy: null,
    error: null,
    applyState: (state) => set({ state, loaded: true, error: null }),
    setBusy: (busy) => set({ busy }),
    setError: (error) => set({ error }),
    reset: () =>
        set({
            state: IDLE_PROFILE_RESTORE_STATE,
            loaded: false,
            busy: null,
            error: null
        })
}));
