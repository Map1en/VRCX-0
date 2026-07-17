export type {
    NormalizedRelease,
    UpdateDownloadProgress,
    UpdateOptions
} from './update-service/types';

export type {
    AppUpdateReleaseSnapshot,
    AppUpdateStatusSnapshot
} from './update-service/appUpdateSnapshot';
export { toNormalizedReleaseFromSnapshot } from './update-service/appUpdateSnapshot';

export {
    canInstallUpdatesOnPlatform,
    sanitizeBranch
} from './update-service/release';
export {
    fetchBranchReleases,
    fetchLatestBranchRelease,
    getPreviewStableReleaseUpdateMode
} from './update-service/github';
export type {
    AppUpdateDownloadProgressPayload,
    AppUpdateDownloadStatusSnapshot,
    AppUpdateInstalledPayload,
    UpdaterMetadata
} from './update-service/downloadInstall';
export {
    confirmInstall,
    getDownloadStatus
} from './update-service/downloadInstall';
export { formatReleaseDisplayVersion } from '@/shared/utils/releaseVersion';
