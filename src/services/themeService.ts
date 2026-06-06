import { tauriClient } from '@/platform/tauri/client';
import {
    DEFAULT_THEME_COLOR_KEY,
    THEME_COLOR_CONFIG,
    THEME_COLOR_STYLE_PROPERTIES
} from '@/shared/constants/themes';
import { useShellStore } from '@/state/shellStore';

type ThemeMode = 'light' | 'dark' | 'system';
type ResolvedThemeMode = 'light' | 'dark';
type AppFontPreferenceInput = {
    fontFamily?: unknown;
    customFontFamily?: unknown;
    cjkFontPack?: unknown;
    locale?: unknown;
};

const VALID_THEME_MODES = new Set<ThemeMode>(['light', 'dark', 'system']);
const VALID_THEME_COLORS = new Set<string>(Object.keys(THEME_COLOR_CONFIG));
export const DEFAULT_ZOOM_LEVEL = 100;
export const MIN_ZOOM_LEVEL = 30;
export const MAX_ZOOM_LEVEL = 300;
export const ZOOM_STEP = 5;
export const COMMUNITY_THEME_FIXED_THEME_MODE: ThemeMode = 'dark';
const APP_FONT_STYLE_ATTR = 'data-vrcx-app-font';
const APP_CJK_FONT_STYLE_ATTR = 'data-vrcx-cjk-font';
const COMMUNITY_THEME_APPEARANCE_ATTR =
    'data-vrcx-0-community-theme-appearance';

export const APP_FONT_DEFAULT_KEY = 'geist';
export const APP_CJK_FONT_PACK_DEFAULT_KEY = 'noto';
const GOOGLE_NOTO_CJK_FONT_IMPORT =
    "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@100..900&family=Noto+Sans+KR:wght@100..900&family=Noto+Sans+TC:wght@100..900&display=swap');";
const LOCAL_NOTO_SANS_SC_FONTS = Object.freeze([
    "'Noto Sans SC Variable'",
    "'Noto Sans SC'"
]);
const GOOGLE_NOTO_SANS_JP_FONTS = Object.freeze(["'Noto Sans JP'"]);
const GOOGLE_NOTO_SANS_TC_FONTS = Object.freeze(["'Noto Sans TC'"]);
const GOOGLE_NOTO_SANS_KR_FONTS = Object.freeze(["'Noto Sans KR'"]);
const MACOS_SYSTEM_CJK_FONT_STACKS = Object.freeze({
    ja: Object.freeze(["'Hiragino Sans'", "'Hiragino Kaku Gothic ProN'"]),
    'zh-CN': Object.freeze(["'PingFang SC'", "'Hiragino Sans GB'"]),
    'zh-TW': Object.freeze(["'PingFang TC'", "'PingFang HK'"]),
    ko: Object.freeze(["'Apple SD Gothic Neo'"]),
    default: Object.freeze([])
});

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
        cssNames: Object.freeze([]),
        cssImport: null
    },
    puhuiti: {
        cssNames: Object.freeze([
            "'PHT Sans SC'",
            "'PHT Sans TC'",
            "'PHT Sans JP'",
            "'PHT Sans KR'"
        ]),
        cssImport:
            [
                '/* Simplified Chinese */',
                "@font-face { font-family: 'PHT Sans SC'; src: url('https://cdn.jsdelivr.net/gh/map1en/pht@1.0.0/sc/phtsansSC-Regular.woff2') format('woff2'); font-weight: 400; font-display: swap; }",
                "@font-face { font-family: 'PHT Sans SC'; src: url('https://cdn.jsdelivr.net/gh/map1en/pht@1.0.0/sc/phtsansSC-Medium.woff2') format('woff2'); font-weight: 500; font-display: swap; }",
                "@font-face { font-family: 'PHT Sans SC'; src: url('https://cdn.jsdelivr.net/gh/map1en/pht@1.0.0/sc/phtsansSC-SemiBold.woff2') format('woff2'); font-weight: 600; font-display: swap; }",
                "@font-face { font-family: 'PHT Sans SC'; src: url('https://cdn.jsdelivr.net/gh/map1en/pht@1.0.0/sc/phtsansSC-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }",
                '/* Traditional Chinese */',
                "@font-face { font-family: 'PHT Sans TC'; src: url('https://cdn.jsdelivr.net/gh/map1en/pht@1.0.0/tc/phtsansTC-55.woff2') format('woff2'); font-weight: 400; font-display: swap; }",
                "@font-face { font-family: 'PHT Sans TC'; src: url('https://cdn.jsdelivr.net/gh/map1en/pht@1.0.0/tc/phtsansTC-75.woff2') format('woff2'); font-weight: 600; font-display: swap; }",
                '/* Japanese */',
                "@font-face { font-family: 'PHT Sans JP'; src: url('https://cdn.jsdelivr.net/gh/map1en/pht@1.0.0/jp/phtsansJP-Regular.woff2') format('woff2'); font-weight: 400; font-display: swap; }",
                "@font-face { font-family: 'PHT Sans JP'; src: url('https://cdn.jsdelivr.net/gh/map1en/pht@1.0.0/jp/phtsansJP-Medium.woff2') format('woff2'); font-weight: 500; font-display: swap; }",
                "@font-face { font-family: 'PHT Sans JP'; src: url('https://cdn.jsdelivr.net/gh/map1en/pht@1.0.0/jp/phtsansJP-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }",
                '/* Korean */',
                "@font-face { font-family: 'PHT Sans KR'; src: url('https://cdn.jsdelivr.net/gh/map1en/pht@1.0.0/kr/phtsansKR-Regular.woff2') format('woff2'); font-weight: 400; font-display: swap; }",
                "@font-face { font-family: 'PHT Sans KR'; src: url('https://cdn.jsdelivr.net/gh/map1en/pht@1.0.0/kr/phtsansKR-Medium.woff2') format('woff2'); font-weight: 500; font-display: swap; }",
                "@font-face { font-family: 'PHT Sans KR'; src: url('https://cdn.jsdelivr.net/gh/map1en/pht@1.0.0/kr/phtsansKR-Bold.woff2') format('woff2'); font-weight: 700; font-display: swap; }"
            ].join('\n')
    },
    system: {
        cssNames: Object.freeze([]),
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

export function isCommunityThemeAppearanceControlled(): boolean {
    if (typeof document === 'undefined') {
        return false;
    }

    return document.documentElement.hasAttribute(COMMUNITY_THEME_APPEARANCE_ATTR);
}

export function getCommunityThemeAppearanceThemeMode(): ThemeMode {
    if (typeof document === 'undefined') {
        return COMMUNITY_THEME_FIXED_THEME_MODE;
    }

    const value = document.documentElement.getAttribute(
        COMMUNITY_THEME_APPEARANCE_ATTR
    );
    return value === 'light' || value === 'dark'
        ? value
        : COMMUNITY_THEME_FIXED_THEME_MODE;
}

function resolveEffectiveThemeMode(themeMode: unknown): ThemeMode {
    if (isCommunityThemeAppearanceControlled()) {
        return getCommunityThemeAppearanceThemeMode();
    }

    return resolveThemeMode(themeMode);
}

export function getResolvedThemeMode(themeMode: unknown): ResolvedThemeMode {
    const normalized = resolveEffectiveThemeMode(themeMode);
    if (normalized === 'system') {
        return window.matchMedia?.('(prefers-color-scheme: dark)').matches
            ? 'dark'
            : 'light';
    }

    return normalized;
}

export function normalizeZoomLevel(
    value: unknown,
    fallback: any = DEFAULT_ZOOM_LEVEL
): number {
    if (value === null || value === undefined || value === '') {
        return fallback;
    }

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
    Object.values(THEME_COLOR_STYLE_PROPERTIES).forEach((propertyName: any) => {
        root.style.removeProperty(propertyName);
    });
}

export function clearThemeColorInlineProperties(): void {
    if (typeof document === 'undefined') {
        return;
    }
    clearThemeColorProperties(document.documentElement);
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

    if (
        root.getAttribute('data-vrcx-0-community-theme-accent') !== 'theme' &&
        normalized !== DEFAULT_THEME_COLOR_KEY
    ) {
        Object.entries(THEME_COLOR_STYLE_PROPERTIES).forEach(
            ([tokenName, propertyName]: any) => {
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

    document.querySelectorAll(`style[${attrName}]`).forEach((styleElement: any) => {
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

function normalizeFontLocale(locale: unknown): string {
    const normalized = String(
        locale || useShellStore.getState().locale || 'en'
    ).trim();
    return normalized || 'en';
}

function getMacosSystemCjkFonts(locale: string): readonly string[] {
    switch (locale) {
        case 'ja':
            return MACOS_SYSTEM_CJK_FONT_STACKS.ja;
        case 'zh-CN':
            return MACOS_SYSTEM_CJK_FONT_STACKS['zh-CN'];
        case 'zh-TW':
            return MACOS_SYSTEM_CJK_FONT_STACKS['zh-TW'];
        case 'ko':
            return MACOS_SYSTEM_CJK_FONT_STACKS.ko;
        default:
            return MACOS_SYSTEM_CJK_FONT_STACKS.default;
    }
}

function resolveNotoCjkFontConfig(locale: string): {
    cssNames: readonly string[];
    cssImport: string | null;
    styleKey: string;
} {
    if (!VRCX_0_BUNDLED_CJK_FONTS_ENABLED) {
        return {
            cssNames: getMacosSystemCjkFonts(locale),
            cssImport: null,
            styleKey: `noto:macos:${locale}`
        };
    }

    switch (locale) {
        case 'ja':
            return {
                cssNames: GOOGLE_NOTO_SANS_JP_FONTS,
                cssImport: GOOGLE_NOTO_CJK_FONT_IMPORT,
                styleKey: 'noto:google:ja'
            };
        case 'zh-TW':
            return {
                cssNames: GOOGLE_NOTO_SANS_TC_FONTS,
                cssImport: GOOGLE_NOTO_CJK_FONT_IMPORT,
                styleKey: 'noto:google:zh-TW'
            };
        case 'ko':
            return {
                cssNames: GOOGLE_NOTO_SANS_KR_FONTS,
                cssImport: GOOGLE_NOTO_CJK_FONT_IMPORT,
                styleKey: 'noto:google:ko'
            };
        case 'zh-CN':
        default:
            return {
                cssNames: LOCAL_NOTO_SANS_SC_FONTS,
                cssImport: null,
                styleKey: 'noto:local:sc'
            };
    }
}

function resolveCjkFontConfig(
    normalizedCjk: AppCjkFontPackKey,
    locale: string
): {
    cssNames: readonly string[];
    cssImport: string | null;
    styleKey: string;
} {
    if (normalizedCjk === 'noto') {
        return resolveNotoCjkFontConfig(locale);
    }

    const cjkConfig = APP_CJK_FONT_PACK_CONFIG[normalizedCjk];
    return {
        cssNames: Array.isArray(cjkConfig.cssNames) ? cjkConfig.cssNames : [],
        cssImport: cjkConfig.cssImport,
        styleKey: normalizedCjk
    };
}

export function applyAppFontPreferences({
    fontFamily = APP_FONT_DEFAULT_KEY,
    customFontFamily = '',
    cjkFontPack = APP_CJK_FONT_PACK_DEFAULT_KEY,
    locale
}: AppFontPreferenceInput = {}) {
    const normalizedFont = normalizeAppFontFamily(fontFamily);
    const normalizedCjk = normalizeAppCjkFontPack(cjkFontPack);
    const normalizedLocale = normalizeFontLocale(locale);
    const fontConfig = APP_FONT_CONFIG[normalizedFont];
    const cjkConfig = resolveCjkFontConfig(normalizedCjk, normalizedLocale);
    const westernFont =
        normalizedFont === 'custom'
            ? String(customFontFamily || '').trim() ||
              APP_FONT_CONFIG[APP_FONT_DEFAULT_KEY].cssName
            : fontConfig.cssName;

    ensureDynamicStyle(
        APP_FONT_STYLE_ATTR,
        normalizedFont,
        fontConfig.cssImport
    );
    ensureDynamicStyle(
        APP_CJK_FONT_STYLE_ATTR,
        cjkConfig.styleKey,
        cjkConfig.cssImport
    );

    document.documentElement.style.setProperty(
        '--vrcx-app-font-family',
        [westernFont, ...cjkConfig.cssNames, 'system-ui']
            .filter(Boolean)
            .join(', ')
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

    await tauriClient.app.ChangeTheme(nativeTheme);
}

export async function applyThemeMode(themeMode: unknown): Promise<void> {
    const normalized = resolveThemeMode(themeMode);
    const effectiveThemeMode = resolveEffectiveThemeMode(normalized);
    const resolvedTheme = getResolvedThemeMode(effectiveThemeMode);
    const shouldUseDarkClass = resolvedTheme === 'dark';

    document.documentElement.classList.toggle('dark', shouldUseDarkClass);
    document.documentElement.setAttribute('data-theme', resolvedTheme);

    useShellStore.getState().setThemeMode(effectiveThemeMode);
    await syncNativeTheme(effectiveThemeMode);
}

export async function setCommunityThemeAppearanceControl(
    enabled: boolean,
    restoredThemeMode: unknown = useShellStore.getState().themeMode,
    controlledThemeMode: unknown = COMMUNITY_THEME_FIXED_THEME_MODE
): Promise<void> {
    if (typeof document === 'undefined') {
        return;
    }

    const root = document.documentElement;
    if (enabled) {
        const normalizedControlledThemeMode =
            resolveThemeMode(controlledThemeMode) === 'light' ? 'light' : 'dark';
        root.setAttribute(
            COMMUNITY_THEME_APPEARANCE_ATTR,
            normalizedControlledThemeMode
        );
        await applyThemeMode(normalizedControlledThemeMode);
        return;
    }

    root.removeAttribute(COMMUNITY_THEME_APPEARANCE_ATTR);
    await applyThemeMode(restoredThemeMode);
}

export async function applyZoomLevel(savedZoom: unknown): Promise<void> {
    if (savedZoom === null || savedZoom === undefined) {
        return;
    }

    const numericZoom = normalizeZoomLevel(savedZoom);

    useShellStore.getState().setZoomLevel(numericZoom);
    await tauriClient.webview.setZoom(Math.pow(1.2, numericZoom / 10 - 10));
}
