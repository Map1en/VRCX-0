import { create } from 'zustand';

type GameIsolationCardStore = {
    open: boolean;
    setOpen(open: boolean): void;
};

export const useGameIsolationCardStore = create<GameIsolationCardStore>(
    (set) => ({
        open: false,
        setOpen(open) {
            set({ open });
        }
    })
);
