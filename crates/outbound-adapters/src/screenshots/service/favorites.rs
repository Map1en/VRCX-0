use std::sync::Arc;

use vrcx_0_application::media::{
    ScreenshotFavorite, ScreenshotFavoriteStore, ScreenshotFingerprint, ScreenshotLibraryPort,
};
use vrcx_0_media::media_files::file_sha256_hex;
use vrcx_0_persistence::screenshot_favorites as store;
use vrcx_0_persistence::DatabaseService;

use super::{
    delete_all_screenshot_metadata, delete_text_metadata, Error, MetadataCacheDb, Path, PathBuf,
    Result, ScreenshotLibraryImage,
};
use crate::map_persistence_error;

pub struct LocalScreenshotFavoriteStore {
    db: Arc<DatabaseService>,
}

impl LocalScreenshotFavoriteStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

fn favorite_from_record(record: store::ScreenshotFavoriteRecord) -> ScreenshotFavorite {
    ScreenshotFavorite {
        id: record.id,
        path: record.path,
        fingerprint: ScreenshotFingerprint {
            size_bytes: record.size_bytes,
            sha256: record.sha256,
        },
    }
}

impl ScreenshotFavoriteStore for LocalScreenshotFavoriteStore {
    fn list(&self) -> Result<Vec<ScreenshotFavorite>> {
        Ok(store::list_screenshot_favorites(&self.db)
            .map_err(map_persistence_error)?
            .into_iter()
            .map(favorite_from_record)
            .collect())
    }

    fn get(&self, path: &str) -> Result<Option<ScreenshotFavorite>> {
        Ok(store::get_screenshot_favorite(&self.db, path)
            .map_err(map_persistence_error)?
            .map(favorite_from_record))
    }

    fn add(&self, path: &str, fingerprint: &ScreenshotFingerprint) -> Result<()> {
        store::add_screenshot_favorite(&self.db, path, fingerprint.size_bytes, &fingerprint.sha256)
            .map_err(map_persistence_error)
    }

    fn update_file(&self, id: i64, path: &str, fingerprint: &ScreenshotFingerprint) -> Result<()> {
        store::update_screenshot_favorite_file(
            &self.db,
            id,
            path,
            fingerprint.size_bytes,
            &fingerprint.sha256,
        )
        .map_err(map_persistence_error)
    }

    fn remove(&self, path: &str) -> Result<()> {
        store::remove_screenshot_favorite(&self.db, path).map_err(map_persistence_error)
    }
}

pub struct LocalScreenshotLibraryAdapter {
    cache: MetadataCacheDb,
    thumbnail_cache_dir: PathBuf,
}

impl LocalScreenshotLibraryAdapter {
    pub fn new(cache: MetadataCacheDb, thumbnail_cache_dir: PathBuf) -> Self {
        Self {
            cache,
            thumbnail_cache_dir,
        }
    }
}

impl ScreenshotLibraryPort for LocalScreenshotLibraryAdapter {
    fn is_file(&self, path: &str) -> bool {
        Path::new(path).is_file()
    }

    fn fingerprint(&self, path: &str) -> Result<ScreenshotFingerprint> {
        let path = Path::new(path);
        let size_bytes = std::fs::metadata(path).map_err(Error::Io)?.len() as i64;
        let sha256 = file_sha256_hex(path).map_err(|error| match error {
            vrcx_0_media::Error::Io(error) => Error::Io(error),
            vrcx_0_media::Error::Custom(message) => Error::Custom(message),
        })?;
        Ok(ScreenshotFingerprint { size_bytes, sha256 })
    }

    fn indexed_paths_with_size(&self, root_path: &str, size_bytes: i64) -> Result<Vec<String>> {
        Ok(self
            .cache
            .list_library_paths_with_size_for_root(root_path, size_bytes)?)
    }

    fn indexed_images(
        &self,
        root_path: &str,
        paths: &[String],
    ) -> Result<Vec<ScreenshotLibraryImage>> {
        Ok(self
            .cache
            .list_library_images_by_paths_for_root(root_path, paths)?)
    }

    fn delete_text_metadata(&self, path: &str) -> bool {
        delete_text_metadata(path, true)
    }

    fn delete_all_metadata(&self, root_path: &str) {
        delete_all_screenshot_metadata(&self.cache, &self.thumbnail_cache_dir, root_path);
    }
}

#[cfg(test)]
mod tests;
