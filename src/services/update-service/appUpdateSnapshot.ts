import type {
    AppUpdateReleaseSnapshot,
    AppUpdateStatusSnapshot
} from '@/platform/tauri/bindings';

import type { NormalizedRelease } from './types';

export type { AppUpdateReleaseSnapshot, AppUpdateStatusSnapshot };

export function toNormalizedReleaseFromSnapshot(
    release: AppUpdateReleaseSnapshot | null
): NormalizedRelease | null {
    if (!release) {
        return null;
    }

    return {
        manifestUrl: release.manifestUrl || undefined,
        target: release.target || undefined,
        canonicalVersion: release.canonicalVersion,
        channel: release.channel,
        displayVersion: release.displayVersion,
        htmlUrl: release.htmlUrl,
        tagName: release.tagName,
        displayName: release.displayName,
        publishedAt: release.publishedAt,
        body: release.body,
        updaterType: release.updaterType === 'tauri' ? 'tauri' : 'manual'
    };
}
