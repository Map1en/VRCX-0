use std::path::Path;

pub fn is_path_inside_directory(path: &Path, directory: &Path) -> bool {
    let Ok(path) = path.canonicalize() else {
        return false;
    };
    let Ok(directory) = directory.canonicalize() else {
        return false;
    };
    path.starts_with(directory)
}

#[cfg(not(windows))]
pub fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    std::fs::rename(source, destination)
}

#[cfg(windows)]
pub fn replace_file_atomically(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x8;

    #[link(name = "Kernel32")]
    extern "system" {
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    let source = source
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let destination = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect::<Vec<_>>();
    let replaced = unsafe {
        MoveFileExW(
            source.as_ptr(),
            destination.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if replaced == 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TestDir {
        path: std::path::PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-path-utils-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self { path }
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }

    #[test]
    fn accepts_a_file_directly_inside_the_directory() {
        let dir = TestDir::new("inside");
        let file = dir.path.join("photo.png");
        std::fs::write(&file, b"data").unwrap();

        assert!(is_path_inside_directory(&file, &dir.path));
    }

    #[test]
    fn accepts_a_file_nested_in_a_subdirectory() {
        let dir = TestDir::new("nested");
        let nested = dir.path.join("sub").join("deep");
        std::fs::create_dir_all(&nested).unwrap();
        let file = nested.join("photo.png");
        std::fs::write(&file, b"data").unwrap();

        assert!(is_path_inside_directory(&file, &dir.path));
    }

    #[test]
    fn rejects_a_path_traversal_that_escapes_the_directory() {
        let dir = TestDir::new("escape-parent");
        let allowed = dir.path.join("allowed");
        std::fs::create_dir_all(&allowed).unwrap();
        let outside_file = dir.path.join("secret.png");
        std::fs::write(&outside_file, b"data").unwrap();
        let traversal = allowed.join("..").join("secret.png");

        assert!(!is_path_inside_directory(&traversal, &allowed));
    }

    #[test]
    fn rejects_a_sibling_directory_with_a_shared_name_prefix() {
        let dir = TestDir::new("sibling-prefix");
        let allowed = dir.path.join("ugc");
        let sibling = dir.path.join("ugc-other");
        std::fs::create_dir_all(&allowed).unwrap();
        std::fs::create_dir_all(&sibling).unwrap();
        let file = sibling.join("photo.png");
        std::fs::write(&file, b"data").unwrap();

        assert!(!is_path_inside_directory(&file, &allowed));
    }

    #[test]
    fn rejects_a_path_that_does_not_exist() {
        let dir = TestDir::new("missing");

        assert!(!is_path_inside_directory(
            &dir.path.join("missing.png"),
            &dir.path
        ));
    }

    #[test]
    fn replace_file_atomically_overwrites_the_destination_and_consumes_the_source() {
        let dir = TestDir::new("replace");
        let source = dir.path.join("pointer.json.tmp");
        let destination = dir.path.join("pointer.json");
        std::fs::write(&source, b"new").unwrap();
        std::fs::write(&destination, b"old").unwrap();

        replace_file_atomically(&source, &destination).unwrap();

        assert_eq!(std::fs::read(&destination).unwrap(), b"new");
        assert!(!source.exists());
    }
}
