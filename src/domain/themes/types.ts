type CommunityThemeAccentMode = boolean;
type CommunityThemeDarkMode = boolean;

type CommunityThemeAuthor = {
    name: string;
    github: string;
    url?: string | null;
};

export type CommunityThemeManifest = {
    id: string;
    name: string;
    version: string;
    author: CommunityThemeAuthor;
    description: string;
    tags: string[];
    testedWith: string;
    remoteAssets: boolean;
    darkMode: boolean;
    accentMode: boolean;
    previewUrl: string;
    readmeUrl: string;
};

export type CommunityThemeCatalog = {
    sourceUrl: string;
    schemaVersion: number;
    themes: CommunityThemeManifest[];
};

export type CommunityThemeInstallMetadata = {
    themeId: string;
    themeName: string;
    version: string;
    sourceUrl: string;
    sha256: string;
    installedAt: string;
    updatedAt: string;
    darkMode: boolean;
    accentMode: boolean;
};

type CommunityThemeStatsEntry = {
    downloads: number;
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
