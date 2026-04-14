import { create } from 'zustand';

const emptyLaunchDialog = {
    open: false,
    loading: false,
    tag: '',
    shortName: '',
    launchToken: '',
    createdInstance: null,
    worldName: ''
};

export const useLaunchStore = create((set) => ({
    launchDialog: emptyLaunchDialog,
    showLaunchDialog(tag, shortName = '', launchToken = '', options = {}) {
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
