import type { ReleaseChannel } from '@/shared/utils/releaseVersion';

export type UpdateDownloadProgress = {
    downloadedBytes: number;
    totalBytes: number;
    percent: number;
};

export type GitHubRelease = {
    tag_name?: string;
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
    channel: ReleaseChannel;
    displayVersion: string;
    htmlUrl: string;
    tagName: string;
    displayName: string;
    publishedAt: string;
    body: string;
    updaterType: 'tauri' | 'manual';
};
