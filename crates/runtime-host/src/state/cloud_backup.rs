use super::*;

use std::sync::Arc;

use crate::Error;
use url::Url;
use uuid::Uuid;
use vrcx_0_application::{
    commit_prepared_restore, create_backup_archive_with_progress, detect_backup_encryption,
    discard_prepared_cloud_restore, ensure_cloud_backup_disk_space, finalize_pending_cloud_restore,
    pending_restore_phase, prepare_restore_archive, request_pending_cloud_restore_rollback,
    BackupSummary, CloudBackupPasswordUpdate, CloudBackupProgress, CloudBackupRestoreProbe,
    CloudBackupSettings, CloudBackupSettingsInput, CloudBackupUploadInput, CredentialState,
    RemoteBackupStatus, RestorePreview, CLOUD_BACKUP_DEFAULT_DIRECTORY, CLOUD_BACKUP_FILE_NAME,
    MAX_BACKUP_ARCHIVE_BYTES,
};
use vrcx_0_host::credential_store::{
    delete_webdav_password, load_webdav_password, store_webdav_password, webdav_credential_key,
};
use vrcx_0_integrations::webdav::{RemoteFileInfo, WebDavClient};

const SERVER_URL_KEY: &str = "cloudBackupWebDavServerUrl";
const REMOTE_DIRECTORY_KEY: &str = "cloudBackupWebDavRemoteDirectory";
const USERNAME_KEY: &str = "cloudBackupWebDavUsername";
const WORK_ROOT: &str = "cloud-backup-work";

struct WorkspaceCleanup(std::path::PathBuf);

impl Drop for WorkspaceCleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

pub(super) fn cleanup_stale_cloud_backup_work(app_data: &std::path::Path) {
    let path = app_data.join(WORK_ROOT);
    if let Err(error) = std::fs::remove_dir_all(&path) {
        if error.kind() != std::io::ErrorKind::NotFound {
            tracing::warn!(error = %error, path = %path.display(), "failed to remove stale cloud backup workspace");
        }
    }
}

pub type CloudBackupProgressReporter = Arc<dyn Fn(CloudBackupProgress) + Send + Sync>;

#[derive(Clone)]
struct NormalizedSettings {
    server_url: String,
    remote_directory: String,
    username: String,
}

impl NormalizedSettings {
    fn base_url(&self) -> Result<Url> {
        Url::parse(&self.server_url)
            .map_err(|error| Error::Custom(format!("cloud_backup.invalid_url: {error}")))
    }

    fn credential_key(&self) -> String {
        webdav_credential_key(&self.server_url, &self.username)
    }

    fn directory_urls(&self) -> Result<Vec<Url>> {
        let mut current = self.base_url()?;
        let mut urls = Vec::new();
        for segment in self.remote_directory.split('/') {
            current
                .path_segments_mut()
                .map_err(|_| {
                    Error::Custom(
                        "cloud_backup.invalid_url: WebDAV URL cannot contain path segments.".into(),
                    )
                })?
                .pop_if_empty()
                .push(segment)
                .push("");
            urls.push(current.clone());
        }
        Ok(urls)
    }

    fn final_url(&self) -> Result<Url> {
        let directory = self.directory_urls()?.pop().ok_or_else(|| {
            Error::Custom("cloud_backup.invalid_directory: Empty directory.".into())
        })?;
        directory
            .join(CLOUD_BACKUP_FILE_NAME)
            .map_err(|error| Error::Custom(format!("cloud_backup.invalid_url: {error}")))
    }
}

fn normalize_server_url(value: &str) -> Result<String> {
    let mut url = Url::parse(value.trim())
        .map_err(|error| Error::Custom(format!("cloud_backup.invalid_url: {error}")))?;
    if url.scheme() != "https" {
        return Err(Error::Custom(
            "cloud_backup.invalid_url: WebDAV server URL must use HTTPS.".into(),
        ));
    }
    if url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(Error::Custom(
            "cloud_backup.invalid_url: URL must not contain credentials, a query, or a fragment."
                .into(),
        ));
    }
    if !url.path().ends_with('/') {
        let next_path = format!("{}/", url.path());
        url.set_path(&next_path);
    }
    Ok(url.to_string())
}

fn normalize_remote_directory(value: &str) -> Result<String> {
    let value = value.trim().trim_matches('/');
    let value = if value.is_empty() {
        CLOUD_BACKUP_DEFAULT_DIRECTORY
    } else {
        value
    };
    let segments = value.split('/').map(str::trim).collect::<Vec<_>>();
    if segments.iter().any(|segment| {
        segment.is_empty()
            || matches!(*segment, "." | "..")
            || segment
                .chars()
                .any(|ch| ch.is_control() || matches!(ch, '\\' | '?' | '#'))
    }) {
        return Err(Error::Custom(
            "cloud_backup.invalid_directory: Remote directory contains an invalid segment.".into(),
        ));
    }
    Ok(segments.join("/"))
}

fn normalize_username(value: &str) -> Result<String> {
    let value = value.trim();
    if value.is_empty() {
        return Err(Error::Custom(
            "cloud_backup.invalid_username: WebDAV username is required.".into(),
        ));
    }
    Ok(value.to_string())
}

fn progress(reporter: &CloudBackupProgressReporter, phase: &str) {
    reporter(CloudBackupProgress {
        phase: phase.into(),
    });
}

fn map_remote(info: RemoteFileInfo) -> RemoteBackupStatus {
    RemoteBackupStatus {
        exists: info.exists,
        content_length: info.content_length,
        last_modified: info.last_modified,
    }
}

impl RuntimeHostState {
    fn cloud_backup_operation_guard(&self) -> Result<tokio::sync::MutexGuard<'_, ()>> {
        self.cloud_backup_operation_lock.try_lock().map_err(|_| {
            Error::Custom(
                "cloud_backup.operation_busy: Another cloud backup operation is running.".into(),
            )
        })
    }

    fn normalized_cloud_backup_settings(&self) -> Result<NormalizedSettings> {
        Ok(NormalizedSettings {
            server_url: normalize_server_url(
                &self
                    .runtime_context
                    .config()
                    .get_string(SERVER_URL_KEY, "")?,
            )?,
            remote_directory: normalize_remote_directory(
                &self
                    .runtime_context
                    .config()
                    .get_string(REMOTE_DIRECTORY_KEY, CLOUD_BACKUP_DEFAULT_DIRECTORY)?,
            )?,
            username: normalize_username(
                &self.runtime_context.config().get_string(USERNAME_KEY, "")?,
            )?,
        })
    }

    fn raw_cloud_backup_settings(&self) -> Result<NormalizedSettings> {
        let raw_server = self
            .runtime_context
            .config()
            .get_string(SERVER_URL_KEY, "")?;
        let raw_directory = self
            .runtime_context
            .config()
            .get_string(REMOTE_DIRECTORY_KEY, CLOUD_BACKUP_DEFAULT_DIRECTORY)?;
        let raw_username = self.runtime_context.config().get_string(USERNAME_KEY, "")?;
        Ok(NormalizedSettings {
            server_url: raw_server.trim().to_string(),
            remote_directory: if raw_directory.trim().is_empty() {
                CLOUD_BACKUP_DEFAULT_DIRECTORY.into()
            } else {
                raw_directory.trim().to_string()
            },
            username: raw_username.trim().to_string(),
        })
    }

    fn session_password(&self, key: &str) -> Option<String> {
        self.cloud_backup_session_password
            .lock()
            .ok()
            .and_then(|entry| {
                entry
                    .as_ref()
                    .filter(|(stored_key, _)| stored_key == key)
                    .cloned()
            })
            .map(|(_, password)| password)
    }

    fn credential_state(&self, settings: &NormalizedSettings) -> CredentialState {
        if settings.server_url.is_empty() || settings.username.is_empty() {
            return CredentialState {
                available: true,
                stored: false,
                session_only: false,
            };
        }
        let key = settings.credential_key();
        match load_webdav_password(&key) {
            Ok(password) => CredentialState {
                available: true,
                stored: password.is_some(),
                session_only: false,
            },
            Err(_) => CredentialState {
                available: false,
                stored: false,
                session_only: self.session_password(&key).is_some(),
            },
        }
    }

    fn resolve_cloud_backup_password(&self, settings: &NormalizedSettings) -> Result<String> {
        let key = settings.credential_key();
        match load_webdav_password(&key) {
            Ok(Some(password)) => Ok(password),
            Ok(None) => self.session_password(&key).ok_or_else(|| {
                Error::Custom("cloud_backup.password_missing: WebDAV password is not saved.".into())
            }),
            Err(_) => self.session_password(&key).ok_or_else(|| {
                Error::Custom(
                    "cloud_backup.credential_store_unavailable: System credential store is unavailable and no session password exists."
                        .into(),
                )
            }),
        }
    }

    fn webdav_client(&self, settings: &NormalizedSettings) -> Result<WebDavClient> {
        let base_url = settings.base_url()?;
        let password = self.resolve_cloud_backup_password(settings)?;
        WebDavClient::new(
            &base_url,
            settings.username.clone(),
            password,
            self.web.proxy_url(),
            &format!("VRCX-0/{}", self.app_version),
        )
        .map_err(|error| Error::Custom(error.to_string()))
    }

    fn clear_cloud_backup_credential_key(&self, key: &str) -> Result<()> {
        let had_session_password = self.session_password(key).is_some();
        let deletion = delete_webdav_password(key);
        if let Ok(mut entry) = self.cloud_backup_session_password.lock() {
            if entry
                .as_ref()
                .is_some_and(|(stored_key, _)| stored_key == key)
            {
                *entry = None;
            }
        }
        if let Err(error) = deletion {
            tracing::warn!(error = %error, "system credential store unavailable while clearing the WebDAV credential");
            if !had_session_password {
                return Err(Error::Custom(
                    "cloud_backup.credential_clear_failed: The system credential store could not clear the WebDAV password."
                        .into(),
                ));
            }
        }
        Ok(())
    }

    async fn ensure_cloud_backup_directory(
        &self,
        client: &WebDavClient,
        settings: &NormalizedSettings,
    ) -> Result<()> {
        for directory in settings.directory_urls()? {
            client
                .mkcol(&directory)
                .await
                .map_err(|error| Error::Custom(error.to_string()))?;
        }
        Ok(())
    }

    pub fn cloud_backup_settings_get(&self) -> Result<CloudBackupSettings> {
        let settings = self.raw_cloud_backup_settings()?;
        Ok(CloudBackupSettings {
            server_url: settings.server_url.clone(),
            remote_directory: settings.remote_directory.clone(),
            username: settings.username.clone(),
            credential: self.credential_state(&settings),
            pending_restore_phase: pending_restore_phase(&self.paths.app_data)?,
        })
    }

    pub fn cloud_backup_settings_save(
        &self,
        input: CloudBackupSettingsInput,
    ) -> Result<CloudBackupSettings> {
        let previous = self.raw_cloud_backup_settings()?;
        let settings = NormalizedSettings {
            server_url: normalize_server_url(&input.server_url)?,
            remote_directory: normalize_remote_directory(&input.remote_directory)?,
            username: normalize_username(&input.username)?,
        };
        let previous_key = (!previous.server_url.is_empty() && !previous.username.is_empty())
            .then(|| previous.credential_key());
        let key = settings.credential_key();
        if let Some(previous_key) = previous_key
            .as_deref()
            .filter(|previous_key| *previous_key != key)
        {
            self.clear_cloud_backup_credential_key(previous_key)?;
        }
        match input.password_update {
            CloudBackupPasswordUpdate::Keep => {
                if previous_key.as_deref() != Some(&key) {
                    if let Some((stored_key, _)) = self
                        .cloud_backup_session_password
                        .lock()
                        .ok()
                        .and_then(|entry| entry.clone())
                    {
                        if stored_key != key {
                            if let Ok(mut entry) = self.cloud_backup_session_password.lock() {
                                *entry = None;
                            }
                        }
                    }
                }
            }
            CloudBackupPasswordUpdate::Set { password } => {
                if password.is_empty() {
                    return Err(Error::Custom(
                        "cloud_backup.password_empty: WebDAV password is empty.".into(),
                    ));
                }
                match store_webdav_password(&key, &password) {
                    Ok(()) => {
                        if let Ok(mut entry) = self.cloud_backup_session_password.lock() {
                            *entry = None;
                        }
                    }
                    Err(error) => {
                        tracing::warn!(error = %error, "system credential store unavailable; keeping WebDAV password for this process only");
                        if let Ok(mut entry) = self.cloud_backup_session_password.lock() {
                            *entry = Some((key.clone(), password));
                        }
                    }
                }
            }
        }
        let config = self.runtime_context.config();
        config.set_string(SERVER_URL_KEY, &settings.server_url)?;
        config.set_string(REMOTE_DIRECTORY_KEY, &settings.remote_directory)?;
        config.set_string(USERNAME_KEY, &settings.username)?;
        self.cloud_backup_settings_get()
    }

    pub fn cloud_backup_credential_clear(&self) -> Result<CloudBackupSettings> {
        let settings = self.normalized_cloud_backup_settings()?;
        let credential_key = settings.credential_key();
        self.clear_cloud_backup_credential_key(&credential_key)?;
        self.cloud_backup_settings_get()
    }

    pub async fn cloud_backup_connection_test(&self) -> Result<()> {
        let _guard = self.cloud_backup_operation_guard()?;
        let settings = self.normalized_cloud_backup_settings()?;
        let client = self.webdav_client(&settings)?;
        client
            .test_connection(&settings.base_url()?)
            .await
            .map_err(|error| Error::Custom(error.to_string()))?;
        Ok(())
    }

    pub async fn cloud_backup_remote_status(&self) -> Result<RemoteBackupStatus> {
        let _guard = self.cloud_backup_operation_guard()?;
        let settings = self.normalized_cloud_backup_settings()?;
        let client = self.webdav_client(&settings)?;
        let info = client
            .propfind(&settings.final_url()?)
            .await
            .map_err(|error| Error::Custom(error.to_string()))?;
        Ok(map_remote(info))
    }

    pub async fn cloud_backup_upload(
        &self,
        input: CloudBackupUploadInput,
        reporter: CloudBackupProgressReporter,
    ) -> Result<BackupSummary> {
        let _guard = self.cloud_backup_operation_guard()?;
        if pending_restore_phase(&self.paths.app_data)?.is_some() {
            return Err(Error::Custom(
                "cloud_backup.restore_pending: A restore is awaiting finalization or rollback."
                    .into(),
            ));
        }
        let passphrase = input.backup_passphrase.filter(|value| !value.is_empty());
        if passphrase.is_none() && !input.confirm_unencrypted {
            return Err(Error::Custom(
                "cloud_backup.unencrypted_confirmation_required: Unencrypted upload was not confirmed."
                    .into(),
            ));
        }
        let settings = self.normalized_cloud_backup_settings()?;
        let client = self.webdav_client(&settings)?;
        let operation_id = Uuid::new_v4().hyphenated().to_string();
        progress(&reporter, "connect");
        client
            .test_connection(&settings.base_url()?)
            .await
            .map_err(|error| Error::Custom(error.to_string()))?;
        let workspace = self.paths.app_data.join(WORK_ROOT).join(&operation_id);
        std::fs::create_dir_all(&workspace)?;
        let _workspace_cleanup = WorkspaceCleanup(workspace.clone());
        let db = Arc::clone(&self.db);
        let config_json = self.storage.snapshot_json()?;
        let app_version = self.app_version.clone();
        let package_workspace = workspace.clone();
        let package_reporter = Arc::clone(&reporter);
        let created_result = tokio::task::spawn_blocking(move || {
            create_backup_archive_with_progress(
                &db,
                &config_json,
                &app_version,
                &package_workspace,
                passphrase.as_deref(),
                |phase| {
                    progress(&package_reporter, phase);
                },
            )
        })
        .await
        .map_err(|error| Error::Custom(format!("cloud_backup.archive_failed: {error}")))?;
        let created = match created_result {
            Ok(created) => created,
            Err(error) => {
                return Err(error.into());
            }
        };

        progress(&reporter, "upload");
        self.ensure_cloud_backup_directory(&client, &settings)
            .await?;
        let final_url = settings.final_url()?;
        let temp_url = final_url
            .join(&format!(".upload-{operation_id}.tmp"))
            .map_err(|error| Error::Custom(format!("cloud_backup.invalid_url: {error}")))?;
        let upload_result = async {
            client
                .put_file(&temp_url, &created.path)
                .await
                .map_err(|error| Error::Custom(error.to_string()))?;
            client
                .move_resource(&temp_url, &final_url)
                .await
                .map_err(|error| Error::Custom(error.to_string()))
        }
        .await;
        if upload_result.is_err() {
            let _ = client.delete(&temp_url).await;
        }
        upload_result?;
        progress(&reporter, "completed");
        Ok(created.summary)
    }

    pub async fn cloud_backup_restore_probe(&self) -> Result<CloudBackupRestoreProbe> {
        let _guard = self.cloud_backup_operation_guard()?;
        let settings = self.normalized_cloud_backup_settings()?;
        let client = self.webdav_client(&settings)?;
        let final_url = settings.final_url()?;
        let remote = map_remote(
            client
                .propfind(&final_url)
                .await
                .map_err(|error| Error::Custom(error.to_string()))?,
        );
        if !remote.exists {
            return Err(Error::Custom(
                "cloud_backup.remote_missing: No remote backup exists.".into(),
            ));
        }
        let prefix = client
            .get_prefix(&final_url, 32)
            .await
            .map_err(|error| Error::Custom(error.to_string()))?;
        Ok(CloudBackupRestoreProbe {
            encrypted: detect_backup_encryption(&prefix)?,
            remote,
        })
    }

    pub async fn cloud_backup_restore_prepare(
        &self,
        input: vrcx_0_application::CloudBackupRestorePrepareInput,
        reporter: CloudBackupProgressReporter,
    ) -> Result<RestorePreview> {
        let _guard = self.cloud_backup_operation_guard()?;
        if pending_restore_phase(&self.paths.app_data)?.is_some() {
            return Err(Error::Custom(
                "cloud_backup.restore_pending: A restore is awaiting finalization or rollback."
                    .into(),
            ));
        }
        let operation_id = Uuid::new_v4().hyphenated().to_string();
        let workspace = self.paths.app_data.join(WORK_ROOT).join(&operation_id);
        std::fs::create_dir_all(&workspace)?;
        let _workspace_cleanup = WorkspaceCleanup(workspace.clone());
        let archive_path = workspace.join(CLOUD_BACKUP_FILE_NAME);
        let settings = self.normalized_cloud_backup_settings()?;
        let client = self.webdav_client(&settings)?;
        let remote = client
            .propfind(&settings.final_url()?)
            .await
            .map_err(|error| Error::Custom(error.to_string()))?;
        if !remote.exists {
            return Err(Error::Custom(
                "cloud_backup.remote_missing: No remote backup exists.".into(),
            ));
        }
        if let Some(content_length) = remote.content_length {
            if content_length > MAX_BACKUP_ARCHIVE_BYTES {
                return Err(Error::Custom(
                    "cloud_backup.archive_too_large: The remote backup exceeds its size limit."
                        .into(),
                ));
            }
            ensure_cloud_backup_disk_space(&workspace, content_length)?;
        }
        progress(&reporter, "download");
        if let Err(error) = client
            .get_to_file(
                &settings.final_url()?,
                &archive_path,
                MAX_BACKUP_ARCHIVE_BYTES,
            )
            .await
        {
            return Err(Error::Custom(error.to_string()));
        }
        progress(&reporter, "validate");
        let app_data = self.paths.app_data.clone();
        let passphrase = input.backup_passphrase.filter(|value| !value.is_empty());
        progress(&reporter, "staging");
        let prepared = tokio::task::spawn_blocking(move || {
            prepare_restore_archive(&archive_path, &app_data, passphrase.as_deref())
        })
        .await
        .map_err(|error| Error::Custom(format!("cloud_backup.restore_failed: {error}")))?;
        let preview = prepared?;
        progress(&reporter, "prepared");
        Ok(preview)
    }

    pub async fn cloud_backup_restore_commit(
        &self,
        restore_id: String,
        reporter: CloudBackupProgressReporter,
    ) -> Result<()> {
        let _guard = self.cloud_backup_operation_guard()?;
        progress(&reporter, "rollbackSnapshot");
        let db = Arc::clone(&self.db);
        let config_json = self.storage.snapshot_json()?;
        let app_data = self.paths.app_data.clone();
        tokio::task::spawn_blocking(move || {
            commit_prepared_restore(&db, &config_json, &app_data, &restore_id)
        })
        .await
        .map_err(|error| Error::Custom(format!("cloud_backup.restore_failed: {error}")))??;
        progress(&reporter, "restartRequired");
        Ok(())
    }

    pub fn cloud_backup_restore_discard(&self, restore_id: &str) -> Result<bool> {
        let _guard = self.cloud_backup_operation_guard()?;
        Ok(discard_prepared_cloud_restore(
            &self.paths.app_data,
            restore_id,
        )?)
    }

    pub fn cloud_backup_restore_finalize(&self) -> Result<bool> {
        let _guard = self.cloud_backup_operation_guard()?;
        Ok(finalize_pending_cloud_restore(&self.paths.app_data)?)
    }

    pub fn cloud_backup_restore_rollback_request(&self) -> Result<bool> {
        let _guard = self.cloud_backup_operation_guard()?;
        Ok(request_pending_cloud_restore_rollback(
            &self.paths.app_data,
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webdav_paths_remain_https_and_under_the_configured_base() {
        let settings = NormalizedSettings {
            server_url: normalize_server_url("https://dav.example.test/remote.php/dav/files/alice")
                .unwrap(),
            remote_directory: normalize_remote_directory("VRCX-0/backups").unwrap(),
            username: "alice".into(),
        };
        let final_url = settings.final_url().unwrap();
        assert_eq!(final_url.scheme(), "https");
        assert_eq!(final_url.host_str(), Some("dav.example.test"));
        assert_eq!(
            final_url.path(),
            "/remote.php/dav/files/alice/VRCX-0/backups/latest.vrcx0backup"
        );
        let temporary = final_url.join(".upload-test.tmp").unwrap();
        assert_eq!(temporary.origin(), final_url.origin());
        assert!(temporary.path().ends_with("/backups/.upload-test.tmp"));
    }

    #[test]
    fn webdav_settings_reject_insecure_or_embedded_credentials() {
        assert!(normalize_server_url("http://dav.example.test/").is_err());
        assert!(normalize_server_url("https://alice:secret@dav.example.test/").is_err());
        assert!(normalize_remote_directory("../outside").is_err());
    }
}
