import { isRecord } from '@/shared/utils/record';
import {
    compareReleaseVersions,
    parseReleaseVersion,
    type ReleaseChannel
} from '@/shared/utils/releaseVersion';

import type { GitHubRelease, NormalizedRelease } from './types';

function asGitHubRelease(value: unknown): GitHubRelease {
    return isRecord(value) ? value : {};
}

export function normalizeGitHubRelease(
    release: GitHubRelease
): NormalizedRelease | null {
    const parsedVersion = parseReleaseVersion(String(release?.tag_name || ''));
    if (!parsedVersion) {
        return null;
    }
    if (Boolean(release.prerelease) !== (parsedVersion.channel === 'beta')) {
        return null;
    }

    return {
        canonicalVersion: parsedVersion.canonicalVersion,
        channel: parsedVersion.channel,
        displayVersion: parsedVersion.displayVersion,
        htmlUrl: release.html_url || '',
        tagName: release.tag_name || '',
        displayName: release.name || `VRCX-0 ${parsedVersion.displayVersion}`,
        publishedAt: release.published_at || '',
        body: release.body || '',
        updaterType: 'manual'
    };
}

export function normalizeReleaseList(
    channel: ReleaseChannel,
    releases: unknown
): NormalizedRelease[] {
    return (Array.isArray(releases) ? releases : [releases])
        .map((release) => normalizeGitHubRelease(asGitHubRelease(release)))
        .filter(
            (release): release is NormalizedRelease =>
                release !== null && release.channel === channel
        )
        .sort((left, right) =>
            compareReleaseVersions(
                right.canonicalVersion,
                left.canonicalVersion
            )
        );
}
