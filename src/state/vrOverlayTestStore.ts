import { create } from 'zustand';

interface VrOverlayTestState {
    testMode: boolean;
    pending: boolean;
    setTestMode: (testMode: boolean) => void;
    setPending: (pending: boolean) => void;
}

export const useVrOverlayTestStore = create<VrOverlayTestState>((set) => ({
    testMode: false,
    pending: false,
    setTestMode(testMode) {
        set({ testMode });
    },
    setPending(pending) {
        set({ pending });
    }
}));

export type { VrOverlayTestState };
