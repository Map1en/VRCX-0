type ThemeModeConfig = {
    isDark: boolean | 'system';
    name: string;
};

export const THEME_CONFIG: Record<string, ThemeModeConfig> = {
    system: {
        isDark: 'system',
        name: 'System'
    },
    light: {
        isDark: false,
        name: 'Light'
    },
    dark: {
        isDark: true,
        name: 'Dark'
    }
};

export const DEFAULT_THEME_COLOR_KEY = 'default';

const neutralForeground = 'var(--color-neutral-50)';
const darkForeground = 'var(--color-neutral-950)';

type ThemeColorConfig = {
    key: string;
    label: string;
    swatch: string;
    primary?: string;
    primaryDark?: string;
    foreground?: string;
    foregroundDark?: string;
    ring?: string;
    ringDark?: string;
};

export const THEME_COLOR_CONFIG: Record<string, ThemeColorConfig> = {
    default: {
        key: 'default',
        label: 'Neutral',
        swatch: 'var(--color-neutral-700)'
    },
    blue: {
        key: 'blue',
        label: 'Blue',
        swatch: 'var(--color-blue-600)',
        primary: 'var(--color-blue-600)',
        primaryDark: 'var(--color-blue-500)',
        foreground: 'var(--color-blue-50)',
        foregroundDark: 'var(--color-blue-50)',
        ring: 'var(--color-blue-500)',
        ringDark: 'var(--color-blue-400)'
    },
    green: {
        key: 'green',
        label: 'Green',
        swatch: 'var(--color-lime-600)',
        primary: 'var(--color-lime-600)',
        primaryDark: 'var(--color-lime-500)',
        foreground: 'var(--color-lime-50)',
        foregroundDark: 'var(--color-lime-50)',
        ring: 'var(--color-lime-500)',
        ringDark: 'var(--color-lime-400)'
    },
    orange: {
        key: 'orange',
        label: 'Orange',
        swatch: 'var(--color-orange-600)',
        primary: 'var(--color-orange-600)',
        primaryDark: 'var(--color-orange-500)',
        foreground: 'var(--color-orange-50)',
        foregroundDark: 'var(--color-orange-50)',
        ring: 'var(--color-orange-500)',
        ringDark: 'var(--color-orange-400)'
    },
    red: {
        key: 'red',
        label: 'Red',
        swatch: 'var(--color-red-600)',
        primary: 'var(--color-red-600)',
        primaryDark: 'var(--color-red-500)',
        foreground: 'var(--color-red-50)',
        foregroundDark: 'var(--color-red-50)',
        ring: 'var(--color-red-500)',
        ringDark: 'var(--color-red-400)'
    },
    rose: {
        key: 'rose',
        label: 'Rose',
        swatch: 'var(--color-rose-600)',
        primary: 'var(--color-rose-600)',
        primaryDark: 'var(--color-rose-500)',
        foreground: 'var(--color-rose-50)',
        foregroundDark: 'var(--color-rose-50)',
        ring: 'var(--color-rose-500)',
        ringDark: 'var(--color-rose-400)'
    },
    violet: {
        key: 'violet',
        label: 'Violet',
        swatch: 'var(--color-violet-600)',
        primary: 'var(--color-violet-600)',
        primaryDark: 'var(--color-violet-500)',
        foreground: 'var(--color-violet-50)',
        foregroundDark: 'var(--color-violet-50)',
        ring: 'var(--color-violet-500)',
        ringDark: 'var(--color-violet-400)'
    },
    yellow: {
        key: 'yellow',
        label: 'Yellow',
        swatch: 'var(--color-yellow-400)',
        primary: 'var(--color-yellow-400)',
        primaryDark: 'var(--color-yellow-300)',
        foreground: darkForeground,
        foregroundDark: darkForeground,
        ring: 'var(--color-yellow-500)',
        ringDark: 'var(--color-yellow-400)'
    }
};

export const THEME_COLORS = Object.freeze(
    Object.values(THEME_COLOR_CONFIG).map(({ key, label, swatch }) => ({
        key,
        label,
        swatch
    }))
);

export const THEME_COLOR_STYLE_PROPERTIES = Object.freeze({
    primary: '--vrcx-theme-primary',
    primaryDark: '--vrcx-theme-primary-dark',
    foreground: '--vrcx-theme-primary-foreground',
    foregroundDark: '--vrcx-theme-primary-foreground-dark',
    ring: '--vrcx-theme-ring',
    ringDark: '--vrcx-theme-ring-dark'
});

for (const theme of Object.values(THEME_COLOR_CONFIG)) {
    if (theme.key === DEFAULT_THEME_COLOR_KEY) {
        continue;
    }
    theme.foreground ??= neutralForeground;
    theme.foregroundDark ??= theme.foreground;
    theme.primaryDark ??= theme.primary;
    theme.ring ??= theme.primary;
    theme.ringDark ??= theme.ring;
}
