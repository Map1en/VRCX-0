import { create } from 'zustand';

import type {
    BackgroundImageCustomSource,
    BackgroundImageMode,
    BackgroundImageProviderId,
    BackgroundImageSnapshot
} from '@/platform/tauri/bindings';

interface BackgroundImageStore {
    mode: BackgroundImageMode;
    enabled: boolean;
    providerId: BackgroundImageProviderId;
    customSource: BackgroundImageCustomSource | null;
    decorationImageUrl: string;
    snapshot: BackgroundImageSnapshot | null;
    loading: boolean;
    error: string | null;
    applyProjection(options: {
        mode: BackgroundImageMode;
        enabled: boolean;
        providerId: BackgroundImageProviderId;
        customSource: BackgroundImageCustomSource | null;
        snapshot: BackgroundImageSnapshot | null;
        error: string | null;
    }): void;
    setDecorationImageUrl(imageUrl: string): void;
    setLoading(loading: boolean): void;
    setError(error: string | null): void;
}

export const useBackgroundImageStore = create<BackgroundImageStore>((set) => ({
    mode: 'off',
    enabled: false,
    providerId: 'nasa-epic',
    customSource: null,
    decorationImageUrl: '',
    snapshot: null,
    loading: false,
    error: null,
    applyProjection(options) {
        set(options);
    },
    setDecorationImageUrl(decorationImageUrl) {
        set({
            decorationImageUrl,
            enabled: Boolean(decorationImageUrl),
            mode: 'off',
            snapshot: null,
            error: null
        });
    },
    setLoading(loading) {
        set({ loading });
    },
    setError(error) {
        set({ error });
    }
}));
