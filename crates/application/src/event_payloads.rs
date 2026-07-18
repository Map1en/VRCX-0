use vrcx_0_application_core::RuntimeEventPayload;

use crate::{
    AppUpdateDownloadProgressPayload, AppUpdateInstalledPayload, AppUpdateStatusSnapshot,
    AuthenticatedRuntimePhaseSnapshot, FavoriteImportStatus, NoteExportStatus, ProfileBackupStatus,
    ProfileRestoreProgress, SharedCollectionImportStatus,
};

impl RuntimeEventPayload for AuthenticatedRuntimePhaseSnapshot {
    const EVENT_NAME: &'static str = "authenticatedRuntimePhase";
}

impl RuntimeEventPayload for AppUpdateStatusSnapshot {
    const EVENT_NAME: &'static str = "appUpdateStatus";
}

impl RuntimeEventPayload for AppUpdateDownloadProgressPayload {
    const EVENT_NAME: &'static str = "appUpdateDownloadProgress";
}

impl RuntimeEventPayload for AppUpdateInstalledPayload {
    const EVENT_NAME: &'static str = "appUpdateInstalled";
}

impl RuntimeEventPayload for ProfileBackupStatus {
    const EVENT_NAME: &'static str = "profileBackupStatus";
}

impl RuntimeEventPayload for ProfileRestoreProgress {
    const EVENT_NAME: &'static str = "profileRestoreProgress";
}

impl RuntimeEventPayload for FavoriteImportStatus {
    const EVENT_NAME: &'static str = "favoriteImportStatus";
}

impl RuntimeEventPayload for SharedCollectionImportStatus {
    const EVENT_NAME: &'static str = "sharedCollectionImportStatus";
}

impl RuntimeEventPayload for NoteExportStatus {
    const EVENT_NAME: &'static str = "noteExportStatus";
}
