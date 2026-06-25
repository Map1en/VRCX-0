import { create } from 'zustand';

interface LaunchDialogState {
    open: boolean;
    loading: boolean;
    tag: string;
    shortName: string;
    launchToken: string;
    createdInstance: unknown;
    worldName: string;
}

interface LaunchDialogOptions {
    createdInstance?: unknown;
    worldName?: unknown;
}

interface LaunchStoreState {
    launchDialog: LaunchDialogState;
    showLaunchDialog: (
        tag: unknown,
        shortName?: unknown,
        launchToken?: unknown,
        options?: LaunchDialogOptions
    ) => void;
    closeLaunchDialog: () => void;
    setLaunchDialogOpen: (open: unknown) => void;
}

const emptyLaunchDialog: LaunchDialogState = {
    open: false,
    loading: false,
    tag: '',
    shortName: '',
    launchToken: '',
    createdInstance: null,
    worldName: ''
};

export const useLaunchStore = create<LaunchStoreState>((set: any) => ({
    launchDialog: emptyLaunchDialog,
    showLaunchDialog(
        tag: any,
        shortName: any = '',
        launchToken: any = '',
        options: any = {}
    ) {
        set({
            launchDialog: {
                open: true,
                loading: true,
                tag: String(tag || '').trim(),
                shortName: String(shortName || '').trim(),
                launchToken: String(launchToken || '').trim(),
                createdInstance: options?.createdInstance || null,
                worldName: String(options?.worldName || '').trim()
            }
        });
        queueMicrotask(() => {
            set((state: any) => ({
                launchDialog: {
                    ...state.launchDialog,
                    loading: false
                }
            }));
        });
    },
    closeLaunchDialog() {
        set({ launchDialog: emptyLaunchDialog });
    },
    setLaunchDialogOpen(open: any) {
        set((state: any) => ({
            launchDialog: open
                ? {
                      ...state.launchDialog,
                      open: true
                  }
                : emptyLaunchDialog
        }));
    }
}));
export type { LaunchDialogOptions, LaunchDialogState, LaunchStoreState };
