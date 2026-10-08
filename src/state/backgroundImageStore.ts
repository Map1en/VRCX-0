import { create } from 'zustand';

import type {
    BackgroundImageCustomSource,
    BackgroundImageMode,
    BackgroundImageProviderId,
    BackgroundImageSnapshot
} from '@/platform/tauri/bindings';

export type BackgroundImageScrim = 'subtle' | 'balanced' | 'clear';

interface BackgroundImageStore {
    mode: BackgroundImageMode;
    enabled: boolean;
    providerId: BackgroundImageProviderId;
    customSource: BackgroundImageCustomSource | null;
    decorationImageUrl: string;
    scrim: BackgroundImageScrim;
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
    setScrim(scrim: BackgroundImageScrim): void;
    setLoading(loading: boolean): void;
    setError(error: string | null): void;
}

export const useBackgroundImageStore = create<BackgroundImageStore>((set) => ({
    mode: 'off',
    enabled: false,
    providerId: 'nasa-epic',
    customSource: null,
    decorationImageUrl: '',
    scrim: 'balanced',
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
    setScrim(scrim) {
        set({ scrim });
    },
    setLoading(loading) {
        set({ loading });
    },
    setError(error) {
        set({ error });
    }
}));
