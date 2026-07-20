use super::super::library::scan_screenshot_library_in;
use super::super::paths::unix_time_millis;
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

fn write_test_png(path: &Path) -> Result<()> {
    write_test_png_with_size(path, 2, 2)
}

fn write_test_png_with_size(path: &Path, width: u32, height: u32) -> Result<()> {
    let img = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
        width,
        height,
        image::Rgba([12, 34, 56, 255]),
    ));
    let mut buf = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    img.write_with_encoder(encoder)
        .map_err(|e| Error::Custom(format!("png encode: {e}")))?;
    std::fs::write(path, buf)?;
    Ok(())
}

fn write_text_chunk(path: &Path, keyword: &str, text: &str) -> Result<()> {
    let path_str = path.to_string_lossy();
    let mut png =
        png::PngFile::open_rw(&path_str).map_err(|e| Error::Custom(format!("png open: {e}")))?;
    let chunk = png::generate_text_chunk(keyword, text);
    assert!(png.write_chunk(&chunk));
    Ok(())
}

#[test]
fn get_screenshot_metadata_reads_legacy_lfs_world_and_players_from_png() -> Result<()> {
    let dir = TestDir::new("screenshot-legacy-lfs");
    let path = dir.path.join("legacy.png");
    write_test_png(&path)?;
    write_text_chunk(
        &path,
        "Description",
        "lfs|2|author:usr_author,Ava|world:wrld_legacy,12345,Legacy World|pos:1.5,2.5,3.5|players:usr_one,1,2,3,Player One;usr_two,4.5,5.5,6.5,Player Two",
    )?;

    let path_str = path.to_string_lossy();
    let metadata = get_screenshot_metadata(&path_str).expect("metadata");

    assert_eq!(metadata.application.as_deref(), Some("lfs"));
    assert_eq!(metadata.world.id, "wrld_legacy");
    assert_eq!(metadata.world.name.as_deref(), Some("Legacy World"));
    assert_eq!(metadata.world.instance_id, "wrld_legacy:12345");
    assert_eq!(metadata.players.len(), 2);
    assert_eq!(metadata.players[0].id, "usr_one");
    assert_eq!(metadata.players[0].display_name, "Player One");
    assert_eq!(metadata.players[0].pos, Some([1.0, 2.0, 3.0]));
    assert_eq!(metadata.players[1].id, "usr_two");
    assert_eq!(metadata.players[1].display_name, "Player Two");
    assert_eq!(metadata.players[1].pos, Some([4.5, 5.5, 6.5]));
    Ok(())
}

#[test]
fn add_screenshot_metadata_writes_vrcx_world_and_players_for_new_screenshot() -> Result<()> {
    let dir = TestDir::new("screenshot-vrcx-metadata");
    let path = dir
        .path
        .join("VRChat_2026-05-08_00-00-00.000_3840x2160.png");
    write_test_png(&path)?;
    let path_str = path.to_string_lossy().into_owned();
    let metadata_json = serde_json::json!({
        "application": "VRCX-0",
        "version": 1,
        "author": {
            "id": "usr_author",
            "displayName": "Ava"
        },
        "world": {
            "id": "wrld_new",
            "name": "New Screenshot World",
            "instanceId": "wrld_new:98765~region(us)"
        },
        "players": [
            {
                "id": "usr_friend",
                "displayName": "Friend One"
            }
        ]
    })
    .to_string();

    let written_path = add_screenshot_metadata(&path_str, &metadata_json, "wrld_new", false);
    let metadata = get_screenshot_metadata(&path_str).expect("metadata");

    assert_eq!(written_path, path_str);
    assert!(has_vrcx_metadata(&path_str));
    assert_eq!(metadata.application.as_deref(), Some("VRCX-0"));
    assert_eq!(metadata.world.id, "wrld_new");
    assert_eq!(metadata.world.name.as_deref(), Some("New Screenshot World"));
    assert_eq!(metadata.world.instance_id, "wrld_new:98765~region(us)");
    assert_eq!(metadata.players.len(), 1);
    assert_eq!(metadata.players[0].id, "usr_friend");
    assert_eq!(metadata.players[0].display_name, "Friend One");
    Ok(())
}

#[test]
fn get_screenshot_metadata_merges_vrchat_world_name_with_vrcx_players() -> Result<()> {
    let dir = TestDir::new("screenshot-vrchat-vrcx-merge");
    let path = dir
        .path
        .join("VRChat_2026-05-08_00-00-01.000_3840x2160.png");
    write_test_png(&path)?;
    write_text_chunk(
        &path,
        "XML:com.adobe.xmp",
        r#"<x:xmpmeta xmlns:x="adobe:ns:meta/"><CreatorTool>VRChat</CreatorTool><Author>VRChat User</Author><AuthorID>usr_author</AuthorID><DateTime>2026-05-08T00:00:01.000Z</DateTime><WorldID>wrld_current</WorldID><WorldDisplayName>Current World Friends</WorldDisplayName></x:xmpmeta>"#,
    )?;
    let path_str = path.to_string_lossy().into_owned();
    let metadata_json = serde_json::json!({
        "application": "VRCX-0",
        "version": 1,
        "author": {
            "id": "usr_author",
            "displayName": "Ava"
        },
        "world": {
            "id": "wrld_current",
            "name": "JSON World",
            "instanceId": "wrld_current:12345~hidden(usr_hidden)~region(us)"
        },
        "players": [
            {
                "id": "usr_one",
                "displayName": "Player One"
            },
            {
                "id": "usr_two",
                "displayName": "Player Two"
            }
        ]
    })
    .to_string();

    assert_eq!(
        add_screenshot_metadata(&path_str, &metadata_json, "wrld_current", false),
        path_str
    );
    let metadata = get_screenshot_metadata(&path_str).expect("metadata");

    assert_eq!(metadata.application.as_deref(), Some("VRChat"));
    assert_eq!(metadata.author.id, "usr_author");
    assert_eq!(metadata.author.display_name.as_deref(), Some("VRChat User"));
    assert_eq!(
        metadata.timestamp.as_deref(),
        Some("2026-05-08T00:00:01.000Z")
    );
    assert_eq!(metadata.world.id, "wrld_current");
    assert_eq!(
        metadata.world.name.as_deref(),
        Some("Current World Friends")
    );
    assert_eq!(
        metadata.world.instance_id,
        "wrld_current:12345~hidden(usr_hidden)~region(us)"
    );
    assert_eq!(
        metadata
            .players
            .iter()
            .map(|player| player.display_name.as_str())
            .collect::<Vec<_>>(),
        vec!["Player One", "Player Two"]
    );
    Ok(())
}

#[test]
fn screenshot_library_scan_indexes_skips_and_deletes_png_files() -> Result<()> {
    let dir = TestDir::new("screenshot-library");
    let photos_dir = dir.path.join("photos");
    let nested_dir = photos_dir.join("nested");
    std::fs::create_dir_all(&nested_dir)?;
    let db_path = dir.path.join("metadataCache.db");
    let cache = MetadataCacheDb::new(&db_path)?;
    let image_path = nested_dir.join("VRChat_2026-05-08_00-00-02.000_3840x2160.png");
    write_test_png(&image_path)?;
    let metadata_json = serde_json::json!({
        "application": "VRCX-0",
        "version": 1,
        "author": {
            "id": "usr_author",
            "displayName": "Ava"
        },
        "world": {
            "id": "wrld_library",
            "name": "Library World",
            "instanceId": "wrld_library:12345"
        },
        "players": [],
        "timestamp": "2026-05-08T00:00:02.000Z"
    })
    .to_string();
    write_text_chunk(&image_path, "Description", &metadata_json)?;

    let thumb_dir = dir.path.join("thumbs");
    let first_status =
        scan_screenshot_library_in(&photos_dir, &cache, Some(&thumb_dir), false, None);
    assert_eq!(first_status.scanned, 1);
    assert_eq!(first_status.indexed, 1);
    assert_eq!(first_status.changed, 1);
    assert_eq!(first_status.skipped, 0);
    assert_eq!(first_status.deleted, 0);
    assert_eq!(first_status.error, None);

    let folder_images = cache.list_screenshot_folder_images_for_root(
        &photos_dir.to_string_lossy(),
        &nested_dir.to_string_lossy(),
    )?;
    assert_eq!(folder_images.len(), 1);
    assert_eq!(
        folder_images[0].path,
        image_path.to_string_lossy().into_owned()
    );
    assert_eq!(folder_images[0].world_id.as_deref(), Some("wrld_library"));
    assert_eq!(
        folder_images[0].world_name.as_deref(),
        Some("Library World")
    );
    assert_eq!(folder_images[0].width, Some(2));
    assert_eq!(folder_images[0].height, Some(2));

    let world_images =
        cache.list_world_screenshots_for_root(&photos_dir.to_string_lossy(), "wrld_library")?;
    assert_eq!(world_images.len(), 1);
    assert_eq!(
        world_images[0].path,
        image_path.to_string_lossy().into_owned()
    );

    let image_path_string = image_path.to_string_lossy().into_owned();
    let thumb_path =
        ensure_screenshot_thumbnail_in_root(&image_path_string, &thumb_dir, &cache, &photos_dir)?;
    assert!(Path::new(&thumb_path).is_file());

    let second_status =
        scan_screenshot_library_in(&photos_dir, &cache, Some(&thumb_dir), false, None);
    assert_eq!(second_status.scanned, 1);
    assert_eq!(second_status.indexed, 0);
    assert_eq!(second_status.changed, 0);
    assert_eq!(second_status.skipped, 1);
    assert_eq!(second_status.deleted, 0);

    std::fs::remove_file(&image_path)?;
    let third_status =
        scan_screenshot_library_in(&photos_dir, &cache, Some(&thumb_dir), false, None);
    assert_eq!(third_status.scanned, 0);
    assert_eq!(third_status.deleted, 1);
    assert!(cache
        .list_screenshot_folder_images_for_root(
            &photos_dir.to_string_lossy(),
            &nested_dir.to_string_lossy()
        )?
        .is_empty());
    assert!(cache
        .list_world_screenshots_for_root(&photos_dir.to_string_lossy(), "wrld_library")?
        .is_empty());
    assert!(!Path::new(&thumb_path).exists());
    Ok(())
}

#[test]
fn screenshot_library_scan_repairs_stale_rows_without_metadata() -> Result<()> {
    let dir = TestDir::new("screenshot-library-stale-metadata");
    let photos_dir = dir.path.join("photos");
    std::fs::create_dir_all(&photos_dir)?;
    let db_path = dir.path.join("metadataCache.db");
    let cache = MetadataCacheDb::new(&db_path)?;
    let image_path = photos_dir.join("VRChat_2026-05-08_00-00-06.000_3840x2160.png");
    write_test_png(&image_path)?;
    let metadata_json = serde_json::json!({
        "application": "VRCX-0",
        "version": 1,
        "author": {
            "id": "usr_author",
            "displayName": "Ava"
        },
        "world": {
            "id": "wrld_repaired",
            "name": "Repaired World",
            "instanceId": "wrld_repaired:12345"
        },
        "players": []
    })
    .to_string();
    write_text_chunk(&image_path, "Description", &metadata_json)?;

    let file_metadata = std::fs::metadata(&image_path)?;
    let modified_at = file_metadata
        .modified()
        .map(unix_time_millis)
        .unwrap_or_default();
    let image_path_string = image_path.to_string_lossy().into_owned();
    cache.replace_library_entries(
        &photos_dir.to_string_lossy(),
        &HashSet::from([image_path_string.clone()]),
        &[ScreenshotLibraryEntry {
            scan_root: photos_dir.to_string_lossy().into_owned(),
            path: image_path_string.clone(),
            folder_path: photos_dir.to_string_lossy().into_owned(),
            file_name: "VRChat_2026-05-08_00-00-06.000_3840x2160.png".into(),
            size_bytes: file_metadata.len() as i64,
            modified_at,
            created_at: None,
            width: None,
            height: None,
            world_id: None,
            world_name: None,
            captured_at: None,
            metadata_json: None,
            error: None,
        }],
        false,
    )?;
    cache.mark_library_entry_stale_for_test(&image_path_string)?;

    let status = scan_screenshot_library_in(&photos_dir, &cache, None, false, None);
    assert_eq!(status.scanned, 1);
    assert_eq!(status.indexed, 1);
    assert_eq!(status.changed, 1);
    assert_eq!(status.skipped, 0);

    let folder_images = cache.list_screenshot_folder_images_for_root(
        &photos_dir.to_string_lossy(),
        &photos_dir.to_string_lossy(),
    )?;
    assert_eq!(folder_images.len(), 1);
    assert_eq!(
        folder_images[0].world_name.as_deref(),
        Some("Repaired World")
    );
    Ok(())
}

#[test]
fn screenshot_library_queries_are_scoped_to_scan_root() -> Result<()> {
    let dir = TestDir::new("screenshot-library-root-scope");
    let root_a = dir.path.join("root-a");
    let root_b = dir.path.join("root-b");
    std::fs::create_dir_all(&root_a)?;
    std::fs::create_dir_all(&root_b)?;
    let cache = MetadataCacheDb::new(&dir.path.join("metadataCache.db"))?;
    let image_path = root_a.join("VRChat_2026-05-08_00-00-03.000_3840x2160.png");
    write_test_png(&image_path)?;
    let metadata_json = serde_json::json!({
        "application": "VRCX-0",
        "version": 1,
        "author": {
            "id": "usr_author",
            "displayName": "Ava"
        },
        "world": {
            "id": "wrld_scoped",
            "name": "Scoped World",
            "instanceId": "wrld_scoped:12345"
        },
        "players": []
    })
    .to_string();
    write_text_chunk(&image_path, "Description", &metadata_json)?;

    let status_a = scan_screenshot_library_in(&root_a, &cache, None, false, None);
    assert_eq!(status_a.indexed, 1);
    let status_b = scan_screenshot_library_in(&root_b, &cache, None, false, None);
    assert_eq!(status_b.scanned, 0);

    assert_eq!(
        cache
            .list_world_screenshots_for_root(&root_a.to_string_lossy(), "wrld_scoped")?
            .len(),
        1
    );
    assert!(cache
        .list_world_screenshots_for_root(&root_b.to_string_lossy(), "wrld_scoped")?
        .is_empty());
    assert!(cache
        .screenshot_folder_tree_for_root(&root_b.to_string_lossy())?
        .folders
        .iter()
        .all(|folder| folder.total_image_count == 0));
    Ok(())
}

#[test]
fn ensure_screenshot_thumbnail_generates_and_reuses_webp_cache() -> Result<()> {
    let dir = TestDir::new("screenshot-thumbnail-cache");
    let cache = MetadataCacheDb::new(&dir.path.join("metadataCache.db"))?;
    let source_path = dir
        .path
        .join("VRChat_2026-05-08_00-00-04.000_3840x2160.png");
    let thumb_dir = dir.path.join("thumbs");
    write_test_png_with_size(&source_path, 64, 32)?;
    let source_path_string = source_path.to_string_lossy().into_owned();

    let first_thumb =
        ensure_screenshot_thumbnail_in_root(&source_path_string, &thumb_dir, &cache, &dir.path)?;
    assert!(Path::new(&first_thumb).is_file());
    assert!(first_thumb.ends_with(".webp"));
    let entries = cache.thumbnail_cache_entries();
    assert_eq!(entries.len(), 1);
    assert!(!Path::new(&entries[0].thumb_path).is_absolute());
    let first_modified_at = std::fs::metadata(&first_thumb)?.modified()?;

    let second_thumb =
        ensure_screenshot_thumbnail_in_root(&source_path_string, &thumb_dir, &cache, &dir.path)?;
    assert_eq!(first_thumb, second_thumb);
    assert_eq!(
        std::fs::metadata(&second_thumb)?.modified()?,
        first_modified_at
    );

    write_test_png_with_size(&source_path, 65, 32)?;
    let third_thumb =
        ensure_screenshot_thumbnail_in_root(&source_path_string, &thumb_dir, &cache, &dir.path)?;
    assert!(Path::new(&third_thumb).is_file());
    assert_ne!(first_thumb, third_thumb);
    assert!(!Path::new(&first_thumb).exists());
    Ok(())
}

#[test]
fn ensure_screenshot_thumbnail_rejects_sources_outside_root() -> Result<()> {
    let dir = TestDir::new("screenshot-thumbnail-root");
    let cache = MetadataCacheDb::new(&dir.path.join("metadataCache.db"))?;
    let source_root = dir.path.join("photos");
    let outside_root = dir.path.join("outside");
    let thumb_dir = dir.path.join("thumbs");
    std::fs::create_dir_all(&source_root)?;
    std::fs::create_dir_all(&outside_root)?;
    let outside_path = outside_root.join("VRChat_2026-05-08_00-00-05.000_3840x2160.png");
    write_test_png(&outside_path)?;

    let result = ensure_screenshot_thumbnail_in_root(
        &outside_path.to_string_lossy(),
        &thumb_dir,
        &cache,
        &source_root,
    );
    assert!(result.is_err());
    assert!(!thumb_dir.exists());
    Ok(())
}

#[test]
fn is_path_inside_directory_rejects_sibling_paths() -> Result<()> {
    let dir = TestDir::new("screenshot-thumbnail-containment");
    let root = dir.path.join("thumbs");
    let sibling = dir.path.join("thumbs-sibling");
    std::fs::create_dir_all(&root)?;
    std::fs::create_dir_all(&sibling)?;
    let inside = root.join("inside.webp");
    let outside = sibling.join("outside.webp");
    std::fs::write(&inside, b"webp")?;
    std::fs::write(&outside, b"webp")?;

    assert!(is_path_inside_directory(&inside, &root));
    assert!(!is_path_inside_directory(&outside, &root));
    Ok(())
}
