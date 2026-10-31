use std::path::{Path, PathBuf};
use std::sync::Arc;

use vrcx_0_application::media::{
    self as application_media, InventoryItemsCollectDeps, InventoryItemsCollectInput,
    InventoryItemsCollectOutput, LegacyEntityImageKind, LegacyEntityImageUploadInput,
    LegacyMediaUploadDeps,
};
use vrcx_0_application::social::{
    ensure_print_deletable, favorite_state, set_print_favorite, set_print_favorites,
    PrintFavoriteBulkResult, PrintFavoriteState,
};
use vrcx_0_application_core::vrchat_api::VrchatApiRequest;
use vrcx_0_application_core::{
    save_ugc_image_to_file, AuthenticatedMutationContext, ImageCache, RemoteMutationGate,
    RuntimeAuthScope, RuntimeDiagnostics, RuntimeOperationStatus, UgcCategory, WebClient,
};
use vrcx_0_persistence::DatabaseService;
use vrcx_0_platform::app_paths::AppPaths;

use crate::{HostFileAccess, Result};

#[derive(Clone)]
pub struct DesktopMediaRuntime {
    file_access: HostFileAccess,
    paths: AppPaths,
    image_cache: Arc<ImageCache>,
    print_adapter: vrcx_0_outbound_adapters::LocalPrintAdapter,
    media_upload_adapter: vrcx_0_outbound_adapters::LocalMediaUploadAdapter,
    inventory_remote_requests: vrcx_0_outbound_adapters::VrchatInventoryRemoteRequests,
    auth_scope: RuntimeAuthScope,
    remote_mutations: Arc<RemoteMutationGate>,
    diagnostics: RuntimeDiagnostics,
}

impl DesktopMediaRuntime {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        file_access: HostFileAccess,
        paths: AppPaths,
        image_cache: Arc<ImageCache>,
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
        diagnostics: RuntimeDiagnostics,
    ) -> Self {
        let media_upload_adapter =
            vrcx_0_outbound_adapters::LocalMediaUploadAdapter::new(Arc::clone(&web));
        let inventory_remote_requests =
            vrcx_0_outbound_adapters::VrchatInventoryRemoteRequests::new(Arc::clone(&web));
        let print_adapter =
            vrcx_0_outbound_adapters::LocalPrintAdapter::new(Arc::clone(&db), Arc::clone(&web));
        Self {
            file_access,
            paths,
            image_cache,
            print_adapter,
            media_upload_adapter,
            inventory_remote_requests,
            auth_scope,
            remote_mutations,
            diagnostics,
        }
    }

    pub fn prepare_media_upload_request(
        &self,
        input: VrchatApiRequest,
    ) -> vrcx_0_application_core::Result<VrchatApiRequest> {
        application_media::prepare_media_upload_request(&self.media_upload_adapter, input)
    }

    pub fn decode_image_file(
        &self,
        default_name: &str,
        base64_data: &str,
    ) -> Result<(String, Vec<u8>)> {
        Ok(vrcx_0_media::media_files::decode_image_file(
            default_name,
            base64_data,
        )?)
    }

    pub fn write_image_file(&self, path: PathBuf, file_name: &str, bytes: &[u8]) -> Result<String> {
        Ok(vrcx_0_media::media_files::write_image_file(
            path, file_name, bytes,
        )?)
    }

    pub fn resize_image_to_fit_limits(&self, base64_data: &str) -> Result<String> {
        Ok(vrcx_0_media::image_processing::resize_image_to_fit_limits_base64(base64_data)?)
    }

    pub fn crop_all_prints(&self, ugc_folder_path: &str) -> Result<()> {
        self.file_access
            .ensure_write_allowed(ugc_folder_path, &self.paths)?;
        Ok(vrcx_0_media::image_processing::crop_all_prints(
            ugc_folder_path,
        )?)
    }

    pub fn crop_print_image(&self, path: &str) -> Result<bool> {
        self.file_access.ensure_write_allowed(path, &self.paths)?;
        vrcx_0_media::image_processing::crop_print_file(Path::new(path)).map_err(|error| {
            vrcx_0_application_core::Error::Custom(format!("{path}: {error}")).into()
        })
    }

    pub async fn save_ugc_category(
        &self,
        category: UgcCategory,
        url: String,
        ugc_folder_path: String,
        month_folder: String,
        file_name: String,
    ) -> Result<String> {
        self.file_access
            .ensure_write_allowed(&ugc_folder_path, &self.paths)?;
        Ok(save_ugc_image_to_file(
            &self.image_cache,
            &url,
            &ugc_folder_path,
            category,
            &month_folder,
            &file_name,
        )
        .await?)
    }

    pub async fn upload_legacy_entity_image(
        &self,
        input: LegacyEntityImageUploadInput,
        kind: LegacyEntityImageKind,
        command: &str,
    ) -> Result<vrcx_0_application_core::vrchat_api::VrchatApiResponse> {
        let mutation = AuthenticatedMutationContext::capture(
            &self.auth_scope,
            &self.remote_mutations,
            "Legacy media mutation",
        )?;
        self.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            format!("Uploading legacy {} image.", kind.label()),
        );
        let result = application_media::upload_legacy_entity_image(
            LegacyMediaUploadDeps::new(&self.media_upload_adapter, mutation),
            input,
            kind,
        )
        .await;
        match &result {
            Ok(response) => self.diagnostics.record_command(
                command,
                RuntimeOperationStatus::Ok,
                format!("status={}", response.status),
            ),
            Err(error) => self.diagnostics.record_command(
                command,
                RuntimeOperationStatus::Error,
                error.to_string(),
            ),
        }
        Ok(result?)
    }

    pub fn print_favorites(&self) -> Result<PrintFavoriteState> {
        Ok(favorite_state(
            &self.print_adapter,
            &self.auth_scope.snapshot().current_user_id,
        )?)
    }

    pub fn set_print_favorite(&self, print_id: &str, favorite: bool) -> Result<PrintFavoriteState> {
        Ok(set_print_favorite(
            &self.print_adapter,
            &self.auth_scope.snapshot().current_user_id,
            print_id,
            favorite,
        )?)
    }

    pub fn set_print_favorites(
        &self,
        print_ids: &[String],
        favorite: bool,
    ) -> Result<PrintFavoriteBulkResult> {
        Ok(set_print_favorites(
            &self.print_adapter,
            &self.auth_scope.snapshot().current_user_id,
            print_ids,
            favorite,
        )?)
    }

    pub fn ensure_print_deletable(&self, print_id: &str) -> vrcx_0_application_core::Result<()> {
        ensure_print_deletable(
            &self.print_adapter,
            &self.auth_scope.snapshot().current_user_id,
            print_id,
        )
    }

    pub async fn collect_inventory_items(
        &self,
        input: InventoryItemsCollectInput,
    ) -> Result<InventoryItemsCollectOutput> {
        let expected_scope = self.auth_scope.snapshot();
        if !expected_scope.active || expected_scope.current_user_id.trim().is_empty() {
            return Err(vrcx_0_application_core::Error::Custom(
                "Inventory collect requires an authenticated session.".into(),
            )
            .into());
        }
        Ok(application_media::collect_inventory_items(
            &InventoryItemsCollectDeps::new(
                &self.inventory_remote_requests,
                &self.auth_scope,
                expected_scope,
            ),
            input,
        )
        .await?)
    }
}
