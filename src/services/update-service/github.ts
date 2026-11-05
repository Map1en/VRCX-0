import { commands } from '@/platform/tauri/bindings';
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

const GITHUB_RELEASES_PER_PAGE = 30;

type BranchReleasePage = {
    releases: NormalizedRelease[];
    hasMore: boolean;
};

export async function fetchBranchReleasePage(
    channel: ReleaseChannel,
    page: number
): Promise<BranchReleasePage> {
    const response = await commands.appExternalApiGithubReleasesGet({
        url: `${GITHUB_RELEASES_URL}?per_page=${GITHUB_RELEASES_PER_PAGE}&page=${page}`,
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

    return {
        releases: normalizeReleaseList(channel, data),
        hasMore: Array.isArray(data) && data.length >= GITHUB_RELEASES_PER_PAGE
    };
}
