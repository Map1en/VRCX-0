use vrcx_0_application::collections::{
    get_or_create_share_owner_token, register_world_open_share, share_collection_create,
    ShareCollectionCreateInput, ShareCollectionCreateResult, ShareCollectionDeps,
    SharedCollectionImportStartInput, SharedCollectionImportStatus,
};
use vrcx_0_composition::Result;

use super::{DesktopRuntimeHostState, SHARE_EDITOR_ORIGIN};

impl DesktopRuntimeHostState {
    pub async fn share_collection_create(
        &self,
        input: ShareCollectionCreateInput,
    ) -> Result<ShareCollectionCreateResult> {
        let identity = self.runtime.desktop_assembly().auth_scope().identity();
        Ok(share_collection_create(
            ShareCollectionDeps::new(
                &self.world_collections,
                &self.world_collections,
                &identity.user_id,
                &identity.display_name,
            ),
            input,
        )
        .await?)
    }

    pub async fn open_shared_collection_manager(&self) -> Result<()> {
        let auth_scope = self.runtime.desktop_assembly().auth_scope().snapshot();
        let owner_token = get_or_create_share_owner_token(
            &self.world_collections,
            &self.world_collections,
            &auth_scope.current_user_id,
        )
        .await?;
        let url = format!("{SHARE_EDITOR_ORIGIN}/mine#k={owner_token}");
        vrcx_0_host_desktop::shell_actions::open_link(&url)
            .map_err(|error| vrcx_0_application_core::Error::Custom(error.to_string()).into())
    }

    pub async fn register_world_open_share(&self, world_id: String) {
        let auth_scope = self.runtime.desktop_assembly().auth_scope().snapshot();
        if let Err(error) = register_world_open_share(
            &self.world_collections,
            &self.world_collections,
            &auth_scope.current_user_id,
            &world_id,
        )
        .await
        {
            tracing::warn!(error = %error, "app__world_open_register: best-effort registration failed");
        }
    }

    pub async fn preview_shared_collection(
        &self,
        id: &str,
    ) -> Result<vrcx_0_application::collections::ImportPreview> {
        Ok(
            vrcx_0_application::collections::preview_shared_collection(&self.world_collections, id)
                .await?,
        )
    }

    pub fn start_shared_collection_import(
        &self,
        input: SharedCollectionImportStartInput,
    ) -> Result<SharedCollectionImportStatus> {
        Ok(self.runtime.shared_collection_import().start(input)?)
    }

    pub fn shared_collection_import_status(&self) -> SharedCollectionImportStatus {
        self.runtime.shared_collection_import().status()
    }

    pub fn start_note_export(
        &self,
        input: vrcx_0_application::social::NoteExportStartInput,
    ) -> Result<vrcx_0_application::social::NoteExportStatus> {
        Ok(self.runtime.note_export().start(input)?)
    }

    pub fn note_export_status(&self) -> vrcx_0_application::social::NoteExportStatus {
        self.runtime.note_export().status()
    }

    pub fn cancel_note_export(&self) -> vrcx_0_application::social::NoteExportStatus {
        self.runtime.note_export().cancel()
    }
}
