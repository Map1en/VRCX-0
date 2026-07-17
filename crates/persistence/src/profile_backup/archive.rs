use std::fmt::Write as _;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read};
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};
use tar::{Builder, EntryType, Header};

use crate::Error;

use super::{
    ProfileBackupContent, ProfileBackupManifest, ProfileBackupManifestMetadata, DATABASE_FILE_NAME,
    MANIFEST_FILE_NAME, MAX_PROFILE_DATABASE_BYTES,
};

const MANIFEST_VERSION: u32 = 1;
const AUTO_BACKUP_PREFIX: &str = "VRCX-0-backup-auto-";
const BACKUP_SUFFIX: &str = ".vrcx0backup";

pub fn create_backup_archive(
    snapshot: &Path,
    archive: &Path,
    metadata: ProfileBackupManifestMetadata,
) -> Result<ProfileBackupManifest, Error> {
    create_backup_archive_with_progress(snapshot, archive, metadata, 0, &mut |_, _| {})
}

pub fn create_backup_archive_with_progress(
    snapshot: &Path,
    archive: &Path,
    metadata: ProfileBackupManifestMetadata,
    compression_workers: u32,
    progress: &mut dyn FnMut(u64, u64),
) -> Result<ProfileBackupManifest, Error> {
    let path_metadata = fs::metadata(snapshot)?;
    if !path_metadata.file_type().is_file() {
        return Err(Error::InvalidData(
            "The profile backup snapshot is not a regular file.".into(),
        ));
    }
    let mut snapshot_file = File::open(snapshot)?;
    let snapshot_metadata = snapshot_file.metadata()?;
    if !snapshot_metadata.file_type().is_file() {
        return Err(Error::InvalidData(
            "The profile backup snapshot is not a regular file.".into(),
        ));
    }
    let initial_len = snapshot_metadata.len();
    if initial_len > MAX_PROFILE_DATABASE_BYTES {
        return Err(Error::InvalidData(
            "The profile backup snapshot exceeds the size limit.".into(),
        ));
    }
    if let Some(parent) = archive.parent() {
        fs::create_dir_all(parent)?;
    }
    if archive.exists() {
        fs::remove_file(archive)?;
    }

    let mut open_options = OpenOptions::new();
    open_options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        open_options.mode(0o600);
    }
    let archive_file = open_options.open(archive)?;
    let mut encoder = zstd::Encoder::new(archive_file, 5)?;
    if compression_workers > 0 {
        if let Err(error) = encoder.multithread(compression_workers) {
            tracing::warn!(
                "Failed to enable multithreaded profile backup compression; falling back to one thread: {error}"
            );
        }
    }
    let mut builder = Builder::new(encoder);
    let mut database_header = regular_tar_header(initial_len);
    let mut snapshot_reader = SnapshotArchiveReader::new(&mut snapshot_file, initial_len, progress);
    let append_result = builder.append_data(
        &mut database_header,
        DATABASE_FILE_NAME,
        &mut snapshot_reader,
    );
    if let Some(error) = snapshot_reader.take_failure() {
        return Err(error);
    }
    append_result?;
    let (hasher, bytes) = snapshot_reader.finish()?;

    let manifest = ProfileBackupManifest {
        manifest_version: MANIFEST_VERSION,
        app_version: metadata.app_version,
        db_version: metadata.db_version,
        created_at: metadata.created_at,
        platform: metadata.platform,
        kind: metadata.kind,
        contents: vec![ProfileBackupContent {
            path: DATABASE_FILE_NAME.into(),
            sha256: sha256_hex(hasher.finalize()),
            bytes,
        }],
    };

    let manifest_bytes = serde_json::to_vec_pretty(&manifest)?;
    let mut manifest_header = regular_tar_header(manifest_bytes.len() as u64);
    builder.append_data(
        &mut manifest_header,
        MANIFEST_FILE_NAME,
        manifest_bytes.as_slice(),
    )?;
    let encoder = builder.into_inner()?;
    let archive_file = encoder.finish()?;
    archive_file.sync_all()?;
    Ok(manifest)
}

fn regular_tar_header(size: u64) -> Header {
    let mut header = Header::new_gnu();
    header.set_size(size);
    header.set_entry_type(EntryType::Regular);
    header.set_mode(0o600);
    header.set_mtime(0);
    header.set_cksum();
    header
}

struct SnapshotArchiveReader<'a> {
    file: &'a mut File,
    remaining: u64,
    bytes: u64,
    hasher: Sha256,
    progress: &'a mut dyn FnMut(u64, u64),
    total: u64,
    failure: Option<SnapshotReadFailure>,
}

impl<'a> SnapshotArchiveReader<'a> {
    fn new(file: &'a mut File, total: u64, progress: &'a mut dyn FnMut(u64, u64)) -> Self {
        Self {
            file,
            remaining: total,
            bytes: 0,
            hasher: Sha256::new(),
            progress,
            total,
            failure: None,
        }
    }

    fn take_failure(&mut self) -> Option<Error> {
        self.failure.take().map(|failure| match failure {
            SnapshotReadFailure::Changed => snapshot_changed_error(),
            SnapshotReadFailure::Invalid => {
                Error::InvalidData("The profile backup snapshot is invalid.".into())
            }
        })
    }

    fn finish(self) -> Result<(Sha256, u64), Error> {
        if self.remaining != 0 {
            return Err(snapshot_changed_error());
        }
        let mut probe = [0_u8; 1];
        if self.file.read(&mut probe)? != 0 {
            return Err(snapshot_changed_error());
        }
        Ok((self.hasher, self.bytes))
    }
}

impl Read for SnapshotArchiveReader<'_> {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        if self.remaining == 0 || buffer.is_empty() {
            return Ok(0);
        }
        let read_limit =
            usize::try_from(self.remaining.min(buffer.len() as u64)).map_err(|_| {
                self.failure = Some(SnapshotReadFailure::Invalid);
                io::Error::new(
                    io::ErrorKind::InvalidData,
                    "Invalid profile backup snapshot",
                )
            })?;
        let read = self.file.read(&mut buffer[..read_limit])?;
        if read == 0 {
            self.failure = Some(SnapshotReadFailure::Changed);
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Profile backup snapshot changed while being read",
            ));
        }
        let Some(bytes) = self.bytes.checked_add(read as u64) else {
            self.failure = Some(SnapshotReadFailure::Invalid);
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "Invalid profile backup snapshot",
            ));
        };
        self.hasher.update(&buffer[..read]);
        self.bytes = bytes;
        self.remaining -= read as u64;
        (self.progress)(self.bytes, self.total);
        Ok(read)
    }
}

enum SnapshotReadFailure {
    Changed,
    Invalid,
}

fn snapshot_changed_error() -> Error {
    Error::InvalidData("The profile backup snapshot changed while it was being read.".into())
}

pub fn commit_file_without_overwrite(temporary: &Path, final_path: &Path) -> Result<(), Error> {
    commit_file_without_overwrite_with(temporary, final_path, |source, destination| {
        fs::hard_link(source, destination)
    })
}

fn commit_file_without_overwrite_with<F>(
    temporary: &Path,
    final_path: &Path,
    hard_link: F,
) -> Result<(), Error>
where
    F: FnOnce(&Path, &Path) -> io::Result<()>,
{
    match hard_link(temporary, final_path) {
        Ok(()) => {
            if let Err(error) = fs::remove_file(temporary) {
                tracing::warn!("Failed to remove committed backup temporary file: {error}");
            }
            sync_parent_directory(final_path);
            Ok(())
        }
        Err(error) if error.kind() == io::ErrorKind::AlreadyExists => Err(Error::Io(error)),
        Err(error) if hard_link_fallback_allowed(&error) => {
            if final_path.exists() {
                return Err(Error::Io(io::Error::new(
                    io::ErrorKind::AlreadyExists,
                    "Backup destination already exists.",
                )));
            }
            fs::rename(temporary, final_path)?;
            sync_parent_directory(final_path);
            Ok(())
        }
        Err(error) => Err(Error::Io(error)),
    }
}

fn hard_link_fallback_allowed(error: &io::Error) -> bool {
    error.kind() == io::ErrorKind::Unsupported
        || error.kind() == io::ErrorKind::PermissionDenied
        || matches!(error.raw_os_error(), Some(1 | 45 | 50 | 95))
}

fn sync_parent_directory(path: &Path) {
    let Some(parent) = path.parent() else {
        return;
    };
    if let Err(error) = crate::profile_backup::fsutil::open_directory_for_sync(parent)
        .and_then(|directory| directory.sync_all())
    {
        tracing::debug!("Failed to sync profile backup destination directory: {error}");
    }
}

pub fn select_auto_backups_for_removal(
    paths: impl IntoIterator<Item = PathBuf>,
    retain: usize,
) -> Vec<PathBuf> {
    let mut matching = paths
        .into_iter()
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .is_some_and(is_auto_backup_file_name)
        })
        .collect::<Vec<_>>();
    matching.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
    matching.into_iter().skip(retain).collect()
}

pub fn is_auto_backup_file_name(name: &str) -> bool {
    let Some(timestamp) = name
        .strip_prefix(AUTO_BACKUP_PREFIX)
        .and_then(|value| value.strip_suffix(BACKUP_SUFFIX))
    else {
        return false;
    };
    timestamp.len() == 15
        && timestamp.as_bytes()[8] == b'-'
        && timestamp
            .bytes()
            .enumerate()
            .all(|(index, byte)| index == 8 || byte.is_ascii_digit())
}

pub(crate) fn parse_app_version(value: &str) -> Option<[u64; 3]> {
    let core = value.split_once('-').map_or(value, |(prefix, _)| prefix);
    let mut parts = core.split('.');
    let parsed = [
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    ];
    if parts.next().is_some() {
        return None;
    }
    Some(parsed)
}

pub(crate) fn sha256_hex(digest: impl AsRef<[u8]>) -> String {
    let bytes = digest.as_ref();
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(&mut output, "{byte:02x}").unwrap();
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile_backup::{ProfileBackupKind, MAX_PROFILE_DATABASE_BYTES};

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-profile-backup-{name}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn profile_backup_manifest_roundtrips_and_archive_orders_database_first() {
        let dir = TestDir::new("archive-roundtrip");
        let snapshot = dir.0.join(DATABASE_FILE_NAME);
        let archive = dir.0.join("backup.vrcx0backup");
        fs::write(&snapshot, b"sqlite snapshot").unwrap();
        let manifest = create_backup_archive(
            &snapshot,
            &archive,
            ProfileBackupManifestMetadata {
                app_version: "1.2.3".into(),
                db_version: 18,
                created_at: "2026-07-14T07:30:00Z".into(),
                platform: "windows".into(),
                kind: ProfileBackupKind::Manual,
            },
        )
        .unwrap();

        let encoded = serde_json::to_string(&manifest).unwrap();
        assert_eq!(
            serde_json::from_str::<ProfileBackupManifest>(&encoded).unwrap(),
            manifest
        );
        let decoder = zstd::Decoder::new(File::open(archive).unwrap()).unwrap();
        let mut tar = tar::Archive::new(decoder);
        let mut entries = tar.entries().unwrap();

        let mut database_entry = entries.next().unwrap().unwrap();
        assert_eq!(
            database_entry.path().unwrap().as_ref(),
            Path::new(DATABASE_FILE_NAME)
        );
        assert_eq!(database_entry.header().entry_type(), EntryType::Regular);
        assert_eq!(database_entry.header().mode().unwrap(), 0o600);
        assert_eq!(database_entry.header().mtime().unwrap(), 0);
        let mut database_bytes = Vec::new();
        database_entry.read_to_end(&mut database_bytes).unwrap();
        assert_eq!(database_bytes, b"sqlite snapshot");
        drop(database_entry);

        let mut manifest_entry = entries.next().unwrap().unwrap();
        assert_eq!(
            manifest_entry.path().unwrap().as_ref(),
            Path::new(MANIFEST_FILE_NAME)
        );
        assert_eq!(manifest_entry.header().entry_type(), EntryType::Regular);
        assert_eq!(manifest_entry.header().mode().unwrap(), 0o600);
        assert_eq!(manifest_entry.header().mtime().unwrap(), 0);
        let mut manifest_bytes = Vec::new();
        manifest_entry.read_to_end(&mut manifest_bytes).unwrap();
        assert_eq!(
            serde_json::from_slice::<ProfileBackupManifest>(&manifest_bytes).unwrap(),
            manifest
        );
        drop(manifest_entry);

        assert!(entries.next().is_none());
        assert_eq!(manifest.contents[0].bytes, 15);
    }

    #[test]
    fn profile_backup_version_parser_handles_release_suffix_and_rejects_invalid_values() {
        assert_eq!(parse_app_version("1.2.3"), Some([1, 2, 3]));
        assert_eq!(parse_app_version("1.2.3-beta.1"), Some([1, 2, 3]));
        assert_eq!(parse_app_version("1.2"), None);
        assert_eq!(parse_app_version("1.2.x"), None);
        assert_eq!(parse_app_version("1.2.3.4"), None);
    }

    #[test]
    fn profile_backup_rotation_only_removes_old_auto_files() {
        let paths = [
            "VRCX-0-backup-auto-20260714-073000.vrcx0backup",
            "VRCX-0-backup-auto-20260713-073000.vrcx0backup",
            "VRCX-0-backup-auto-20260712-073000.vrcx0backup",
            "VRCX-0-backup-20260711-073000.vrcx0backup",
            "VRCX-0-backup-auto-20260710-073000.vrcx0backup.tmp",
            "notes.txt",
        ]
        .into_iter()
        .map(PathBuf::from)
        .collect::<Vec<_>>();

        assert_eq!(
            select_auto_backups_for_removal(paths, 2),
            vec![PathBuf::from(
                "VRCX-0-backup-auto-20260712-073000.vrcx0backup"
            )]
        );
    }

    #[test]
    fn profile_backup_commit_refuses_existing_target() {
        let dir = TestDir::new("commit-existing");
        let temporary = dir.0.join("backup.tmp");
        let final_path = dir.0.join("backup.vrcx0backup");
        fs::write(&temporary, b"new").unwrap();
        fs::write(&final_path, b"old").unwrap();

        assert!(commit_file_without_overwrite(&temporary, &final_path).is_err());
        assert_eq!(fs::read(&final_path).unwrap(), b"old");
        assert_eq!(fs::read(&temporary).unwrap(), b"new");
    }

    #[test]
    fn profile_backup_commit_falls_back_when_hard_links_are_unsupported() {
        let dir = TestDir::new("commit-fallback");
        let temporary = dir.0.join("backup.tmp");
        let final_path = dir.0.join("backup.vrcx0backup");
        fs::write(&temporary, b"new").unwrap();

        commit_file_without_overwrite_with(&temporary, &final_path, |_, _| {
            Err(io::Error::new(io::ErrorKind::Unsupported, "unsupported"))
        })
        .unwrap();
        assert!(!temporary.exists());
        assert_eq!(fs::read(&final_path).unwrap(), b"new");
    }

    #[test]
    fn profile_backup_rejects_oversized_snapshot_before_creating_archive() {
        let dir = TestDir::new("oversized-snapshot");
        let snapshot = dir.0.join(DATABASE_FILE_NAME);
        let archive = dir.0.join("backup.vrcx0backup");
        File::create(&snapshot)
            .unwrap()
            .set_len(MAX_PROFILE_DATABASE_BYTES + 1)
            .unwrap();

        assert!(matches!(
            create_backup_archive(
                &snapshot,
                &archive,
                ProfileBackupManifestMetadata {
                    app_version: "1.2.3".into(),
                    db_version: 18,
                    created_at: "2026-07-14T07:30:00Z".into(),
                    platform: "windows".into(),
                    kind: ProfileBackupKind::Manual,
                },
            ),
            Err(Error::InvalidData(_))
        ));
        assert!(!archive.exists());
    }

    #[cfg(unix)]
    #[test]
    fn profile_backup_archive_is_private_on_unix() {
        use std::os::unix::fs::PermissionsExt;

        let dir = TestDir::new("private-archive");
        let snapshot = dir.0.join(DATABASE_FILE_NAME);
        let archive = dir.0.join("backup.vrcx0backup");
        fs::write(&snapshot, b"sqlite snapshot").unwrap();

        create_backup_archive(
            &snapshot,
            &archive,
            ProfileBackupManifestMetadata {
                app_version: "1.2.3".into(),
                db_version: 18,
                created_at: "2026-07-14T07:30:00Z".into(),
                platform: "linux".into(),
                kind: ProfileBackupKind::Manual,
            },
        )
        .unwrap();

        assert_eq!(
            fs::metadata(archive).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
