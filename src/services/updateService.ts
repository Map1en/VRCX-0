import {
    checkTauriUpdate,
    downloadAndInstallTauriUpdate
} from '@/platform/tauri/updater';
import externalApiRepository from '@/repositories/externalApiRepository';
import storageRepository from '@/repositories/storageRepository';
import { branches } from '@/shared/constants/settings';
import {
    compareReleaseVersions,
    formatReleaseDisplayVersion,
    parseReleaseVersion
} from '@/shared/utils/releaseVersion';

const INSTALLABLE_PLATFORMS = new Set(['windows', 'linux', 'macos']);
const LINUX_UPDATER_PACKAGE_KINDS = new Set(['appimage', 'deb', 'rpm']);
let updateInstallInFlight = null;

type UpdateOptions = Record<string, any>;

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
    hostArch: any = '',
    linuxPackageKind: any = ''
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
    hostArch: any = '',
    linuxPackageKind: any = ''
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
    hostArch: any = '',
    linuxPackageKind: any = ''
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

function canInstallUpdatesOnPlatform(hostPlatform: unknown) {
    return INSTALLABLE_PLATFORMS.has(String(hostPlatform || ''));
}

function getTauriManifestAssetOfInterest(
    assets: Record<string, any>[] = [],
    hostPlatform: unknown,
    hostArch: string,
    linuxPackageKind: string
) {
    const manifestName = getUpdaterManifestAssetName(
        hostPlatform,
        hostArch,
        linuxPackageKind
    );
    if (!manifestName) {
        return null;
    }

    const asset = assets.find(
        (item: any) => item?.state === 'uploaded' && item.name === manifestName
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

function normalizeGitHubRelease(
    release: Record<string, any>,
    {
        hostPlatform = 'unknown',
        hostArch = 'unknown',
        linuxPackageKind = 'unknown',
        requireInstallerAsset = true
    }: UpdateOptions = {}
) {
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
        tagName: release.tag_name,
        displayName: release.name || `VRCX-0 ${parsedVersion.displayVersion}`,
        prerelease: Boolean(release.prerelease),
        publishedAt: release.published_at || '',
        body: release.body || '',
        updaterType: asset?.updaterType || 'manual'
    };
}

function normalizeReleaseList(
    branch: unknown,
    releases: unknown,
    options: UpdateOptions = {}
) {
    const normalizedBranch = sanitizeBranch(branch);
    return (Array.isArray(releases) ? releases : [releases])
        .map((release: any) =>
            normalizeGitHubRelease(release, {
                ...options
            })
        )
        .filter(
            (release: any) =>
                release &&
                release.channel === normalizedBranch &&
                release.prerelease === false
        )
        .sort((left: any, right: any) =>
            compareReleaseVersions(
                right.canonicalVersion,
                left.canonicalVersion
            )
        );
}

function sanitizeBranch(_branch?: unknown) {
    return 'Stable';
}

function defaultBranchForVersion(_version?: unknown) {
    return 'Stable';
}

function hasUpdateForBranch(
    branch: unknown,
    currentVersion: unknown,
    latestReleaseVersion: unknown
) {
    const currentParsed = parseReleaseVersion(String(currentVersion || ''));
    const latestParsed = parseReleaseVersion(
        String(latestReleaseVersion || '')
    );

    if (!currentParsed || !latestParsed) {
        return false;
    }

    const normalizedBranch = sanitizeBranch(branch);
    if (normalizedBranch !== 'Stable') {
        return false;
    }

    return (
        compareReleaseVersions(latestParsed.canonicalVersion, currentParsed) > 0
    );
}

async function fetchBranchReleases(
    branch: unknown,
    options: UpdateOptions = {}
) {
    const normalizedBranch = sanitizeBranch(branch);
    const response = await externalApiRepository.fetchGithubReleases({
        url: branches[normalizedBranch].urlReleases,
        headers: {
            Accept: 'application/vnd.github+json'
        }
    });
    if (response.status && response.status !== 200) {
        throw new Error(`GitHub release request failed (${response.status}).`);
    }

    const data =
        typeof response.data === 'string'
            ? JSON.parse(response.data)
            : response.data;
    if (data?.message) {
        throw new Error(data.message);
    }

    return normalizeReleaseList(normalizedBranch, data, options);
}

async function fetchLatestBranchRelease(
    branch: unknown,
    options: UpdateOptions = {}
) {
    const releases = await fetchBranchReleases(branch, options);
    return releases[0] || null;
}

async function getUpdaterProxy() {
    const proxy = await storageRepository
        .getString('VRCX_ProxyServer', '')
        .catch(() => '');
    return String(proxy || '').trim();
}

function shouldAllowDowngradesForBranch() {
    return false;
}

async function buildTauriUpdaterRequest(
    release: Record<string, any>,
    hostPlatform: string,
    hostArch: string,
    linuxPackageKind: string
) {
    if (!canInstallUpdatesOnPlatform(hostPlatform)) {
        throw new Error(`Updates are not installable on ${hostPlatform}.`);
    }

    const target =
        release?.target ||
        getUpdaterTarget(hostPlatform, hostArch, linuxPackageKind);
    if (!target) {
        throw new Error('No Tauri updater target is available.');
    }
    if (!release?.manifestUrl) {
        throw new Error('Selected release has no Tauri updater manifest.');
    }

    const proxy = await getUpdaterProxy();
    return {
        manifestUrl: release.manifestUrl,
        target,
        allowDowngrades: shouldAllowDowngradesForBranch(),
        ...(proxy ? { proxy } : {})
    };
}

async function checkTauriUpdateForRelease(
    release: Record<string, any>,
    options: UpdateOptions = {}
) {
    const request = await buildTauriUpdaterRequest(
        release,
        options.hostPlatform || 'unknown',
        options.hostArch || 'unknown',
        options.linuxPackageKind || 'unknown'
    );
    return checkTauriUpdate(request);
}

function handleTauriDownloadEvent(
    event: any,
    onProgress?: (progress: number) => void
) {
    if (event.event === 'Started') {
        return {
            downloaded: 0,
            contentLength: Number(event.data?.contentLength) || 0
        };
    }
    if (event.event === 'Finished') {
        onProgress?.(100);
    }
    return null;
}

async function checkInstallableUpdate(
    branch: unknown,
    {
        hostPlatform = 'unknown',
        hostArch = 'unknown',
        linuxPackageKind = 'unknown'
    }: UpdateOptions = {}
) {
    if (!canInstallUpdatesOnPlatform(hostPlatform)) {
        return null;
    }

    const release = await fetchLatestBranchRelease(branch, {
        hostArch,
        linuxPackageKind,
        hostPlatform,
        requireInstallerAsset: true
    });
    if (!release) {
        return null;
    }

    const update = await checkTauriUpdateForRelease(release, {
        branch,
        hostArch,
        linuxPackageKind,
        hostPlatform
    });
    if (!update) {
        return null;
    }
    const updateRecord = update as Record<string, any>;
    return {
        ...release,
        ...updateRecord,
        canonicalVersion: release.canonicalVersion,
        displayVersion: release.displayVersion,
        displayName: release.displayName,
        publishedAt: release.publishedAt,
        tagName: release.tagName,
        htmlUrl: release.htmlUrl
    };
}

async function downloadAndInstallUpdate(
    release: Record<string, any>,
    options: UpdateOptions = {}
) {
    if (updateInstallInFlight) {
        throw new Error('An update install is already in progress.');
    }
    const hostPlatform = options.hostPlatform || 'unknown';
    if (!release?.target) {
        throw new Error('Selected release has no Tauri updater target.');
    }

    updateInstallInFlight = (async () => {
        let downloaded = 0;
        let contentLength = 0;
        const request = await buildTauriUpdaterRequest(
            release,
            hostPlatform,
            options.hostArch || 'unknown',
            options.linuxPackageKind || 'unknown'
        );
        const onEvent = (event: any) => {
            const state = handleTauriDownloadEvent(event, options.onProgress);
            if (state) {
                downloaded = state.downloaded;
                contentLength = state.contentLength;
                options.onProgress?.(0);
                return;
            }
            if (event.event === 'Progress') {
                downloaded += Number(event.data?.chunkLength) || 0;
                if (contentLength > 0) {
                    options.onProgress?.(
                        Math.min(
                            100,
                            Math.round((downloaded / contentLength) * 100)
                        )
                    );
                }
                return;
            }
        };

        const update = await downloadAndInstallTauriUpdate(request, onEvent);
        if (!update) {
            throw new Error('No Tauri update is available.');
        }

        return update;
    })();

    try {
        return await updateInstallInFlight;
    } finally {
        updateInstallInFlight = null;
    }
}

export {
    canInstallUpdatesOnPlatform,
    checkInstallableUpdate,
    defaultBranchForVersion,
    downloadAndInstallUpdate,
    fetchBranchReleases,
    fetchLatestBranchRelease,
    formatReleaseDisplayVersion,
    getUpdaterManifestAssetName,
    getUpdaterTarget,
    hasUpdateForBranch,
    normalizeGitHubRelease,
    normalizeReleaseList,
    sanitizeBranch
};
