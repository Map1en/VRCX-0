import { backend } from '@/platform/index.js';
import { useShellStore } from '@/state/shellStore.js';

const VALID_THEME_MODES = new Set(['light', 'dark', 'midnight', 'system']);
const DEFAULT_ZOOM_LEVEL = 100;
const MIN_ZOOM_LEVEL = 30;
const MAX_ZOOM_LEVEL = 300;
const APP_FONT_STYLE_ATTR = 'data-vrcx-app-font';
const APP_CJK_FONT_STYLE_ATTR = 'data-vrcx-cjk-font';

export const APP_FONT_DEFAULT_KEY = 'inter';
export const APP_CJK_FONT_PACK_DEFAULT_KEY = 'noto';

export const APP_FONT_CONFIG = Object.freeze({
    inter: {
        cssName: "'Inter Variable', 'Inter'",
        cssImport:
            "@import url('https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,100..900&display=swap');"
    },
    noto_sans: {
        cssName: "'Noto Sans'",
        cssImport:
            "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,100..900;1,100..900&display=swap');"
    },
    geist: {
        cssName: "'Geist'",
        cssImport:
            "@import url('https://fonts.googleapis.com/css2?family=Geist:wght@100..900&display=swap');"
    },
    nunito_sans: {
        cssName: "'Nunito Sans'",
        cssImport:
            "@import url('https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,opsz,wght@0,6..12,200..1000;1,6..12,200..1000&display=swap');"
    },
    ibm_plex_sans: {
        cssName: "'IBM Plex Sans'",
        cssImport:
            "@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:ital,wght@0,100..700;1,100..700&display=swap');"
    },
    jetbrains_mono: {
        cssName: "'JetBrains Mono'",
        cssImport:
            "@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,100..800&display=swap');"
    },
    fantasque_sans_mono: {
        cssName: "'Fantasque Sans Mono'",
        cssImport: "@import url('https://fonts.cdnfonts.com/css/fantasque-sans-mono');"
    },
    system_ui: {
        cssName: 'system-ui',
        cssImport: null
    },
    custom: {
        cssName: '',
        cssImport: null
    }
});

export const APP_CJK_FONT_PACK_CONFIG = Object.freeze({
    noto: {
        cssNames: Object.freeze([
            "'Noto Sans SC Variable'",
            "'Noto Sans SC'",
            "'Noto Sans TC Variable'",
            "'Noto Sans TC'",
            "'Noto Sans JP Variable'",
            "'Noto Sans JP'",
            "'Noto Sans KR Variable'",
            "'Noto Sans KR'"
        ]),
        cssImport: [
            "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@100..900&display=swap');",
            "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@100..900&display=swap');",
            "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&display=swap');",
            "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@100..900&display=swap');"
        ].join('\n')
    },
    puhuiti: {
        cssNames: Object.freeze(["'Alibaba PuHuiTi 3.0'", "'Alibaba PuHuiTi 2.0'", "'Alibaba PuHuiTi'"]),
        cssImport: null
    },
    system: {
        cssNames: Object.freeze(['system-ui']),
        cssImport: null
    }
});

export const APP_FONT_FAMILIES = Object.freeze(Object.keys(APP_FONT_CONFIG));
export const APP_CJK_FONT_PACKS = Object.freeze(Object.keys(APP_CJK_FONT_PACK_CONFIG));

export function resolveThemeMode(value) {
    if (VALID_THEME_MODES.has(value)) {
        return value;
    }

    return 'system';
}

export function getResolvedThemeMode(themeMode) {
    const normalized = resolveThemeMode(themeMode);
    if (normalized === 'system') {
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    return normalized;
}

export function normalizeZoomLevel(value, fallback = DEFAULT_ZOOM_LEVEL) {
    const numericZoom = Number(value);
    if (!Number.isFinite(numericZoom)) {
        return fallback;
    }

    return Math.min(MAX_ZOOM_LEVEL, Math.max(MIN_ZOOM_LEVEL, Math.trunc(numericZoom)));
}

export function formatZoomPercentage(value) {
    return `${normalizeZoomLevel(value)}%`;
}

function ensureDynamicStyle(attrName, styleKey, cssText) {
    if (typeof document === 'undefined') {
        return;
    }

    document.querySelectorAll(`style[${attrName}]`).forEach((styleElement) => {
        if (styleElement.getAttribute(attrName) !== styleKey) {
            styleElement.remove();
        }
    });

    if (!cssText || document.querySelector(`style[${attrName}="${styleKey}"]`)) {
        return;
    }

    const styleElement = document.createElement('style');
    styleElement.setAttribute(attrName, styleKey);
    styleElement.textContent = cssText;
    document.head.appendChild(styleElement);
}

export function normalizeAppFontFamily(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return APP_FONT_CONFIG[normalized] ? normalized : APP_FONT_DEFAULT_KEY;
}

export function normalizeAppCjkFontPack(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return APP_CJK_FONT_PACK_CONFIG[normalized] ? normalized : APP_CJK_FONT_PACK_DEFAULT_KEY;
}

export function applyAppFontPreferences({
    fontFamily = APP_FONT_DEFAULT_KEY,
    customFontFamily = '',
    cjkFontPack = APP_CJK_FONT_PACK_DEFAULT_KEY
} = {}) {
    const normalizedFont = normalizeAppFontFamily(fontFamily);
    const normalizedCjk = normalizeAppCjkFontPack(cjkFontPack);
    const fontConfig = APP_FONT_CONFIG[normalizedFont];
    const cjkConfig = APP_CJK_FONT_PACK_CONFIG[normalizedCjk];
    const westernFont =
        normalizedFont === 'custom'
            ? String(customFontFamily || '').trim() || APP_FONT_CONFIG[APP_FONT_DEFAULT_KEY].cssName
            : fontConfig.cssName;
    const cjkFonts = Array.isArray(cjkConfig.cssNames) ? cjkConfig.cssNames : [];

    ensureDynamicStyle(APP_FONT_STYLE_ATTR, normalizedFont, fontConfig.cssImport);
    ensureDynamicStyle(APP_CJK_FONT_STYLE_ATTR, normalizedCjk, cjkConfig.cssImport);

    document.documentElement.style.setProperty(
        '--vrcx-app-font-family',
        [westernFont, ...cjkFonts, 'system-ui'].filter(Boolean).join(', ')
    );

    return {
        fontFamily: normalizedFont,
        customFontFamily,
        cjkFontPack: normalizedCjk
    };
}

export async function syncNativeTheme(themeMode) {
    const resolvedTheme = getResolvedThemeMode(themeMode);
    const nativeTheme =
        resolvedTheme === 'midnight' ? 2 : resolvedTheme === 'dark' ? 1 : 0;

    await backend.app.ChangeTheme(nativeTheme);
}

export async function applyThemeMode(themeMode) {
    const normalized = resolveThemeMode(themeMode);
    const resolvedTheme = getResolvedThemeMode(normalized);
    const shouldUseDarkClass = resolvedTheme === 'dark' || resolvedTheme === 'midnight';

    document.documentElement.classList.toggle('dark', shouldUseDarkClass);
    document.documentElement.setAttribute('data-theme', resolvedTheme);

    useShellStore.getState().setThemeMode(normalized);
    await syncNativeTheme(normalized);
}

export async function applyZoomLevel(savedZoom) {
    if (savedZoom === null || savedZoom === undefined) {
        return;
    }

    const numericZoom = normalizeZoomLevel(savedZoom);

    useShellStore.getState().setZoomLevel(numericZoom);
    await backend.webview.setZoom(Math.pow(1.2, numericZoom / 10 - 10));
}
