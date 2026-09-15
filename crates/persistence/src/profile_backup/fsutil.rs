use std::fs::File;
use std::path::Path;

#[cfg(windows)]
pub(super) fn open_directory_for_sync(path: &Path) -> std::io::Result<File> {
    use std::os::windows::fs::OpenOptionsExt;

    const FILE_FLAG_BACKUP_SEMANTICS: u32 = 0x0200_0000;
    std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS)
        .open(path)
}

#[cfg(not(windows))]
pub(super) fn open_directory_for_sync(path: &Path) -> std::io::Result<File> {
    File::open(path)
}
