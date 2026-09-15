import type {
    CommunityThemeLocalPreview,
    CommunityThemeManifest
} from '@/domain/themes/types';
import { links } from '@/shared/constants/link';
import type { THEME_COLORS } from '@/shared/constants/themes';
import type { ThemeMode } from '@/state/shellStore';

export type ThemeSource = 'built-in' | 'background' | 'community';

export const THEME_MODE_OPTIONS = [
    'system',
    'light',
    'dark'
] as const satisfies readonly ThemeMode[];
export const COMMUNITY_THEMES_REPOSITORY_URL = links.communityThemesRepository;

export function themeModeLabel(
    themeMode: ThemeMode,
    t: (key: string) => string
) {
    return t(`view.settings.appearance.appearance.theme_mode_${themeMode}`);
}

export function themeColorLabel(
    themeColor: (typeof THEME_COLORS)[number],
    t: (key: string) => string
) {
    return t(`view.settings.appearance.theme_color.${themeColor.key}`);
}

export function resolveActiveThemeSource(
    backgroundImageEnabled: boolean,
    communityThemeEnabled: boolean,
    localPreview: CommunityThemeLocalPreview | null
): ThemeSource {
    if (localPreview || communityThemeEnabled) {
        return 'community';
    }
    if (backgroundImageEnabled) {
        return 'background';
    }
    return 'built-in';
}

function normalizeVersionForThemeCompatibility(version: string): string {
    return version.trim().replace(/^v/i, '');
}

export function isSameThemeVersion(left: string, right: string): boolean {
    return (
        normalizeVersionForThemeCompatibility(left) ===
        normalizeVersionForThemeCompatibility(right)
    );
}

export function resolveThemeAuthorUrl(theme: CommunityThemeManifest): string {
    const authorUrl = theme.author.url?.trim();
    if (authorUrl) {
        return authorUrl;
    }
    return `https://github.com/${theme.author.github}`;
}
