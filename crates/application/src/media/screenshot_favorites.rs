use std::collections::HashSet;
use std::sync::Arc;

use vrcx_0_application_core::Result;
use vrcx_0_core::screenshots::{FavoriteScreenshots, ScreenshotLibraryImage};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScreenshotFingerprint {
    pub size_bytes: i64,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScreenshotFavorite {
    pub id: i64,
    pub path: String,
    pub fingerprint: ScreenshotFingerprint,
}

pub trait ScreenshotFavoriteStore: Send + Sync {
    fn list(&self) -> Result<Vec<ScreenshotFavorite>>;
    fn get(&self, path: &str) -> Result<Option<ScreenshotFavorite>>;
    fn add(&self, path: &str, fingerprint: &ScreenshotFingerprint) -> Result<()>;
    fn update_file(&self, id: i64, path: &str, fingerprint: &ScreenshotFingerprint) -> Result<()>;
    fn remove(&self, path: &str) -> Result<()>;
}

pub trait ScreenshotLibraryPort: Send + Sync {
    fn is_file(&self, path: &str) -> bool;
    fn fingerprint(&self, path: &str) -> Result<ScreenshotFingerprint>;
    fn indexed_paths_with_size(&self, root_path: &str, size_bytes: i64) -> Result<Vec<String>>;
    fn indexed_images(
        &self,
        root_path: &str,
        paths: &[String],
    ) -> Result<Vec<ScreenshotLibraryImage>>;
    fn delete_text_metadata(&self, path: &str) -> bool;
    fn delete_all_metadata(&self, root_path: &str);
}

#[derive(Clone)]
pub struct ScreenshotFavorites {
    store: Arc<dyn ScreenshotFavoriteStore>,
    library: Arc<dyn ScreenshotLibraryPort>,
}

impl ScreenshotFavorites {
    pub fn new(
        store: Arc<dyn ScreenshotFavoriteStore>,
        library: Arc<dyn ScreenshotLibraryPort>,
    ) -> Self {
        Self { store, library }
    }

    pub fn set_favorite(&self, path: &str, favorite: bool) -> Result<()> {
        if !favorite {
            return self.store.remove(path);
        }
        let fingerprint = self.library.fingerprint(path)?;
        self.store.add(path, &fingerprint)
    }

    pub fn forget(&self, path: &str) -> Result<()> {
        self.store.remove(path)
    }

    pub fn forget_missing(&self) -> Result<u32> {
        let mut removed = 0u32;
        for favorite in self.store.list()? {
            if self.library.is_file(&favorite.path) {
                continue;
            }
            self.store.remove(&favorite.path)?;
            removed = removed.saturating_add(1);
        }
        Ok(removed)
    }

    pub fn list(&self, root_path: &str) -> Result<FavoriteScreenshots> {
        let paths = self
            .store
            .list()?
            .into_iter()
            .map(|favorite| favorite.path)
            .collect::<Vec<_>>();
        let images = self.library.indexed_images(root_path, &paths)?;
        let missing_count = paths
            .iter()
            .filter(|path| !self.library.is_file(path))
            .count();
        Ok(FavoriteScreenshots {
            missing_count: crate::wire_count(missing_count),
            paths,
            images,
        })
    }

    pub fn relink_missing(&self, root_path: &str) -> Result<usize> {
        let favorites = self.store.list()?;
        let favorite_paths = favorites
            .iter()
            .map(|favorite| favorite.path.clone())
            .collect::<HashSet<_>>();
        let mut claimed_paths = HashSet::new();
        let mut relinked = 0;

        for favorite in favorites
            .iter()
            .filter(|favorite| !self.library.is_file(&favorite.path))
        {
            for candidate in self
                .library
                .indexed_paths_with_size(root_path, favorite.fingerprint.size_bytes)?
            {
                if favorite_paths.contains(&candidate) || claimed_paths.contains(&candidate) {
                    continue;
                }
                let Ok(fingerprint) = self.library.fingerprint(&candidate) else {
                    continue;
                };
                if fingerprint != favorite.fingerprint {
                    continue;
                }
                self.store
                    .update_file(favorite.id, &candidate, &fingerprint)?;
                claimed_paths.insert(candidate);
                relinked += 1;
                break;
            }
        }

        Ok(relinked)
    }

    pub fn delete_metadata(&self, path: &str) -> bool {
        let deleted = self.library.delete_text_metadata(path);
        if deleted {
            if let Err(error) = self.refresh(path) {
                tracing::warn!(%error, "failed to refresh screenshot favorite after metadata delete");
            }
        }
        deleted
    }

    pub fn delete_all_metadata(&self, root_path: &str) {
        self.library.delete_all_metadata(root_path);
        if let Err(error) = self.refresh_all() {
            tracing::warn!(%error, "failed to refresh screenshot favorites after metadata clear");
        }
    }

    fn refresh(&self, path: &str) -> Result<()> {
        let Some(favorite) = self.store.get(path)? else {
            return Ok(());
        };
        let fingerprint = self.library.fingerprint(path)?;
        self.store.update_file(favorite.id, path, &fingerprint)
    }

    fn refresh_all(&self) -> Result<()> {
        for favorite in self.store.list()? {
            let Ok(fingerprint) = self.library.fingerprint(&favorite.path) else {
                continue;
            };
            self.store
                .update_file(favorite.id, &favorite.path, &fingerprint)?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests;
