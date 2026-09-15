import { create } from 'zustand';

type SessionPhase =
    | 'signed_out'
    | 'authenticating'
    | 'authenticated'
    | 'bootstrapping'
    | 'ready';
type BootStatus = 'idle' | 'booting' | 'partial' | 'error';
type TransportStatus =
    | 'disconnected'
    | 'runtime-subscribing'
    | 'runtime-subscribed'
    | 'pipeline-connecting'
    | 'pipeline-connected'
    | 'pipeline-error'
    | 'idle'
    | 'error';

interface SessionState {
    isLoggedIn: boolean;
    isFriendsLoaded: boolean;
    isFavoritesLoaded: boolean;
    databaseReady: boolean;
    sessionPhase: SessionPhase;
    bootStatus: BootStatus;
    transportStatus: TransportStatus;
    setSessionState: (patch: Partial<SessionSnapshot>) => void;
    resetSessionState: () => void;
    setLoggedIn: (value: boolean) => void;
    setFriendsLoaded: (value: boolean) => void;
    setFavoritesLoaded: (value: boolean) => void;
    setSessionPhase: (sessionPhase: SessionPhase) => void;
    setBootStatus: (bootStatus: BootStatus) => void;
    setTransportStatus: (transportStatus: TransportStatus) => void;
}

type SessionSnapshot = Pick<
    SessionState,
    | 'isLoggedIn'
    | 'isFriendsLoaded'
    | 'isFavoritesLoaded'
    | 'databaseReady'
    | 'sessionPhase'
    | 'bootStatus'
    | 'transportStatus'
>;

const initialState: SessionSnapshot = {
    isLoggedIn: false,
    isFriendsLoaded: false,
    isFavoritesLoaded: false,
    databaseReady: false,
    sessionPhase: 'signed_out',
    bootStatus: 'idle',
    transportStatus: 'disconnected'
};

export const useSessionStore = create<SessionState>((set) => ({
    ...initialState,
    setSessionState(patch) {
        set((state) => ({ ...state, ...patch }));
    },
    resetSessionState() {
        set(initialState);
    },
    setLoggedIn(value) {
        set({ isLoggedIn: value });
    },
    setFriendsLoaded(value) {
        set({ isFriendsLoaded: value });
    },
    setFavoritesLoaded(value) {
        set({ isFavoritesLoaded: value });
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
export type { SessionPhase, SessionState };
