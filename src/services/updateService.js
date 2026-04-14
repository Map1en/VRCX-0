import { backend } from '@/platform/index.js';
import { webRepository } from '@/repositories/index.js';
import { branches } from '@/shared/constants/settings.js';
import {
    compareReleaseVersions,
    formatReleaseDisplayVersion,
    isBetaReleaseVersion,
    parseReleaseVersion
} from '@/shared/utils/releaseVersion.js';

const UPDATE_PROGRESS_COMPLETE = 101;
const UPDATE_PROGRESS_ERROR = -1;
let updateDownloadInFlight = null;

function getAssetOfInterest(assets = []) {
    for (const asset of assets) {
        if (asset?.state !== 'uploaded') {
            continue;
        }
        if (
            asset.name?.endsWith('.exe') &&
            (asset.content_type === 'application/x-msdownload' ||
                asset.content_type === 'application/x-msdos-program')
        ) {
            return {
                downloadUrl: asset.browser_download_url || '',
                hashString: asset.digest?.startsWith('sha256:')
                    ? asset.digest.replace('sha256:', '')
                    : '',
                size: Number(asset.size) || 0
            };
        }
    }

    return { downloadUrl: '', hashString: '', size: 0 };
}

function normalizeGitHubRelease(release) {
    const parsedVersion = parseReleaseVersion(release?.tag_name);
    if (!parsedVersion) {
        return null;
    }

    const asset = getAssetOfInterest(release.assets);
    if (!asset.downloadUrl) {
        return null;
    }

    return {
        ...asset,
        canonicalVersion: parsedVersion.canonicalVersion,
        displayVersion: parsedVersion.displayVersion,
        tagName: release.tag_name,
        displayName: release.name || `VRCX-0 ${parsedVersion.displayVersion}`,
        prerelease: Boolean(release.prerelease),
        publishedAt: release.published_at || '',
        body: release.body || ''
    };
}

function normalizeReleaseList(branch, releases) {
    const shouldKeepPrerelease = branch === 'Beta';
    return (Array.isArray(releases) ? releases : [releases])
        .map((release) => normalizeGitHubRelease(release))
        .filter((release) => release && release.prerelease === shouldKeepPrerelease)
        .sort((left, right) =>
            compareReleaseVersions(right.canonicalVersion, left.canonicalVersion)
        );
}

function sanitizeBranch(branch) {
    return branch === 'Beta' ? 'Beta' : 'Stable';
}

function defaultBranchForVersion(version = VERSION || '') {
    return isBetaReleaseVersion(version) ? 'Beta' : 'Stable';
}

function hasUpdateForBranch(branch, currentVersion, latestReleaseVersion) {
    const currentParsed = parseReleaseVersion(currentVersion);
    const latestParsed = parseReleaseVersion(latestReleaseVersion);

    if (!currentParsed || !latestParsed) {
        return false;
    }

    if (branch === 'Beta') {
        const dateDelta =
            latestParsed.year - currentParsed.year ||
            latestParsed.month - currentParsed.month ||
            latestParsed.day - currentParsed.day;
        if (dateDelta !== 0) {
            return dateDelta > 0;
        }

        if (currentParsed.channel === 'Stable' && latestParsed.channel === 'Beta') {
            return true;
        }
    }

    return compareReleaseVersions(latestParsed.canonicalVersion, currentParsed) > 0;
}

async function fetchBranchReleases(branch) {
    const normalizedBranch = sanitizeBranch(branch);
    const response = await webRepository.execute({
        url: branches[normalizedBranch].urlReleases,
        method: 'GET',
        headers: {
            Accept: 'application/vnd.github+json'
        }
    });
    if (response.status && response.status !== 200) {
        throw new Error(`GitHub release request failed (${response.status}).`);
    }

    const data = typeof response.data === 'string'
        ? JSON.parse(response.data)
        : response.data;
    if (data?.message) {
        throw new Error(data.message);
    }

    return normalizeReleaseList(normalizedBranch, data);
}

async function fetchLatestBranchRelease(branch) {
    const releases = await fetchBranchReleases(branch);
    return releases[0] || null;
}

async function waitForUpdateDownload({
    onProgress,
    isCancelled,
    pollMs = 150,
    timeoutMs = 30 * 60 * 1000
} = {}) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
        if (isCancelled?.()) {
            await backend.app.CancelUpdate().catch(() => {});
            throw new Error('Update download cancelled.');
        }

        const progress = Number(await backend.app.CheckUpdateProgress().catch(() => 0)) || 0;
        if (progress === UPDATE_PROGRESS_ERROR) {
            throw new Error('Update download failed.');
        }

        onProgress?.(Math.max(0, Math.min(100, progress)));
        if (progress >= UPDATE_PROGRESS_COMPLETE) {
            const ready = await backend.app.CheckForUpdateExe().catch(() => false);
            if (ready) {
                onProgress?.(100);
                return true;
            }
        }

        await new Promise((resolve) => window.setTimeout(resolve, pollMs));
    }

    throw new Error('Update download timed out.');
}

async function downloadUpdateAndWait(release, options = {}) {
    if (updateDownloadInFlight) {
        throw new Error('An update download is already in progress.');
    }
    if (!release?.downloadUrl) {
        throw new Error('Selected release has no downloadable installer.');
    }

    updateDownloadInFlight = (async () => {
        await backend.app.DownloadUpdate(
            release.downloadUrl,
            release.hashString || '',
            Number(release.size) || 0
        );
        await waitForUpdateDownload(options);
        return release;
    })();

    try {
        return await updateDownloadInFlight;
    } finally {
        updateDownloadInFlight = null;
    }
}

function isUpdateDownloadInFlight() {
    return Boolean(updateDownloadInFlight);
}

export {
    UPDATE_PROGRESS_COMPLETE,
    UPDATE_PROGRESS_ERROR,
    defaultBranchForVersion,
    downloadUpdateAndWait,
    fetchBranchReleases,
    fetchLatestBranchRelease,
    formatReleaseDisplayVersion,
    getAssetOfInterest,
    hasUpdateForBranch,
    isUpdateDownloadInFlight,
    normalizeGitHubRelease,
    normalizeReleaseList,
    sanitizeBranch,
    waitForUpdateDownload
};
