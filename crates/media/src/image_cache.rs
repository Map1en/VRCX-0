use std::future::Future;
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::error::Error;

pub struct ImageCache {
    cache_dir: PathBuf,
}

impl ImageCache {
    pub fn new(cache_dir: PathBuf) -> Result<Self, Error> {
        std::fs::create_dir_all(&cache_dir)?;
        Ok(Self { cache_dir })
    }

    pub async fn get_image_with_fetch<F, Fut>(
        &self,
        file_id: &str,
        version: &str,
        fetch_image: F,
    ) -> Result<String, Error>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Vec<u8>, Error>>,
    {
        let file_id = safe_cache_component(file_id);
        let version = safe_cache_component(version);
        let dir = self.cache_dir.join(file_id);
        let file_path = dir.join(format!("{version}.png"));

        if file_path.exists() {
            if let Ok(meta) = std::fs::metadata(&file_path) {
                if meta.len() > 0 {
                    let marker = dir.join(".touch");
                    let _ = std::fs::write(&marker, b"");
                    let _ = std::fs::remove_file(&marker);
                    return Ok(file_path.to_string_lossy().into_owned());
                }
            }
        }

        if dir.exists() {
            let _ = std::fs::remove_dir_all(&dir);
        }
        std::fs::create_dir_all(&dir)?;

        let bytes = fetch_image().await?;
        std::fs::write(&file_path, &bytes)?;

        self.clean_cache_if_needed();

        Ok(file_path.to_string_lossy().into_owned())
    }

    fn clean_cache_if_needed(&self) {
        let entries = match std::fs::read_dir(&self.cache_dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        let mut dirs: Vec<(PathBuf, std::time::SystemTime)> = entries
            .flatten()
            .filter(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
            .filter_map(|e| {
                let mtime = e.metadata().ok()?.modified().ok()?;
                Some((e.path(), mtime))
            })
            .collect();

        if dirs.len() <= 1100 {
            return;
        }

        dirs.sort_by_key(|entry| std::cmp::Reverse(entry.1));

        for (path, _) in dirs.iter().skip(1000) {
            let _ = std::fs::remove_dir_all(path);
        }
    }
}

fn safe_cache_component(value: &str) -> String {
    if is_safe_path_component(value) {
        return value.to_string();
    }

    let digest = Sha256::digest(value.as_bytes());
    format!("h-{}", hex::encode(digest))
}

fn is_safe_path_component(value: &str) -> bool {
    if value.is_empty() || value == "." || value == ".." {
        return false;
    }

    if value.ends_with(' ') || value.ends_with('.') {
        return false;
    }

    if value.chars().any(|ch| {
        ch.is_control() || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
    }) {
        return false;
    }

    if is_windows_reserved_name(value) {
        return false;
    }

    let mut components = Path::new(value).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(component)), None) => component == std::ffi::OsStr::new(value),
        _ => false,
    }
}

fn is_windows_reserved_name(value: &str) -> bool {
    let upper = value
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const SMALL_PNG: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1F,
        0x15, 0xC4, 0x89, 0x00, 0x00, 0x00, 0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
    ];

    struct TestDir {
        path: PathBuf,
    }

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path =
                std::env::temp_dir().join(format!("vrcx-0-{name}-{}-{nonce}", std::process::id()));
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
    fn get_image_writes_and_reuses_daily_avatar_cache() -> Result<(), Error> {
        let dir = TestDir::new("image-cache-daily");
        let cache = ImageCache::new(dir.path.join("ImageCache"))?;

        let runtime = tokio::runtime::Builder::new_current_thread()
            .build()
            .unwrap();

        let first = runtime.block_on(
            cache.get_image_with_fetch("avatar-file", "1", || async { Ok(SMALL_PNG.to_vec()) }),
        )?;

        assert_eq!(std::fs::read(&first)?, SMALL_PNG);

        let second =
            runtime.block_on(cache.get_image_with_fetch("avatar-file", "1", || async {
                Err(Error::Custom("unexpected cache miss".into()))
            }))?;
        assert_eq!(second, first);
        assert_eq!(std::fs::read(&second)?, SMALL_PNG);
        Ok(())
    }
}
