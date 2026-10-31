import { create } from 'zustand';

type SettingsHighlightStore = {
    settingId: string | null;
    setHighlightedSetting(settingId: string | null): void;
};

export const useSettingsHighlightStore = create<SettingsHighlightStore>(
    (set) => ({
        settingId: null,
        setHighlightedSetting(settingId) {
            set({ settingId });
        }
    })
);
