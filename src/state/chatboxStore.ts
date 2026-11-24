import { create } from 'zustand';

import type {
    ChatboxConfig,
    ChatboxStatus,
    HeartRateStatus
} from '@/platform/tauri/bindings';

type ChatboxStore = {
    status: ChatboxStatus | null;
    receivedAt: number;
    savedConfig: ChatboxConfig | null;
    heartRate: HeartRateStatus | null;
    setStatus(status: ChatboxStatus): void;
    setSavedConfig(config: ChatboxConfig): void;
    setHeartRate(status: HeartRateStatus): void;
};

export const useChatboxStore = create<ChatboxStore>((set) => ({
    status: null,
    receivedAt: 0,
    savedConfig: null,
    heartRate: null,
    setStatus(status) {
        set({ status, receivedAt: Date.now() });
    },
    setSavedConfig(savedConfig) {
        set({ savedConfig });
    },
    setHeartRate(heartRate) {
        set({ heartRate });
    }
}));
