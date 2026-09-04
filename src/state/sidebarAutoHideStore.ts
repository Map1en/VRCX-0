import { create } from 'zustand';

export const useSidebarAutoHideStore = create<{
    enabled: boolean;
    failed: boolean;
    hydrated: boolean;
}>(() => ({ enabled: false, failed: false, hydrated: false }));
