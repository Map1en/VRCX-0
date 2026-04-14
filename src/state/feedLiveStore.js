import { create } from 'zustand';

const initialState = {
    version: 0,
    entries: []
};

export const useFeedLiveStore = create((set) => ({
    ...initialState,
    pushEntry(entry, { ownerUserId = '' } = {}) {
        if (!entry || typeof entry !== 'object') {
            return;
        }
        set((state) => ({
            version: state.version + 1,
            entries: [
                ...state.entries,
                {
                    sequence: state.version + 1,
                    ownerUserId,
                    entry: { ...entry, ownerUserId }
                }
            ].slice(-100)
        }));
    },
    resetFeedLive() {
        set(initialState);
    }
}));
