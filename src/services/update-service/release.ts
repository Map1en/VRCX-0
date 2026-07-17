import { branches } from '@/shared/constants/settings';
import {
    compareReleaseVersions,
    parseReleaseVersion
} from '@/shared/utils/releaseVersion';

import type {
    GitHubRelease,
    GitHubReleaseAsset,
    NormalizedRelease,
    UpdateOptions
} from './types';

const INSTALLABLE_PLATFORMS = new Set(['windows', 'linux', 'macos']);
const LINUX_UPDATER_PACKAGE_KINDS = new Set(['appimage', 'deb', 'rpm']);

type TauriReleaseAsset = {
    manifestUrl: string;
    target: string;
    updaterType: 'tauri';
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === 'object');
}

function asGitHubRelease(value: unknown): GitHubRelease {
    return isRecord(value) ? value : {};
}

function normalizeHostArch(hostArch: unknown) {
    const normalized = String(hostArch || '').toLowerCase();
    if (normalized === 'arm64') {
        return 'aarch64';
    }
    if (normalized === 'amd64' || normalized === 'x64') {
        return 'x86_64';
    }
    return normalized;
}

function linuxPackageKindForUpdater(linuxPackageKind: unknown) {
    const normalized = String(linuxPackageKind || '').toLowerCase();
    return LINUX_UPDATER_PACKAGE_KINDS.has(normalized)
        ? normalized
        : 'appimage';
}

function platformIdForHost(
    hostPlatform: unknown,
    hostArch: unknown = '',
    linuxPackageKind: unknown = ''
) {
    const normalizedArch = normalizeHostArch(hostArch);
    if (hostPlatform === 'linux') {
        return `linux-x86_64-${linuxPackageKindForUpdater(linuxPackageKind)}`;
    }
    if (hostPlatform === 'windows') {
        return 'windows-x86_64';
    }
    if (hostPlatform === 'macos' && normalizedArch === 'aarch64') {
        return 'macos-aarch64';
    }
    if (hostPlatform === 'macos' && normalizedArch === 'x86_64') {
        return 'macos-x86_64';
    }
    return '';
}

function getUpdaterTarget(
    hostPlatform: unknown,
    hostArch: unknown = '',
    linuxPackageKind: unknown = ''
) {
    const platformId = platformIdForHost(
        hostPlatform,
        hostArch,
        linuxPackageKind
    );
    return platformId ? `${platformId}-stable` : '';
}

function getUpdaterManifestAssetName(
    hostPlatform: unknown,
    hostArch: unknown = '',
    linuxPackageKind: unknown = ''
) {
    const target = getUpdaterTarget(hostPlatform, hostArch, linuxPackageKind);
    if (!target) {
        return '';
    }
    if (hostPlatform === 'linux' || hostPlatform === 'macos') {
        return 'latest_linux_and_macos.json';
    }
    if (hostPlatform === 'windows') {
        return 'latest_windows.json';
    }
    return '';
}

export function canInstallUpdatesOnPlatform(hostPlatform: unknown) {
    return INSTALLABLE_PLATFORMS.has(String(hostPlatform || ''));
}

function getTauriManifestAssetOfInterest(
    assets: GitHubReleaseAsset[] = [],
    hostPlatform: unknown,
    hostArch: string,
    linuxPackageKind: string
): TauriReleaseAsset | null {
    const manifestName = getUpdaterManifestAssetName(
        hostPlatform,
        hostArch,
        linuxPackageKind
    );
    if (!manifestName) {
        return null;
    }

    const asset = assets.find(
        (item) => item?.state === 'uploaded' && item.name === manifestName
    );
    if (!asset?.browser_download_url) {
        return null;
    }

    return {
        manifestUrl: asset.browser_download_url,
        target: getUpdaterTarget(hostPlatform, hostArch, linuxPackageKind),
        updaterType: 'tauri'
    };
}

export function normalizeGitHubRelease(
    release: GitHubRelease,
    {
        hostPlatform = 'unknown',
        hostArch = 'unknown',
        linuxPackageKind = 'unknown',
        requireInstallerAsset = true
    }: UpdateOptions = {}
): NormalizedRelease | null {
    const parsedVersion = parseReleaseVersion(String(release?.tag_name || ''));
    if (!parsedVersion) {
        return null;
    }

    const tauriAsset = getTauriManifestAssetOfInterest(
        release.assets,
        hostPlatform,
        String(hostArch || ''),
        String(linuxPackageKind || '')
    );
    const asset = tauriAsset;
    if (requireInstallerAsset && !asset) {
        return null;
    }

    return {
        ...(asset || {}),
        canonicalVersion: parsedVersion.canonicalVersion,
        channel: 'Stable',
        displayVersion: parsedVersion.displayVersion,
        htmlUrl: release.html_url || '',
        tagName: release.tag_name || '',
        displayName: release.name || `VRCX-0 ${parsedVersion.displayVersion}`,
        prerelease: Boolean(release.prerelease),
        publishedAt: release.published_at || '',
        body: release.body || '',
        updaterType: asset?.updaterType || 'manual'
    };
}

export function normalizeReleaseList(
    branch: unknown,
    releases: unknown,
    options: UpdateOptions = {}
): NormalizedRelease[] {
    const normalizedBranch = sanitizeBranch(branch);
    return (Array.isArray(releases) ? releases : [releases])
        .map((release) =>
            normalizeGitHubRelease(asGitHubRelease(release), {
                ...options
            })
        )
        .filter(
            (release): release is NormalizedRelease =>
                release !== null &&
                release.channel === normalizedBranch &&
                release.prerelease === false
        )
        .sort((left, right) =>
            compareReleaseVersions(
                right.canonicalVersion,
                left.canonicalVersion
            )
        );
}

export function sanitizeBranch(_branch?: unknown): keyof typeof branches {
    return 'Stable';
}
