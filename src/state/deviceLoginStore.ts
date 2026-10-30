import { create } from 'zustand';

export type PendingDeviceLogin = {
    attemptId: string;
    verificationUrl: string;
    expiresAt: number;
};

interface DeviceLoginState {
    active: boolean;
    pending: PendingDeviceLogin | null;
    begin: () => void;
    setPending: (pending: PendingDeviceLogin) => void;
    clearPending: () => void;
    end: () => void;
}

export const useDeviceLoginStore = create<DeviceLoginState>()((set) => ({
    active: false,
    pending: null,
    begin: () => set({ active: true, pending: null }),
    setPending: (pending) => set({ active: true, pending }),
    clearPending: () => set({ pending: null }),
    end: () => set({ active: false, pending: null })
}));
