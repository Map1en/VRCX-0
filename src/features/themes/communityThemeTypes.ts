import type {
    CommunityThemeAuthor,
    CommunityThemeCatalog,
    CommunityThemeInstallMetadata,
    CommunityThemeManifest,
    CommunityThemeStatsEntry
} from '@/platform/tauri/bindings';

export type CommunityThemeAccentMode = boolean;
export type CommunityThemeDarkMode = boolean;
export type {
    CommunityThemeAuthor,
    CommunityThemeCatalog,
    CommunityThemeInstallMetadata,
    CommunityThemeManifest,
    CommunityThemeStatsEntry
};
export type CommunityThemeStatsById = Partial<
    Record<string, CommunityThemeStatsEntry>
>;

export interface CommunityThemeLocalPreview {
    folderPath: string;
    cssPath: string;
    manifestPath?: string | null;
    themeName: string;
    version: string;
    darkMode: CommunityThemeDarkMode;
    accentMode: CommunityThemeAccentMode;
    cssLength: number;
    loadedAt: string;
}
