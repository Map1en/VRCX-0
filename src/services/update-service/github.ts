import externalApiRepository from '@/repositories/externalApiRepository';
import { isPreviewBuildLabel } from '@/shared/buildLabel';
import { GITHUB_RELEASES_URL } from '@/shared/constants/settings';
import type { ReleaseChannel } from '@/shared/utils/releaseVersion';

import { normalizeReleaseList } from './release';
import type { NormalizedRelease } from './types';

type PreviewStableReleaseUpdateMode = {
    enabled: boolean;
};

export function getPreviewStableReleaseUpdateMode(): PreviewStableReleaseUpdateMode {
    return {
        enabled: isPreviewBuildLabel()
    };
}

export async function fetchBranchReleases(
    channel: ReleaseChannel
): Promise<NormalizedRelease[]> {
    const response = await externalApiRepository.fetchGithubReleases({
        url: GITHUB_RELEASES_URL,
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

    return normalizeReleaseList(channel, data);
}

export async function fetchLatestBranchRelease(
    channel: ReleaseChannel
): Promise<NormalizedRelease | null> {
    const releases = await fetchBranchReleases(channel);
    return releases[0] || null;
}
