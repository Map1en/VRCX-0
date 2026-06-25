import { create } from 'zustand';

type NotificationLevel = 'info' | 'success' | 'warning' | 'error' | string;

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
    setPanelOpen: (isPanelOpen: unknown) => void;
    resetNotificationState: () => void;
}

export const useNotificationStore = create<NotificationStoreState>(
    (set: any) => ({
        items: [],
        isPanelOpen: false,
        pushNotification(notification: any) {
            const entry: any = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                createdAt: new Date().toISOString(),
                level: 'info',
                title: '',
                message: '',
                read: false,
                ...notification
            };

            set((state: any) => ({
                items: [entry, ...state.items].slice(0, 50)
            }));
        },
        markAllRead() {
            set((state: any) => ({
                items: state.items.map((item: any) => ({ ...item, read: true }))
            }));
        },
        markNotificationRead(id: any) {
            set((state: any) => ({
                items: state.items.map((item: any) =>
                    item.id === id ? { ...item, read: true } : item
                )
            }));
        },
        dismissNotification(id: any) {
            set((state: any) => ({
                items: state.items.filter((item: any) => item.id !== id)
            }));
        },
        setPanelOpen(isPanelOpen: any) {
            const nextOpen = Boolean(isPanelOpen);
            set((state: any) => ({
                isPanelOpen: nextOpen,
                items:
                    !nextOpen && state.isPanelOpen
                        ? state.items.map((item: any) => ({
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
    })
);
export type { NotificationEntry, NotificationInput, NotificationStoreState };
