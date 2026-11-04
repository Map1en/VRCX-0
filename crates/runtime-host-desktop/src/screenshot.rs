use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use vrcx_0_application::media::ScreenshotFavorites;
use vrcx_0_application_core::RuntimeEventBus;
use vrcx_0_core::screenshots::{
    plan_screenshot_zip_entries, screenshot_export_file_name, ScreenshotZipEntry,
};
use vrcx_0_core::screenshots::{
    FavoriteScreenshots, ScreenshotExportProgress, ScreenshotFacet, ScreenshotFilter,
    ScreenshotPrintInput, ScreenshotQueryResult, ScreenshotShareFacts, ScreenshotShareMessage,
    ScreenshotShareProgress, ScreenshotShareRecord, ScreenshotShareSendResult,
    ScreenshotShareTarget, ScreenshotShareTargetInput,
};
use vrcx_0_media::screenshot_print::compose_screenshot_print;
use vrcx_0_outbound_adapters::screenshots::{
    self as screenshot, print_file_stem, LocalScreenshotFavoriteStore,
    LocalScreenshotLibraryAdapter, ScreenshotExportOutcome, ScreenshotFolderTree,
    ScreenshotLibraryImage, ScreenshotLibraryScanStatus, ScreenshotShareService,
    ScreenshotTimeWindow, ScreenshotWindowImages,
};
use vrcx_0_persistence::screenshot_cache::MetadataCacheDb;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_platform::app_paths::AppPaths;

use vrcx_0_application_core::WebClient;

use crate::{HostFileAccess, Result};

pub struct ScreenshotExportPlan {
    pub entries: Vec<ScreenshotZipEntry>,
    pub file_name: String,
    pub total_bytes: u64,
}

const EXPORT_PROGRESS_THROTTLE: Duration = Duration::from_millis(120);

fn export_timestamp() -> String {
    chrono::Local::now().format("%Y%m%d-%H%M").to_string()
}

fn ensure_export_space(output_path: &Path, required_bytes: u64) -> Result<()> {
    let Some(parent) = output_path.parent() else {
        return Ok(());
    };
    let Ok(available) = fs4::available_space(parent) else {
        return Ok(());
    };
    if available < required_bytes {
        return Err(vrcx_0_application_core::Error::Custom(format!(
            "Not enough free space at the destination: {required_bytes} bytes needed, {available} bytes available."
        )).into());
    }
    Ok(())
}

#[derive(Clone)]
pub struct DesktopScreenshotRuntime {
    cache: MetadataCacheDb,
    favorites: ScreenshotFavorites,
    host_file_access: HostFileAccess,
    paths: AppPaths,
    photos_root: String,
    event_bus: RuntimeEventBus,
    export_cancelled: Arc<AtomicBool>,
    share: ScreenshotShareService,
}

impl DesktopScreenshotRuntime {
    pub(crate) fn new(
        cache: MetadataCacheDb,
        db: Arc<DatabaseService>,
        host_file_access: HostFileAccess,
        paths: AppPaths,
        photos_root: String,
        event_bus: RuntimeEventBus,
        web: Arc<WebClient>,
    ) -> Self {
        let share =
            ScreenshotShareService::new(Arc::clone(&db), cache.clone(), photos_root.clone(), web);
        let favorites = ScreenshotFavorites::new(
            Arc::new(LocalScreenshotFavoriteStore::new(db)),
            Arc::new(LocalScreenshotLibraryAdapter::new(
                cache.clone(),
                paths.screenshot_thumbs.clone(),
            )),
        );
        Self {
            cache,
            favorites,
            host_file_access,
            paths,
            photos_root,
            event_bus,
            export_cancelled: Arc::new(AtomicBool::new(false)),
            share,
        }
    }

    pub fn share_targets(&self) -> Result<Vec<ScreenshotShareTarget>> {
        Ok(self.share.targets()?)
    }

    pub async fn save_share_target(
        &self,
        input: ScreenshotShareTargetInput,
    ) -> Result<ScreenshotShareTarget> {
        Ok(self.share.save_target(input).await?)
    }

    pub fn delete_share_target(&self, id: &str) -> Result<()> {
        Ok(self.share.delete_target(id)?)
    }

    pub fn share_facts(&self, paths: &[String]) -> Result<Vec<ScreenshotShareFacts>> {
        Ok(self.share.facts(paths)?)
    }

    pub async fn share(
        &self,
        target_id: &str,
        messages: Vec<ScreenshotShareMessage>,
    ) -> Result<ScreenshotShareSendResult> {
        for path in messages.iter().flat_map(|message| &message.paths) {
            self.ensure_read_allowed(path)?;
        }
        Ok(self.share.send(target_id, messages).await?)
    }

    fn render_print(&self, input: &ScreenshotPrintInput) -> Result<Vec<u8>> {
        self.ensure_read_allowed(&input.path)?;
        let source = std::fs::read(&input.path)?;
        Ok(compose_screenshot_print(&source, &input.caption)?)
    }

    pub fn copy_print(&self, input: &ScreenshotPrintInput) -> Result<()> {
        let print = self.render_print(input)?;
        let dir = self.paths.app_data.join("ScreenshotPrints");
        std::fs::create_dir_all(&dir)?;
        for entry in std::fs::read_dir(&dir)?.flatten() {
            if entry.path().extension().is_some_and(|ext| ext == "png") {
                let _ = std::fs::remove_file(entry.path());
            }
        }
        let file = dir.join(format!("{}.png", print_file_stem(&input.path)));
        std::fs::write(&file, print)?;
        Ok(vrcx_0_host_desktop::clipboard::copy_image_to_clipboard(
            &file.to_string_lossy(),
        )?)
    }

    pub fn print_file_name(&self, source: &str) -> String {
        format!("{}.png", print_file_stem(source))
    }

    pub fn save_print(&self, item: &ScreenshotPrintInput, target: &Path) -> Result<()> {
        std::fs::write(target, self.render_print(item)?)?;
        Ok(())
    }

    pub fn save_prints_to_folder(
        &self,
        items: &[ScreenshotPrintInput],
        dir: &Path,
    ) -> Result<Vec<PathBuf>> {
        let mut saved = Vec::with_capacity(items.len());
        for item in items {
            let target = unused_print_path(dir, &item.path);
            self.save_print(item, &target)?;
            saved.push(target);
        }
        Ok(saved)
    }

    pub fn share_progress(&self) -> ScreenshotShareProgress {
        self.share.progress()
    }

    pub fn share_history(&self) -> Result<Vec<ScreenshotShareRecord>> {
        Ok(self.share.history()?)
    }

    pub async fn delete_share_record(&self, id: &str) -> Result<()> {
        Ok(self.share.delete_record(id).await?)
    }

    pub fn ensure_read_allowed(&self, path: &str) -> Result<()> {
        self.host_file_access
            .ensure_read_allowed(path, &self.paths)?;
        self.ensure_managed_screenshot(path)
    }

    pub fn ensure_delete_allowed(&self, path: &str) -> Result<()> {
        self.host_file_access
            .ensure_write_allowed(path, &self.paths)?;
        self.ensure_managed_screenshot(path)
    }

    fn ensure_managed_screenshot(&self, path: &str) -> Result<()> {
        if !screenshot::is_managed_screenshot_file_path(path, &self.photos_root) {
            return Err(vrcx_0_application_core::Error::Custom(
                "Screenshot metadata commands require a VRChat screenshot or library PNG path."
                    .into(),
            )
            .into());
        }
        Ok(())
    }

    pub fn ensure_write_allowed(&self, path: &str) -> Result<()> {
        self.host_file_access
            .ensure_write_allowed(path, &self.paths)?;
        if !screenshot::is_vrchat_screenshot_file_path(Path::new(path)) {
            return Err(vrcx_0_application_core::Error::Custom(
                "Screenshot metadata commands require a VRChat PNG screenshot path.".into(),
            )
            .into());
        }
        Ok(())
    }

    pub fn extra_data(&self, path: &str, carousel_cache: bool) -> Result<String> {
        Ok(screenshot::extra_screenshot_data(
            path,
            carousel_cache,
            &self.cache,
            &self.photos_root,
        )?)
    }

    pub fn metadata_json(&self, path: &str) -> Result<String> {
        Ok(screenshot::screenshot_metadata_json(path)?)
    }

    pub fn last(&self) -> String {
        screenshot::last_screenshot(&self.photos_root)
    }

    pub fn delete_metadata(&self, path: &str) -> bool {
        self.favorites.delete_metadata(path)
    }

    pub fn delete_file(&self, path: &str) -> Result<()> {
        self.ensure_delete_allowed(path)?;
        vrcx_0_host_desktop::shell_actions::move_to_trash(Path::new(path))?;
        screenshot::forget_screenshot_file(&self.cache, &self.paths.screenshot_thumbs, path)?;
        self.favorites.forget(path)?;
        Ok(())
    }

    pub fn set_favorite(&self, path: &str, favorite: bool) -> Result<()> {
        if favorite {
            self.ensure_read_allowed(path)?;
        }
        Ok(self.favorites.set_favorite(path, favorite)?)
    }

    pub fn forget_missing_favorites(&self) -> Result<u32> {
        Ok(self.favorites.forget_missing()?)
    }

    pub fn favorites(&self) -> Result<FavoriteScreenshots> {
        Ok(self.favorites.list(&self.photos_root)?)
    }

    pub fn add_metadata(
        &self,
        path: &str,
        metadata: &str,
        world_id: &str,
        change_filename: bool,
    ) -> String {
        screenshot::add_screenshot_metadata(path, metadata, world_id, change_filename)
    }

    pub fn scan_status(&self) -> ScreenshotLibraryScanStatus {
        self.cache.scan_status()
    }

    pub fn folder_tree(&self) -> Result<ScreenshotFolderTree> {
        Ok(screenshot::screenshot_folder_tree(
            &self.cache,
            &self.photos_root,
        )?)
    }

    pub fn folder_images(&self, folder_path: &str) -> Result<Vec<ScreenshotLibraryImage>> {
        Ok(screenshot::list_screenshot_folder_images(
            &self.cache,
            folder_path,
            &self.photos_root,
        )?)
    }

    pub fn random_path_in_folder_tree(&self, folder_path: &str) -> Result<Option<String>> {
        Ok(screenshot::random_screenshot_path_in_folder_tree(
            &self.cache,
            folder_path,
            &self.photos_root,
        )?)
    }

    pub fn world_screenshots(&self, world_id: &str) -> Result<Vec<ScreenshotLibraryImage>> {
        Ok(screenshot::list_world_screenshots(
            &self.cache,
            world_id,
            &self.photos_root,
        )?)
    }

    pub fn query(
        &self,
        filter: &ScreenshotFilter,
        limit: Option<i64>,
    ) -> Result<ScreenshotQueryResult> {
        Ok(self
            .cache
            .query_screenshots_for_root(&self.photos_root, filter, limit)?)
    }

    pub fn people(&self, filter: &ScreenshotFilter, limit: i64) -> Result<Vec<ScreenshotFacet>> {
        Ok(self
            .cache
            .screenshot_people_for_root(&self.photos_root, filter, limit)?)
    }

    pub fn worlds(&self, filter: &ScreenshotFilter, limit: i64) -> Result<Vec<ScreenshotFacet>> {
        Ok(self
            .cache
            .screenshot_worlds_for_root(&self.photos_root, filter, limit)?)
    }

    pub fn months(
        &self,
        filter: &ScreenshotFilter,
        utc_offset_minutes: i64,
        limit: i64,
    ) -> Result<Vec<ScreenshotFacet>> {
        Ok(self.cache.screenshot_months_for_root(
            &self.photos_root,
            filter,
            utc_offset_minutes,
            limit,
        )?)
    }

    pub fn by_file_names(&self, file_names: &[String]) -> Result<Vec<ScreenshotLibraryImage>> {
        Ok(self
            .cache
            .screenshots_by_file_names_for_root(&self.photos_root, file_names)?)
    }

    pub fn screenshots_in_windows(
        &self,
        windows: &[ScreenshotTimeWindow],
        limit_per_window: i64,
    ) -> Result<Vec<ScreenshotWindowImages>> {
        Ok(screenshot::list_screenshots_in_windows(
            &self.cache,
            windows,
            limit_per_window,
            &self.photos_root,
        )?)
    }

    pub fn ensure_thumbnail(&self, path: &str) -> Result<String> {
        Ok(screenshot::ensure_screenshot_thumbnail(
            path,
            &self.paths.screenshot_thumbs,
            &self.cache,
            &self.photos_root,
        )?)
    }

    pub fn plan_export(
        &self,
        paths: &[String],
        group_by_folder: bool,
    ) -> Result<ScreenshotExportPlan> {
        self.export_cancelled.store(false, Ordering::Release);
        if paths.is_empty() {
            return Err(vrcx_0_application_core::Error::Custom(
                "Select at least one screenshot to export.".into(),
            )
            .into());
        }
        for path in paths {
            self.ensure_managed_screenshot(path)?;
        }

        let entries = plan_screenshot_zip_entries(paths, group_by_folder);
        if entries.is_empty() {
            return Err(vrcx_0_application_core::Error::Custom(
                "None of the selected screenshots have a usable file name.".into(),
            )
            .into());
        }

        let total_bytes = screenshot::total_screenshot_export_bytes(&entries);
        Ok(ScreenshotExportPlan {
            file_name: screenshot_export_file_name(&export_timestamp(), entries.len()),
            total_bytes,
            entries,
        })
    }

    pub fn request_export_cancel(&self) {
        self.export_cancelled.store(true, Ordering::Release);
    }

    pub fn export_zip(
        &self,
        plan: &ScreenshotExportPlan,
        output_path: &Path,
    ) -> Result<ScreenshotExportOutcome> {
        self.host_file_access
            .ensure_write_allowed(output_path, &self.paths)?;
        ensure_export_space(output_path, plan.total_bytes)?;

        let total_files = plan.entries.len() as u32;
        let total_bytes = plan.total_bytes;
        let last_emit = Mutex::new(Instant::now());

        let outcome = screenshot::write_screenshots_zip(
            &plan.entries,
            output_path,
            &|written_bytes, written_files| {
                let mut last = last_emit.lock().unwrap();
                if last.elapsed() < EXPORT_PROGRESS_THROTTLE {
                    return;
                }
                *last = Instant::now();
                self.event_bus.emit(ScreenshotExportProgress {
                    running: true,
                    total_files,
                    written_files,
                    total_bytes,
                    written_bytes,
                    ..Default::default()
                });
            },
            &|| {
                self.event_bus.emit(ScreenshotExportProgress {
                    running: true,
                    finalizing: true,
                    total_files,
                    written_files: total_files,
                    total_bytes,
                    written_bytes: total_bytes,
                    ..Default::default()
                });
            },
            Some(&|| self.export_cancelled.load(Ordering::Acquire)),
        );
        self.export_cancelled.store(false, Ordering::Release);
        Ok(outcome?)
    }

    pub fn emit_export_progress(&self, progress: ScreenshotExportProgress) {
        self.event_bus.emit(progress);
    }

    pub fn delete_all_metadata(&self) {
        self.favorites.delete_all_metadata(&self.photos_root);
    }

    pub(crate) fn screenshot_favorites(&self) -> &ScreenshotFavorites {
        &self.favorites
    }
}

fn unused_print_path(dir: &Path, source: &str) -> PathBuf {
    let stem = print_file_stem(source);
    let mut candidate = dir.join(format!("{stem}.png"));
    let mut suffix = 1;
    while candidate.exists() {
        suffix += 1;
        candidate = dir.join(format!("{stem}_{suffix}.png"));
    }
    candidate
}
