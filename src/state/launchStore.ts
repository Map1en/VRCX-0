import { create } from 'zustand';

interface LaunchCreatedInstance {
    location: string;
    shortName: string;
    secureOrShortName: string;
    accessType: string;
    ownerId: string;
    groupId: string;
    group: unknown;
    url: string;
}

interface LaunchDialogState {
    open: boolean;
    loading: boolean;
    tag: string;
    shortName: string;
    launchToken: string;
    createdInstance: LaunchCreatedInstance | null;
    worldName: string;
}

interface LaunchDialogOptions {
    createdInstance?: LaunchCreatedInstance | null;
    worldName?: string;
}

interface LaunchStoreState {
    launchDialog: LaunchDialogState;
    showLaunchDialog: (
        tag: string,
        shortName?: string,
        launchToken?: string,
        options?: LaunchDialogOptions
    ) => void;
    closeLaunchDialog: () => void;
    setLaunchDialogOpen: (open: boolean) => void;
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

export const useLaunchStore = create<LaunchStoreState>((set) => ({
    launchDialog: emptyLaunchDialog,
    showLaunchDialog(tag, shortName = '', launchToken = '', options = {}) {
        set({
            launchDialog: {
                open: true,
                loading: true,
                tag: tag.trim(),
                shortName: shortName.trim(),
                launchToken: launchToken.trim(),
                createdInstance: options?.createdInstance || null,
                worldName: options.worldName?.trim() ?? ''
            }
        });
        queueMicrotask(() => {
            set((state) => ({
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
    setLaunchDialogOpen(open) {
        set((state) => ({
            launchDialog: open
                ? {
                      ...state.launchDialog,
                      open: true
                  }
                : emptyLaunchDialog
        }));
    }
}));
export type { LaunchCreatedInstance, LaunchStoreState };
