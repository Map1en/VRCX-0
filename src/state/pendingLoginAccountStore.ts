import { create } from 'zustand';

import type { SavedCredentialRecord } from '@/repositories/authRepository';

export type PendingLoginAccount = {
    account: SavedCredentialRecord;
    reason: 'switch' | 'expired';
};

interface PendingLoginAccountState {
    pending: PendingLoginAccount | null;
    request: (pending: PendingLoginAccount) => void;
    take: () => PendingLoginAccount | null;
    clear: () => void;
}

export const usePendingLoginAccountStore = create<PendingLoginAccountState>()(
    (set, get) => ({
        pending: null,
        request: (pending) => set({ pending }),
        take: () => {
            const { pending } = get();
            if (pending) {
                set({ pending: null });
            }
            return pending;
        },
        clear: () => set({ pending: null })
    })
);
