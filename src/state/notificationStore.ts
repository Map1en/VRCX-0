import { create } from 'zustand';

import type { RuntimeNotificationLevel } from '@/platform/tauri/bindings';

type NotificationLevel = RuntimeNotificationLevel | 'success';

interface NotificationEntry {
    id: string;
    createdAt: string;
    level: NotificationLevel;
    title: string;
    message: string;
    read: boolean;
    [key: string]: unknown;
}

type NotificationInput = Partial<NotificationEntry> & Record<string, unknown>;

interface NotificationStoreState {
    items: NotificationEntry[];
    isPanelOpen: boolean;
    pushNotification: (notification: NotificationInput) => void;
    markAllRead: () => void;
    markNotificationRead: (id: string) => void;
    dismissNotification: (id: string) => void;
    setPanelOpen: (isPanelOpen: boolean) => void;
    resetNotificationState: () => void;
}

export const useNotificationStore = create<NotificationStoreState>((set) => ({
    items: [],
    isPanelOpen: false,
    pushNotification(notification) {
        const entry: NotificationEntry = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            createdAt: new Date().toISOString(),
            level: 'info',
            title: '',
            message: '',
            read: false,
            ...notification
        };

        set((state) => ({
            items: [entry, ...state.items].slice(0, 50)
        }));
    },
    markAllRead() {
        set((state) => ({
            items: state.items.map((item) => ({ ...item, read: true }))
        }));
    },
    markNotificationRead(id) {
        set((state) => ({
            items: state.items.map((item) =>
                item.id === id ? { ...item, read: true } : item
            )
        }));
    },
    dismissNotification(id) {
        set((state) => ({
            items: state.items.filter((item) => item.id !== id)
        }));
    },
    setPanelOpen(isPanelOpen) {
        set((state) => ({
            isPanelOpen,
            items:
                !isPanelOpen && state.isPanelOpen
                    ? state.items.map((item) => ({
                          ...item,
                          read: true
                      }))
                    : state.items
        }));
    },
    resetNotificationState() {
        set({
            items: [],
            isPanelOpen: false
        });
    }
}));
export type { NotificationStoreState };
