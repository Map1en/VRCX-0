import { create } from 'zustand';

import type { GameLogPreviousInstanceWorldRow } from '@/repositories/gameLogRepository';

export type PreviousInstancesDialogRow =
    Partial<GameLogPreviousInstanceWorldRow> & {
        createdAt?: string;
        worldId?: string;
    };

interface PreviousInstancesDialogState {
    open: boolean;
    title: string;
    rows: PreviousInstancesDialogRow[];
    detailsOnly: boolean;
}

interface PreviousInstancesDialogStoreState {
    dialog: PreviousInstancesDialogState;
    showPreviousInstancesDialog(
        dialog: Omit<PreviousInstancesDialogState, 'open'>
    ): void;
    setPreviousInstancesDialogRows(rows: PreviousInstancesDialogRow[]): void;
    setPreviousInstancesDialogOpen(open: boolean): void;
}

const closedDialog: PreviousInstancesDialogState = {
    open: false,
    title: '',
    rows: [],
    detailsOnly: false
};

export const usePreviousInstancesDialogStore =
    create<PreviousInstancesDialogStoreState>((set) => ({
        dialog: closedDialog,
        showPreviousInstancesDialog(dialog) {
            set({ dialog: { ...dialog, open: true } });
        },
        setPreviousInstancesDialogRows(rows) {
            set((state) => ({ dialog: { ...state.dialog, rows } }));
        },
        setPreviousInstancesDialogOpen(open) {
            set((state) => ({
                dialog: open ? { ...state.dialog, open } : closedDialog
            }));
        }
    }));
