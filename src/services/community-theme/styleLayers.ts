import { convertFileSrc } from '@/platform/tauri/assets';

import { setVrcxCssLayers } from '../vrcx0CssLayerService';

const INSTALLED_THEME_LAYER = 'installed-theme';
const LOCAL_PREVIEW_LAYER = 'local-theme-preview';
const USER_OVERRIDE_LAYER = 'user-override';
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;

let installedThemeCssSnapshot = '';
let localPreviewCssSnapshot = '';
let overrideCssSnapshot = '';
let overrideCssEnabled = false;

export function syncCommunityStyleLayers(): void {
    setVrcxCssLayers({
        [INSTALLED_THEME_LAYER]: installedThemeCssSnapshot,
        [LOCAL_PREVIEW_LAYER]: localPreviewCssSnapshot,
        [USER_OVERRIDE_LAYER]: overrideCssEnabled ? overrideCssSnapshot : ''
    });
}

export function getInstalledThemeCssSnapshot(): string {
    return installedThemeCssSnapshot;
}

export function setInstalledThemeCssSnapshot(cssText: string): void {
    installedThemeCssSnapshot = cssText;
}

export function setLocalPreviewCssSnapshot(cssText: string): void {
    localPreviewCssSnapshot = cssText;
}

export function setCommunityThemeOverrideCssSnapshot(
    cssText: string,
    enabled: boolean
): void {
    overrideCssSnapshot = cssText;
    overrideCssEnabled = enabled;
}

export function getCommunityThemeOverrideCssSnapshot(): string {
    return overrideCssSnapshot;
}

function shouldRewriteCssUrl(url: string): boolean {
    if (!url || url.startsWith('#')) {
        return false;
    }
    return !/^(?:[a-z][a-z0-9+.-]*:|\/|\\\\)/i.test(url);
}

export function rewriteLocalThemeAssetUrls(
    cssText: string,
    cssPath: string,
    cacheKey?: string
): string {
    const baseCssUrl = convertFileSrc(cssPath);
    return cssText.replace(
        CSS_URL_PATTERN,
        (match: string, quote: string, rawUrl: string) => {
            const url = String(rawUrl || '').trim();
            if (!shouldRewriteCssUrl(url)) {
                return match;
            }

            try {
                const resolvedUrl = new URL(url, baseCssUrl);
                if (cacheKey) {
                    resolvedUrl.searchParams.set('vrcx0ThemePreview', cacheKey);
                }
                const nextQuote = quote || '"';
                return `url(${nextQuote}${resolvedUrl.toString()}${nextQuote})`;
            } catch {
                return match;
            }
        }
    );
}
