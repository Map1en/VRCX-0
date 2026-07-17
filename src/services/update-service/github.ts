import externalApiRepository from '@/repositories/externalApiRepository';
import { isPreviewBuildLabel } from '@/shared/buildLabel';
import { branches } from '@/shared/constants/settings';

import { normalizeReleaseList, sanitizeBranch } from './release';
import type { NormalizedRelease, UpdateOptions } from './types';

type PreviewStableReleaseUpdateMode = {
    enabled: boolean;
};

export function getPreviewStableReleaseUpdateMode(): PreviewStableReleaseUpdateMode {
    return {
        enabled: isPreviewBuildLabel()
    };
}

export async function fetchBranchReleases(
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

export async function fetchLatestBranchRelease(
    branch: unknown,
    options: UpdateOptions = {}
): Promise<NormalizedRelease | null> {
    const releases = await fetchBranchReleases(branch, options);
    return releases[0] || null;
}
