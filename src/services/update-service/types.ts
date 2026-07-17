export type UpdateOptions = {
    branch?: unknown;
    hostPlatform?: string;
    hostArch?: string;
    linuxPackageKind?: string;
    requireInstallerAsset?: boolean;
};

export type UpdateDownloadProgress = {
    downloadedBytes: number;
    totalBytes: number;
    percent: number;
};

export type GitHubReleaseAsset = {
    state?: string;
    name?: string;
    browser_download_url?: string;
};

export type GitHubRelease = {
    tag_name?: string;
    assets?: GitHubReleaseAsset[];
    html_url?: string;
    name?: string;
    prerelease?: boolean;
    published_at?: string;
    body?: string;
};

export type NormalizedRelease = {
    manifestUrl?: string;
    target?: string;
    canonicalVersion: string;
    channel: 'Stable';
    displayVersion: string;
    htmlUrl: string;
    tagName: string;
    displayName: string;
    prerelease: boolean;
    publishedAt: string;
    body: string;
    updaterType: 'tauri' | 'manual';
};
