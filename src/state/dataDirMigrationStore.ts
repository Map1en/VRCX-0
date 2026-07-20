import { create } from 'zustand';

import type {
    DataDirMigrationMode,
    DataDirMigrationPlan,
    DataDirMigrationStatus
} from '@/services/dataDirMigrationService';

type DataDirMigrationStore = {
    status: DataDirMigrationStatus;
    lastAppliedRevision: number;
    dialogOpen: boolean;
    plan: DataDirMigrationPlan | null;
    mode: DataDirMigrationMode;
    applyStatus(status: DataDirMigrationStatus): void;
    openDialog(plan: DataDirMigrationPlan): void;
    closeDialog(): void;
    setMode(mode: DataDirMigrationMode): void;
};

function idleStatus(): DataDirMigrationStatus {
    return {
        revision: 0,
        state: 'idle'
    };
}

export const useDataDirMigrationStore = create<DataDirMigrationStore>(
    (set) => ({
        status: idleStatus(),
        lastAppliedRevision: -1,
        dialogOpen: false,
        plan: null,
        mode: 'migrate',
        applyStatus(status) {
            set((current) =>
                status.revision <= current.lastAppliedRevision
                    ? current
                    : {
                          status,
                          lastAppliedRevision: status.revision
                      }
            );
        },
        openDialog(plan) {
            set({
                dialogOpen: true,
                plan,
                mode: 'migrate',
                status: idleStatus(),
                lastAppliedRevision: -1
            });
        },
        closeDialog() {
            set({ dialogOpen: false, plan: null, mode: 'migrate' });
        },
        setMode(mode) {
            set({ mode });
        }
    })
);
