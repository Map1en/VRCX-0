import { create } from 'zustand';

const initialState = {
    isLoggedIn: false,
    isFriendsLoaded: false,
    isFavoritesLoaded: false,
    databaseReady: false,
    sessionPhase: 'signed_out',
    bootStatus: 'idle',
    transportStatus: 'disconnected'
};

export const useSessionStore = create((set) => ({
    ...initialState,
    setSessionState(patch) {
        set((state) => ({ ...state, ...patch }));
    },
    resetSessionState() {
        set(initialState);
    },
    setLoggedIn(value) {
        set({ isLoggedIn: Boolean(value) });
    },
    setFriendsLoaded(value) {
        set({ isFriendsLoaded: Boolean(value) });
    },
    setFavoritesLoaded(value) {
        set({ isFavoritesLoaded: Boolean(value) });
    },
    setSessionPhase(sessionPhase) {
        set({ sessionPhase });
    },
    setBootStatus(bootStatus) {
        set({ bootStatus });
    },
    setTransportStatus(transportStatus) {
        set({ transportStatus });
    }
}));
