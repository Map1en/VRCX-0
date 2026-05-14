import { backend } from '@/platform/index.js';
import {
    DEFAULT_THEME_COLOR_KEY,
    THEME_COLOR_CONFIG,
    THEME_COLOR_STYLE_PROPERTIES
} from '@/shared/constants/themes.js';
import { useShellStore } from '@/state/shellStore.js';

type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedThemeMode = 'light' | 'dark';
type AppFontPreferenceInput = {
    fontFamily?: unknown;
    customFontFamily?: unknown;
    cjkFontPack?: unknown;
};

const VALID_THEME_MODES = new Set<ThemeMode>(['light', 'dark', 'system']);
const VALID_THEME_COLORS = new Set<string>(Object.keys(THEME_COLOR_CONFIG));
export const DEFAULT_ZOOM_LEVEL = 100;
export const MIN_ZOOM_LEVEL = 30;
export const MAX_ZOOM_LEVEL = 300;
export const ZOOM_STEP = 5;
const APP_FONT_STYLE_ATTR = 'data-vrcx-app-font';
const APP_CJK_FONT_STYLE_ATTR = 'data-vrcx-cjk-font';

export const APP_FONT_DEFAULT_KEY = 'geist';
export const APP_CJK_FONT_PACK_DEFAULT_KEY = 'noto';

export const APP_FONT_CONFIG = Object.freeze({
    inter: {
        cssName: "'Inter Variable', 'Inter'",
        cssImport:
            "@import url('https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap');"
    },
    noto_sans: {
        cssName: "'Noto Sans'",
        cssImport:
            "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans:ital,wght@0,100..900;1,100..900&display=swap');"
    },
    geist: {
        cssName: "'Geist Variable', 'Geist'",
        cssImport: null
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
        cssImport:
            "@import url('https://fonts.cdnfonts.com/css/fantasque-sans-mono');"
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
        cssImport: null
    },
    puhuiti: {
        cssNames: Object.freeze([
            "'Alibaba PuHuiTi 3.0'",
            "'Alibaba PuHuiTi 2.0'",
            "'Alibaba PuHuiTi'"
        ]),
        cssImport: null
    },
    system: {
        cssNames: Object.freeze(['system-ui']),
        cssImport: null
    }
});

export const APP_FONT_FAMILIES = Object.freeze(Object.keys(APP_FONT_CONFIG));
export const APP_CJK_FONT_PACKS = Object.freeze(
    Object.keys(APP_CJK_FONT_PACK_CONFIG)
);

type AppFontKey = keyof typeof APP_FONT_CONFIG;
type AppCjkFontPackKey = keyof typeof APP_CJK_FONT_PACK_CONFIG;
type ThemeColorStyleToken = keyof typeof THEME_COLOR_STYLE_PROPERTIES;

export function resolveThemeColor(value: unknown): string {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return VALID_THEME_COLORS.has(normalized)
        ? normalized
        : DEFAULT_THEME_COLOR_KEY;
}

export function resolveThemeMode(value: unknown): ThemeMode {
    if (value === 'midnight') {
        return 'dark';
    }

    if (VALID_THEME_MODES.has(value as ThemeMode)) {
        return value as ThemeMode;
    }

    return 'system';
}

export function getResolvedThemeMode(themeMode: unknown): ResolvedThemeMode {
    const normalized = resolveThemeMode(themeMode);
    if (normalized === 'system') {
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
    }

    return normalized;
}

export function normalizeZoomLevel(
    value: unknown,
    fallback = DEFAULT_ZOOM_LEVEL
): number {
    const numericZoom = Number(value);
    if (!Number.isFinite(numericZoom)) {
        return fallback;
    }

    return Math.min(
        MAX_ZOOM_LEVEL,
        Math.max(MIN_ZOOM_LEVEL, Math.trunc(numericZoom))
    );
}

export function formatZoomPercentage(value: unknown): string {
    return `${normalizeZoomLevel(value)}%`;
}

function clearThemeColorProperties(root: HTMLElement): void {
    Object.values(THEME_COLOR_STYLE_PROPERTIES).forEach((propertyName) => {
        root.style.removeProperty(propertyName);
    });
}

export function applyThemeColor(themeColor: unknown): string {
    const normalized = resolveThemeColor(themeColor);
    const theme = THEME_COLOR_CONFIG[normalized];

    if (typeof document === 'undefined') {
        useShellStore.getState().setThemeColor(normalized);
        return normalized;
    }

    const root = document.documentElement;

    root.setAttribute('data-theme-color', normalized);
    clearThemeColorProperties(root);

    if (normalized !== DEFAULT_THEME_COLOR_KEY) {
        Object.entries(THEME_COLOR_STYLE_PROPERTIES).forEach(
            ([tokenName, propertyName]) => {
                const cssValue = theme[tokenName as ThemeColorStyleToken];
                root.style.setProperty(propertyName, cssValue as string);
            }
        );
    }

    useShellStore.getState().setThemeColor(normalized);
    return normalized;
}

function ensureDynamicStyle(
    attrName: string,
    styleKey: string,
    cssText: string | null
): void {
    if (typeof document === 'undefined') {
        return;
    }

    document.querySelectorAll(`style[${attrName}]`).forEach((styleElement) => {
        if (styleElement.getAttribute(attrName) !== styleKey) {
            styleElement.remove();
        }
    });

    if (
        !cssText ||
        document.querySelector(`style[${attrName}="${styleKey}"]`)
    ) {
        return;
    }

    const styleElement = document.createElement('style');
    styleElement.setAttribute(attrName, styleKey);
    styleElement.textContent = cssText;
    document.head.appendChild(styleElement);
}

export function normalizeAppFontFamily(value: unknown): AppFontKey {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return Object.prototype.hasOwnProperty.call(APP_FONT_CONFIG, normalized)
        ? (normalized as AppFontKey)
        : APP_FONT_DEFAULT_KEY;
}

export function normalizeAppCjkFontPack(value: unknown): AppCjkFontPackKey {
    const normalized = String(value || '')
        .trim()
        .toLowerCase();
    return Object.prototype.hasOwnProperty.call(
        APP_CJK_FONT_PACK_CONFIG,
        normalized
    )
        ? (normalized as AppCjkFontPackKey)
        : APP_CJK_FONT_PACK_DEFAULT_KEY;
}

export function applyAppFontPreferences({
    fontFamily = APP_FONT_DEFAULT_KEY,
    customFontFamily = '',
    cjkFontPack = APP_CJK_FONT_PACK_DEFAULT_KEY
}: AppFontPreferenceInput = {}) {
    const normalizedFont = normalizeAppFontFamily(fontFamily);
    const normalizedCjk = normalizeAppCjkFontPack(cjkFontPack);
    const fontConfig = APP_FONT_CONFIG[normalizedFont];
    const cjkConfig = APP_CJK_FONT_PACK_CONFIG[normalizedCjk];
    const westernFont =
        normalizedFont === 'custom'
            ? String(customFontFamily || '').trim() ||
              APP_FONT_CONFIG[APP_FONT_DEFAULT_KEY].cssName
            : fontConfig.cssName;
    const cjkFonts = Array.isArray(cjkConfig.cssNames)
        ? cjkConfig.cssNames
        : [];

    ensureDynamicStyle(
        APP_FONT_STYLE_ATTR,
        normalizedFont,
        fontConfig.cssImport
    );
    ensureDynamicStyle(
        APP_CJK_FONT_STYLE_ATTR,
        normalizedCjk,
        cjkConfig.cssImport
    );

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

export async function syncNativeTheme(themeMode: unknown): Promise<void> {
    const resolvedTheme = getResolvedThemeMode(themeMode);
    const nativeTheme = resolvedTheme === 'dark' ? 1 : 0;

    await backend.app.ChangeTheme(nativeTheme);
}

export async function applyThemeMode(themeMode: unknown): Promise<void> {
    const normalized = resolveThemeMode(themeMode);
    const resolvedTheme = getResolvedThemeMode(normalized);
    const shouldUseDarkClass = resolvedTheme === 'dark';

    document.documentElement.classList.toggle('dark', shouldUseDarkClass);
    document.documentElement.setAttribute('data-theme', resolvedTheme);

    useShellStore.getState().setThemeMode(normalized);
    await syncNativeTheme(normalized);
}

export async function applyZoomLevel(savedZoom: unknown): Promise<void> {
    if (savedZoom === null || savedZoom === undefined) {
        return;
    }

    const numericZoom = normalizeZoomLevel(savedZoom);

    useShellStore.getState().setZoomLevel(numericZoom);
    await backend.webview.setZoom(Math.pow(1.2, numericZoom / 10 - 10));
}
