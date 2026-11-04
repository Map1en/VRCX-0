import { create } from 'zustand';

import type { ChatboxConfig, ChatboxStatus } from '@/platform/tauri/bindings';

type ChatboxStore = {
    status: ChatboxStatus | null;
    receivedAt: number;
    savedConfig: ChatboxConfig | null;
    setStatus(status: ChatboxStatus): void;
    setSavedConfig(config: ChatboxConfig): void;
};

export const useChatboxStore = create<ChatboxStore>((set) => ({
    status: null,
    receivedAt: 0,
    savedConfig: null,
    setStatus(status) {
        set({ status, receivedAt: Date.now() });
    },
    setSavedConfig(savedConfig) {
        set({ savedConfig });
    }
}));
