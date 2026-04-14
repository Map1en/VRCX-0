import { create } from 'zustand';

export const useNotificationStore = create((set) => ({
    items: [],
    isPanelOpen: false,
    pushNotification(notification) {
        const entry = {
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
            items: state.items.map((item) => (item.id === id ? { ...item, read: true } : item))
        }));
    },
    dismissNotification(id) {
        set((state) => ({
            items: state.items.filter((item) => item.id !== id)
        }));
    },
    setPanelOpen(isPanelOpen) {
        const nextOpen = Boolean(isPanelOpen);
        set((state) => ({
            isPanelOpen: nextOpen,
            items: !nextOpen && state.isPanelOpen
                ? state.items.map((item) => ({ ...item, read: true }))
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
