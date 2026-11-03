import { create } from 'zustand';

import type { ChatboxStatus } from '@/platform/tauri/bindings';

type ChatboxStore = {
    status: ChatboxStatus | null;
    receivedAt: number;
    setStatus(status: ChatboxStatus): void;
};

export const useChatboxStore = create<ChatboxStore>((set) => ({
    status: null,
    receivedAt: 0,
    setStatus(status) {
        set({ status, receivedAt: Date.now() });
    }
}));
