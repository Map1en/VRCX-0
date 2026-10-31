use vrcx_0_application::media::ScreenshotFavorites;

use super::super::library::scan_screenshot_library_in;
use super::super::write_vrcx_metadata;
use super::*;

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

struct Library {
    _dir: TestDir,
    root: PathBuf,
    db: Arc<DatabaseService>,
    cache: MetadataCacheDb,
    favorites: ScreenshotFavorites,
}

impl Library {
    fn new(name: &str) -> Self {
        let dir = TestDir::new(name);
        let root = dir.path.join("photos");
        std::fs::create_dir_all(root.join("2026-05")).unwrap();
        std::fs::create_dir_all(root.join("sorted")).unwrap();
        let db = Arc::new(DatabaseService::new(&dir.path.join("VRCX-0.sqlite3")).unwrap());
        let cache = MetadataCacheDb::new(&dir.path.join("metadataCache.db")).unwrap();
        let favorites = ScreenshotFavorites::new(
            Arc::new(LocalScreenshotFavoriteStore::new(Arc::clone(&db))),
            Arc::new(LocalScreenshotLibraryAdapter::new(
                cache.clone(),
                dir.path.join("thumbnails"),
            )),
        );
        Self {
            _dir: dir,
            root,
            db,
            cache,
            favorites,
        }
    }

    fn root_string(&self) -> String {
        self.root.to_string_lossy().into_owned()
    }

    fn write_png(&self, relative: &str, red: u8) -> String {
        let path = self.root.join(relative);
        let image = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            4,
            4,
            image::Rgba([red, 34, 56, 255]),
        ));
        image.save(&path).unwrap();
        path.to_string_lossy().into_owned()
    }

    fn scan_and_relink(&self) -> usize {
        scan_screenshot_library_in(&self.root, &self.cache, None, false, None);
        self.favorites.relink_missing(&self.root_string()).unwrap()
    }

    fn favorite_paths(&self) -> Vec<String> {
        store::list_screenshot_favorites(&self.db)
            .unwrap()
            .into_iter()
            .map(|favorite| favorite.path)
            .collect()
    }
}

#[test]
fn moved_favorite_is_found_again_after_the_next_scan() {
    let library = Library::new("favorite-moved");
    let original = library.write_png("2026-05/VRChat_sea.png", 10);
    library.write_png("2026-05/VRChat_other.png", 200);
    library.scan_and_relink();
    library.favorites.set_favorite(&original, true).unwrap();

    let moved = library.root.join("sorted").join("sea.png");
    std::fs::rename(&original, &moved).unwrap();
    let relinked = library.scan_and_relink();

    let moved = moved.to_string_lossy().into_owned();
    assert_eq!(relinked, 1);
    assert_eq!(library.favorite_paths(), vec![moved.clone()]);
    let favorites = library.favorites.list(&library.root_string()).unwrap();
    assert_eq!(favorites.missing_count, 0);
    assert_eq!(
        favorites
            .images
            .iter()
            .map(|image| image.path.clone())
            .collect::<Vec<_>>(),
        vec![moved]
    );
}

#[test]
fn favorite_stays_missing_when_no_file_has_the_same_content() {
    let library = Library::new("favorite-missing");
    let original = library.write_png("2026-05/VRChat_sea.png", 10);
    library.scan_and_relink();
    library.favorites.set_favorite(&original, true).unwrap();

    std::fs::remove_file(&original).unwrap();
    library.write_png("sorted/VRChat_sea.png", 11);
    let relinked = library.scan_and_relink();

    assert_eq!(relinked, 0);
    assert_eq!(library.favorite_paths(), vec![original]);
    let favorites = library.favorites.list(&library.root_string()).unwrap();
    assert_eq!(favorites.missing_count, 1);
    assert!(favorites.images.is_empty());
}

#[test]
fn removing_missing_favorites_keeps_the_ones_still_on_disk() {
    let library = Library::new("favorite-forget-missing");
    let gone = library.write_png("2026-05/VRChat_gone.png", 10);
    let kept = library.write_png("2026-05/VRChat_kept.png", 20);
    library.scan_and_relink();
    library.favorites.set_favorite(&gone, true).unwrap();
    library.favorites.set_favorite(&kept, true).unwrap();
    std::fs::remove_file(&gone).unwrap();

    assert_eq!(library.favorites.forget_missing().unwrap(), 1);
    assert_eq!(library.favorite_paths(), vec![kept]);
}

#[test]
fn copy_that_is_already_a_favorite_is_not_claimed_by_a_missing_favorite() {
    let library = Library::new("favorite-copy");
    let original = library.write_png("2026-05/VRChat_sea.png", 10);
    let copy = library.root.join("sorted").join("sea-copy.png");
    std::fs::copy(&original, &copy).unwrap();
    let copy = copy.to_string_lossy().into_owned();
    library.scan_and_relink();
    library.favorites.set_favorite(&original, true).unwrap();
    library.favorites.set_favorite(&copy, true).unwrap();

    std::fs::remove_file(&original).unwrap();
    let relinked = library.scan_and_relink();

    assert_eq!(relinked, 0);
    let mut paths = library.favorite_paths();
    paths.sort();
    let mut expected = vec![original, copy];
    expected.sort();
    assert_eq!(paths, expected);
}

#[test]
fn deleting_metadata_keeps_the_favorite_findable_after_a_move() {
    let library = Library::new("favorite-metadata-delete");
    let original = library.write_png("2026-05/VRChat_sea.png", 10);
    assert!(write_vrcx_metadata(
        r#"{"application":"VRCX-0"}"#,
        &original
    ));
    library.scan_and_relink();
    library.favorites.set_favorite(&original, true).unwrap();

    assert!(library.favorites.delete_metadata(&original));
    let moved = library.root.join("sorted").join("sea.png");
    std::fs::rename(&original, &moved).unwrap();

    assert_eq!(library.scan_and_relink(), 1);
    assert_eq!(
        library.favorite_paths(),
        vec![moved.to_string_lossy().into_owned()]
    );
}
