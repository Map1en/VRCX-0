import type {
    TauriDownloadEvent,
    TauriUpdateMetadata
} from '@/platform/tauri/bindings';
import {
    checkTauriUpdate,
    discardPendingTauriUpdate,
    downloadTauriUpdate,
    downloadAndInstallTauriUpdate,
    installPendingTauriUpdate,
    type TauriUpdateRequest
} from '@/platform/tauri/updater';
import externalApiRepository from '@/repositories/externalApiRepository';
import storageRepository from '@/repositories/storageRepository';
import { getVrcxBuildBadge, isPreviewBuildLabel } from '@/shared/buildLabel';
import { branches } from '@/shared/constants/settings';
import {
    compareReleaseVersions,
    formatReleaseDisplayVersion,
    parseReleaseVersion
} from '@/shared/utils/releaseVersion';

const INSTALLABLE_PLATFORMS = new Set(['windows', 'linux', 'macos']);
const LINUX_UPDATER_PACKAGE_KINDS = new Set(['appimage', 'deb', 'rpm']);
const PREVIEW_BADGE_TIMESTAMP_PATTERN =
    /^Preview\s+(?<year>\d{4})(?<month>\d{2})(?<day>\d{2})-(?<hour>\d{2})(?<minute>\d{2})$/i;
const TOKYO_UTC_OFFSET_MINUTES = 9 * 60;
let updateInstallInFlight: Promise<TauriUpdateMetadata> | null = null;
type UpdateDownloadInFlight = {
    version: string;
    promise: Promise<TauriUpdateMetadata>;
    progressSubscribers: Set<UpdateDownloadProgressSubscriber>;
    lastProgress: UpdateDownloadProgress | null;
};

let updateDownloadInFlight: UpdateDownloadInFlight | null = null;

export type UpdateOptions = {
    branch?: unknown;
    hostPlatform?: string;
    hostArch?: string;
    linuxPackageKind?: string;
    requireInstallerAsset?: boolean;
    onProgress?: (progress: number) => void;
    onDownloadProgress?: (progress: UpdateDownloadProgress) => void;
};

export type UpdateDownloadProgress = {
    downloadedBytes: number;
    totalBytes: number;
    percent: number;
};

type UpdateDownloadProgressSubscriber = (
    progress: UpdateDownloadProgress
) => void;

type GitHubReleaseAsset = {
    state?: string;
    name?: string;
    browser_download_url?: string;
};

type GitHubRelease = {
    tag_name?: string;
    assets?: GitHubReleaseAsset[];
    html_url?: string;
    name?: string;
    prerelease?: boolean;
    published_at?: string;
    body?: string;
};

type TauriReleaseAsset = {
    manifestUrl: string;
    target: string;
    updaterType: 'tauri';
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

export type InstallableUpdateRelease = NormalizedRelease & TauriUpdateMetadata;

type PreviewStableReleaseUpdateCheckResult = {
    handled: boolean;
    release: NormalizedRelease | null;
};

type PreviewStableReleaseUpdateMode = {
    enabled: boolean;
    check: (options?: UpdateOptions) => Promise<NormalizedRelease | null>;
};

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error || '');
}

function isNoPendingUpdateError(error: unknown): boolean {
    return errorText(error).includes('no-pending-update');
}

function isPendingUpdateVersionMismatchError(error: unknown): boolean {
    return errorText(error).includes('pending-update-version-mismatch');
}

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

function canInstallUpdatesOnPlatform(hostPlatform: unknown) {
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

function normalizeGitHubRelease(
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

function normalizeReleaseList(
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

function sanitizeBranch(_branch?: unknown): keyof typeof branches {
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

function parsePreviewBuildTimestampMs() {
    if (!isPreviewBuildLabel()) {
        return null;
    }

    const match = PREVIEW_BADGE_TIMESTAMP_PATTERN.exec(getVrcxBuildBadge());
    if (!match?.groups) {
        return null;
    }

    const year = Number(match.groups.year);
    const month = Number(match.groups.month);
    const day = Number(match.groups.day);
    const hour = Number(match.groups.hour);
    const minute = Number(match.groups.minute);
    if (
        month < 1 ||
        month > 12 ||
        day < 1 ||
        day > 31 ||
        hour > 23 ||
        minute > 59
    ) {
        return null;
    }

    const timestamp = Date.UTC(
        year,
        month - 1,
        day,
        hour,
        minute - TOKYO_UTC_OFFSET_MINUTES
    );
    const tokyoDate = new Date(timestamp + TOKYO_UTC_OFFSET_MINUTES * 60000);
    if (
        tokyoDate.getUTCFullYear() !== year ||
        tokyoDate.getUTCMonth() !== month - 1 ||
        tokyoDate.getUTCDate() !== day ||
        tokyoDate.getUTCHours() !== hour ||
        tokyoDate.getUTCMinutes() !== minute
    ) {
        return null;
    }

    return timestamp;
}

function isPreviewStableReleaseUpdateCheckEnabled() {
    return isPreviewBuildLabel();
}

function isStableReleaseNewerThanPreviewBuild(
    release: NormalizedRelease,
    previewBuildTimestampMs: number
) {
    const publishedAt = Date.parse(release.publishedAt);
    return (
        Number.isFinite(publishedAt) && publishedAt > previewBuildTimestampMs
    );
}

// Preview builds do not ship auto-updater assets. This rare preview-to-Stable
// path only compares the bundled preview timestamp to the latest Stable release
// and lets the UI send users to GitHub when Stable was published later.
async function checkPreviewStableReleaseUpdate(
    options: UpdateOptions = {}
): Promise<NormalizedRelease | null> {
    const previewBuildTimestampMs = parsePreviewBuildTimestampMs();
    if (previewBuildTimestampMs === null) {
        return null;
    }

    const latestRelease = await fetchLatestBranchRelease('Stable', {
        ...options,
        requireInstallerAsset: false
    });
    if (
        !latestRelease ||
        !isStableReleaseNewerThanPreviewBuild(
            latestRelease,
            previewBuildTimestampMs
        )
    ) {
        return null;
    }

    return latestRelease;
}

async function handlePreviewStableReleaseUpdateCheck(
    options: UpdateOptions = {}
): Promise<PreviewStableReleaseUpdateCheckResult> {
    if (!isPreviewStableReleaseUpdateCheckEnabled()) {
        return {
            handled: false,
            release: null
        };
    }

    return {
        handled: true,
        release: await checkPreviewStableReleaseUpdate(options)
    };
}

function getPreviewStableReleaseUpdateMode(): PreviewStableReleaseUpdateMode {
    return {
        enabled: isPreviewStableReleaseUpdateCheckEnabled(),
        check: checkPreviewStableReleaseUpdate
    };
}

async function fetchBranchReleases(
    branch: unknown,
    options: UpdateOptions = {}
): Promise<NormalizedRelease[]> {
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
): Promise<NormalizedRelease | null> {
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
    release: NormalizedRelease,
    hostPlatform: string,
    hostArch: string,
    linuxPackageKind: string
): Promise<TauriUpdateRequest> {
    if (!canInstallUpdatesOnPlatform(hostPlatform)) {
        throw new Error(`Updates are not installable on ${hostPlatform}.`);
    }

    const target =
        release?.target ||
        getUpdaterTarget(hostPlatform, hostArch, linuxPackageKind);
    if (!target) {
        throw new Error('No Tauri updater target is available.');
    }
    const manifestUrl = release?.manifestUrl;
    if (!manifestUrl) {
        throw new Error('Selected release has no Tauri updater manifest.');
    }

    const proxy = await getUpdaterProxy();
    return {
        manifestUrl,
        target,
        allowDowngrades: shouldAllowDowngradesForBranch(),
        proxy: proxy || null
    };
}

async function checkTauriUpdateForRelease(
    release: NormalizedRelease,
    options: UpdateOptions = {}
): Promise<TauriUpdateMetadata | null> {
    const request = await buildTauriUpdaterRequest(
        release,
        options.hostPlatform || 'unknown',
        options.hostArch || 'unknown',
        options.linuxPackageKind || 'unknown'
    );
    return checkTauriUpdate(request);
}

function handleTauriDownloadEvent(
    event: TauriDownloadEvent,
    emitProgress: UpdateDownloadProgressSubscriber
): { downloaded: number; contentLength: number } | null {
    if (event.event === 'Started') {
        const contentLength = Number(event.data?.contentLength) || 0;
        emitProgress({
            downloadedBytes: 0,
            totalBytes: contentLength,
            percent: 0
        });
        return {
            downloaded: 0,
            contentLength
        };
    }
    if (event.event === 'Finished') {
        emitProgress({
            downloadedBytes: 0,
            totalBytes: 0,
            percent: 100
        });
    }
    return null;
}

function emitUpdateDownloadProgress(
    options: UpdateOptions,
    progress: UpdateDownloadProgress
) {
    options.onProgress?.(progress.percent);
    options.onDownloadProgress?.(progress);
}

function createTauriDownloadEventHandler(
    options: UpdateOptions = {},
    emitProgress: UpdateDownloadProgressSubscriber = (progress) =>
        emitUpdateDownloadProgress(options, progress)
): (event: TauriDownloadEvent) => void {
    let downloaded = 0;
    let contentLength = 0;
    return (event: TauriDownloadEvent) => {
        const state = handleTauriDownloadEvent(event, emitProgress);
        if (state) {
            downloaded = state.downloaded;
            contentLength = state.contentLength;
            return;
        }
        if (event.event !== 'Progress') {
            return;
        }
        downloaded += Number(event.data?.chunkLength) || 0;
        if (contentLength > 0) {
            const percent = Math.min(
                100,
                Math.round((downloaded / contentLength) * 100)
            );
            emitProgress({
                downloadedBytes: downloaded,
                totalBytes: contentLength,
                percent
            });
            return;
        }
        emitProgress({
            downloadedBytes: downloaded,
            totalBytes: 0,
            percent: 0
        });
    };
}

function publishInFlightDownloadProgress(
    download: UpdateDownloadInFlight,
    progress: UpdateDownloadProgress
) {
    download.lastProgress = progress;
    for (const subscriber of download.progressSubscribers) {
        subscriber(progress);
    }
}

function subscribeToInFlightDownload(
    download: UpdateDownloadInFlight,
    options: UpdateOptions
) {
    if (!options.onProgress && !options.onDownloadProgress) {
        return () => {};
    }
    const subscriber = (progress: UpdateDownloadProgress) => {
        emitUpdateDownloadProgress(options, progress);
    };
    download.progressSubscribers.add(subscriber);
    if (download.lastProgress) {
        subscriber(download.lastProgress);
    }
    return () => {
        download.progressSubscribers.delete(subscriber);
    };
}

async function checkInstallableUpdate(
    branch: unknown,
    {
        hostPlatform = 'unknown',
        hostArch = 'unknown',
        linuxPackageKind = 'unknown'
    }: UpdateOptions = {}
): Promise<InstallableUpdateRelease | null> {
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
    return {
        ...release,
        ...update,
        body: update.body ?? release.body,
        canonicalVersion: release.canonicalVersion,
        displayVersion: release.displayVersion,
        displayName: release.displayName,
        publishedAt: release.publishedAt,
        tagName: release.tagName,
        htmlUrl: release.htmlUrl
    };
}

async function downloadAndInstallUpdate(
    release: NormalizedRelease,
    options: UpdateOptions = {}
): Promise<TauriUpdateMetadata> {
    if (updateInstallInFlight) {
        throw new Error('An update install is already in progress.');
    }
    const hostPlatform = options.hostPlatform || 'unknown';
    if (!release?.target) {
        throw new Error('Selected release has no Tauri updater target.');
    }

    updateInstallInFlight = (async () => {
        const pendingDownload = updateDownloadInFlight;
        if (pendingDownload?.version === release.canonicalVersion) {
            const unsubscribe = subscribeToInFlightDownload(
                pendingDownload,
                options
            );
            try {
                await pendingDownload.promise;
                return installPendingTauriUpdate(release.canonicalVersion);
            } finally {
                unsubscribe();
            }
        }

        const request = await buildTauriUpdaterRequest(
            release,
            hostPlatform,
            options.hostArch || 'unknown',
            options.linuxPackageKind || 'unknown'
        );
        const onEvent = createTauriDownloadEventHandler(options);

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

async function downloadUpdate(
    release: NormalizedRelease,
    options: UpdateOptions = {}
): Promise<TauriUpdateMetadata> {
    const version = release.canonicalVersion;
    if (!version) {
        throw new Error('Selected release has no canonical update version.');
    }
    if (updateDownloadInFlight) {
        if (updateDownloadInFlight.version === version) {
            const unsubscribe = subscribeToInFlightDownload(
                updateDownloadInFlight,
                options
            );
            try {
                return await updateDownloadInFlight.promise;
            } finally {
                unsubscribe();
            }
        }
        throw new Error('An update download is already in progress.');
    }
    const hostPlatform = options.hostPlatform || 'unknown';
    if (!release.target) {
        throw new Error('Selected release has no Tauri updater target.');
    }

    let inFlight: UpdateDownloadInFlight;
    const promise = (async () => {
        const request = await buildTauriUpdaterRequest(
            release,
            hostPlatform,
            options.hostArch || 'unknown',
            options.linuxPackageKind || 'unknown'
        );
        const update = await downloadTauriUpdate(
            version,
            request,
            createTauriDownloadEventHandler({}, (progress) =>
                publishInFlightDownloadProgress(inFlight, progress)
            )
        );
        if (!update) {
            throw new Error('No Tauri update is available.');
        }
        return update;
    })();

    inFlight = {
        version,
        promise,
        progressSubscribers: new Set(),
        lastProgress: null
    };
    updateDownloadInFlight = inFlight;
    const unsubscribe = subscribeToInFlightDownload(inFlight, options);
    try {
        return await promise;
    } finally {
        unsubscribe();
        if (updateDownloadInFlight?.promise === promise) {
            updateDownloadInFlight = null;
        }
    }
}

async function installPendingUpdate(
    version: string
): Promise<TauriUpdateMetadata> {
    return installPendingTauriUpdate(version);
}

async function discardPendingUpdate(): Promise<void> {
    await discardPendingTauriUpdate();
}

export {
    canInstallUpdatesOnPlatform,
    checkInstallableUpdate,
    defaultBranchForVersion,
    discardPendingUpdate,
    downloadUpdate,
    downloadAndInstallUpdate,
    fetchBranchReleases,
    fetchLatestBranchRelease,
    formatReleaseDisplayVersion,
    getPreviewStableReleaseUpdateMode,
    getUpdaterManifestAssetName,
    getUpdaterTarget,
    handlePreviewStableReleaseUpdateCheck,
    hasUpdateForBranch,
    installPendingUpdate,
    isNoPendingUpdateError,
    isPendingUpdateVersionMismatchError,
    normalizeGitHubRelease,
    normalizeReleaseList,
    sanitizeBranch
};
