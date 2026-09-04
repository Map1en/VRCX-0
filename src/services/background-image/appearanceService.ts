import type { BackgroundImageSnapshot } from '@/platform/tauri/bindings';
import { APP_THEME_CONFIG_KEYS } from '@/repositories/configKeys';
import configRepository from '@/repositories/configRepository';
import { useBackgroundImageStore } from '@/state/backgroundImageStore';
import {
    communityThemeControlsAppearance,
    useCommunityThemeStore
} from '@/state/communityThemeStore';

import {
    applyThemeColor,
    resolveThemeColor,
    resolveThemeMode,
    setCommunityThemeAppearanceControl
} from '../themeService';
import {
    type VrcxCssLayer,
    setVrcxCssLayer,
    setVrcxCssLayersSuppressed
} from '../vrcx0CssLayerService';

const BACKGROUND_IMAGE_LAYER = 'background-image';
const BACKGROUND_IMAGE_TRANSITION_LAYER_SELECTOR =
    '.vrcx-0-background-image-transition-layer';
const BACKGROUND_IMAGE_TRANSITION_ACTIVE_ATTR = 'data-active';
const BACKGROUND_IMAGE_TRANSITION_DURATION_MS = 280;
const BACKGROUND_IMAGE_PRELOAD_TIMEOUT_MS = 3000;
const COMMUNITY_CSS_LAYERS: VrcxCssLayer[] = [
    'installed-theme',
    'local-theme-preview'
];
let appliedImageUrl: string | null = null;
let transitionGeneration = 0;
let pendingTransition:
    | {
          imageUrl: string;
          promise: Promise<void>;
      }
    | undefined;

function toCssString(value: string): string {
    return `"${value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\A ')}"`;
}

export function buildBackgroundImageCss(
    snapshot: Pick<BackgroundImageSnapshot, 'imageUrl'>,
    opaqueBase = false
): string {
    return `:root {
  --vrcx-0-wallpaper-image: url(${toCssString(snapshot.imageUrl)});
  --vrcx-0-wallpaper-size: cover;
  --vrcx-0-wallpaper-position: center;
  --vrcx-0-wallpaper-repeat: no-repeat;
  --vrcx-0-wallpaper-opacity: 1;
  --vrcx-0-wallpaper-filter: saturate(1.08) contrast(0.96);
  --surface-shell: color-mix(in oklch, var(--background) 38%, transparent);
  --surface-panel: color-mix(in oklch, var(--background) 46%, transparent);
  --surface-raised: color-mix(in oklch, var(--background) 52%, transparent);
  --vrcx-0-app-surface: ${opaqueBase ? 'var(--background)' : 'transparent'};
  --vrcx-0-titlebar-surface: color-mix(in oklch, var(--background) 38%, transparent);
  --vrcx-0-main-surface: transparent;
  --vrcx-0-main-content-surface: color-mix(in oklch, var(--background) 20%, transparent);
  --vrcx-0-sidebar-surface: color-mix(in oklch, var(--sidebar) 40%, transparent);
  --vrcx-0-sidebar-inset-surface: color-mix(in oklch, var(--background) 22%, transparent);
  --vrcx-0-side-panel-surface: color-mix(in oklch, var(--background) 38%, transparent);
  --vrcx-0-statusbar-surface: color-mix(in oklch, var(--background) 36%, transparent);
  --vrcx-0-table-surface: color-mix(in oklch, var(--background) 46%, transparent);
  --vrcx-0-table-header-surface: color-mix(in oklch, var(--background) 52%, transparent);
}

[data-slot='dialog-content'],
[data-slot='popover-content'] {
  background: color-mix(in oklch, var(--popover) 56%, transparent);
  backdrop-filter: blur(18px) saturate(1.05);
}

[data-slot='dialog-footer'],
[data-slot='card-footer'] {
  background: color-mix(in oklch, var(--background) 34%, transparent);
}

[data-slot='card'] {
  background: color-mix(in oklch, var(--card) 46%, transparent);
  backdrop-filter: blur(14px) saturate(1.03);
}
`;
}

function getBackgroundImageTransitionLayer(): HTMLElement | null {
    if (typeof document === 'undefined') {
        return null;
    }
    return document.querySelector<HTMLElement>(
        BACKGROUND_IMAGE_TRANSITION_LAYER_SELECTOR
    );
}

function reduceBackgroundImageMotion(): boolean {
    if (typeof document === 'undefined') {
        return true;
    }
    if (document.documentElement.classList.contains('reduce-effects')) {
        return true;
    }
    return (
        typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
}

function resetBackgroundImageTransitionLayer(
    transitionLayer: HTMLElement
): void {
    transitionLayer.style.transition = 'none';
    transitionLayer.removeAttribute(BACKGROUND_IMAGE_TRANSITION_ACTIVE_ATTR);
    transitionLayer.style.backgroundImage = '';
    void transitionLayer.offsetWidth;
    transitionLayer.style.removeProperty('transition');
}

async function preloadBackgroundImage(imageUrl: string): Promise<void> {
    if (typeof Image === 'undefined' || typeof window === 'undefined') {
        return;
    }

    await new Promise<void>((resolve) => {
        const image = new Image();
        let settled = false;
        const timeoutId = window.setTimeout(
            finish,
            BACKGROUND_IMAGE_PRELOAD_TIMEOUT_MS
        );

        function finish(): void {
            if (settled) {
                return;
            }
            settled = true;
            window.clearTimeout(timeoutId);
            image.onload = null;
            image.onerror = null;
            resolve();
        }

        image.onload = finish;
        image.onerror = finish;
        image.src = imageUrl;
        if (image.complete) {
            finish();
        }
    });
}

function waitForBackgroundImageTransition(): Promise<void> {
    return new Promise((resolve) => {
        window.setTimeout(resolve, BACKGROUND_IMAGE_TRANSITION_DURATION_MS);
    });
}

async function applyBackgroundImageSnapshot(
    snapshot: Pick<BackgroundImageSnapshot, 'imageUrl'>,
    generation: number,
    opaqueBase: boolean
): Promise<void> {
    const cssText = buildBackgroundImageCss(snapshot, opaqueBase);
    const transitionLayer = getBackgroundImageTransitionLayer();
    if (
        appliedImageUrl === null ||
        transitionLayer === null ||
        reduceBackgroundImageMotion()
    ) {
        setVrcxCssLayer(BACKGROUND_IMAGE_LAYER, cssText);
        appliedImageUrl = snapshot.imageUrl;
        if (transitionLayer) {
            resetBackgroundImageTransitionLayer(transitionLayer);
        }
        return;
    }

    await preloadBackgroundImage(snapshot.imageUrl);
    if (generation !== transitionGeneration) {
        return;
    }

    resetBackgroundImageTransitionLayer(transitionLayer);
    transitionLayer.style.backgroundImage = `url(${toCssString(snapshot.imageUrl)})`;
    void transitionLayer.offsetWidth;
    transitionLayer.setAttribute(BACKGROUND_IMAGE_TRANSITION_ACTIVE_ATTR, '');
    await waitForBackgroundImageTransition();
    if (generation !== transitionGeneration) {
        return;
    }

    setVrcxCssLayer(BACKGROUND_IMAGE_LAYER, cssText);
    appliedImageUrl = snapshot.imageUrl;
    resetBackgroundImageTransitionLayer(transitionLayer);
}

function transitionToBackgroundImage(
    snapshot: Pick<BackgroundImageSnapshot, 'imageUrl'>,
    opaqueBase: boolean
): Promise<void> {
    if (appliedImageUrl === snapshot.imageUrl) {
        return Promise.resolve();
    }
    if (pendingTransition?.imageUrl === snapshot.imageUrl) {
        return pendingTransition.promise;
    }

    transitionGeneration += 1;
    const generation = transitionGeneration;
    const promise = applyBackgroundImageSnapshot(
        snapshot,
        generation,
        opaqueBase
    ).finally(() => {
        if (pendingTransition?.promise === promise) {
            pendingTransition = undefined;
        }
    });
    pendingTransition = {
        imageUrl: snapshot.imageUrl,
        promise
    };
    return promise;
}

function clearBackgroundImageAppearance(): void {
    transitionGeneration += 1;
    pendingTransition = undefined;
    appliedImageUrl = null;
    const transitionLayer = getBackgroundImageTransitionLayer();
    if (transitionLayer) {
        resetBackgroundImageTransitionLayer(transitionLayer);
    }
    setVrcxCssLayer(BACKGROUND_IMAGE_LAYER, '');
}

async function applySavedThemeMode(): Promise<void> {
    const savedThemeMode = await configRepository.getString(
        APP_THEME_CONFIG_KEYS.themeMode,
        'system'
    );
    await setCommunityThemeAppearanceControl(
        false,
        resolveThemeMode(savedThemeMode)
    );
}

async function applySavedThemeColor(): Promise<void> {
    const savedThemeColor = await configRepository.getString(
        APP_THEME_CONFIG_KEYS.themeColor,
        'default'
    );
    applyThemeColor(resolveThemeColor(savedThemeColor));
}

export function isCommunityAppearanceActive(): boolean {
    const state = useCommunityThemeStore.getState();
    return communityThemeControlsAppearance(
        state.enabled,
        state.installedTheme,
        state.localPreview
    );
}

export async function syncBackgroundImageAppearance(
    restoreAppTheme = true
): Promise<void> {
    const state = useBackgroundImageStore.getState();
    const suppressCommunityLayers = state.enabled;
    const source = state.decorationImageUrl
        ? { imageUrl: state.decorationImageUrl }
        : state.snapshot;
    const isDecoration = Boolean(state.decorationImageUrl);
    const shouldApply = state.enabled && source !== null;
    if (shouldApply && source) {
        await transitionToBackgroundImage(source, isDecoration);
    } else {
        clearBackgroundImageAppearance();
    }
    setVrcxCssLayersSuppressed(COMMUNITY_CSS_LAYERS, suppressCommunityLayers);

    if (shouldApply) {
        await setCommunityThemeAppearanceControl(true);
        return;
    }

    if (restoreAppTheme && !isCommunityAppearanceActive()) {
        await applySavedThemeMode();
        await applySavedThemeColor();
    }
}
