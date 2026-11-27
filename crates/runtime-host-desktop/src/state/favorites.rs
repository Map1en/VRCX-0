use vrcx_0_application::favorites::{
    FavoriteBulkRemoveInput, FavoriteBulkRemoveResult, FavoriteCacheSnapshotInput,
    FavoriteImportStartInput, FavoriteImportStatus, FavoriteTransferSelectionInput,
    FavoriteTransferSelectionResult,
};
use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub async fn favorite_add_remote(
        &self,
        input: vrcx_0_application::favorites::FavoriteRemoteAddInput,
    ) -> Result<vrcx_0_contracts::vrchat_api::VrchatResponse> {
        Ok(self
            .runtime
            .desktop_assembly()
            .favorite_mutations()
            .add_remote("Remote favorite mutation", input)
            .await?)
    }

    pub async fn favorite_delete_remote(
        &self,
        input: vrcx_0_application::favorites::FavoriteRemoteDeleteInput,
    ) -> Result<vrcx_0_contracts::vrchat_api::VrchatResponse> {
        Ok(self
            .runtime
            .desktop_assembly()
            .favorite_mutations()
            .delete_remote("Remote favorite mutation", input)
            .await?)
    }

    pub async fn favorite_group_save_remote(
        &self,
        input: vrcx_0_application::favorites::FavoriteRemoteGroupSaveInput,
    ) -> Result<vrcx_0_contracts::vrchat_api::VrchatResponse> {
        Ok(self
            .runtime
            .desktop_assembly()
            .favorite_mutations()
            .save_remote_group("Remote favorite mutation", input)
            .await?)
    }

    pub async fn favorite_group_clear_remote(
        &self,
        input: vrcx_0_application::favorites::FavoriteRemoteGroupClearInput,
    ) -> Result<vrcx_0_contracts::vrchat_api::VrchatResponse> {
        Ok(self
            .runtime
            .desktop_assembly()
            .favorite_mutations()
            .clear_remote_group("Remote favorite mutation", input)
            .await?)
    }

    pub fn favorite_local_group_create(
        &self,
        kind: vrcx_0_application_core::FavoriteEntityKind,
        name: String,
    ) -> Result<vrcx_0_application::favorites::LocalFavoriteGroup> {
        Ok(self
            .runtime
            .desktop_assembly()
            .favorite_mutations()
            .create_local_group(kind, name)?)
    }

    pub fn favorite_local_group_rename(
        &self,
        kind: vrcx_0_application_core::FavoriteEntityKind,
        group_id: i64,
        name: String,
    ) -> Result<i64> {
        Ok(self
            .runtime
            .desktop_assembly()
            .favorite_mutations()
            .rename_local_group(kind, group_id, name)?)
    }

    pub fn favorite_local_group_delete(
        &self,
        kind: vrcx_0_application_core::FavoriteEntityKind,
        group_id: i64,
    ) -> Result<i64> {
        Ok(self
            .runtime
            .desktop_assembly()
            .favorite_mutations()
            .delete_local_group(kind, group_id)?)
    }

    pub fn favorite_local_group_reorder(
        &self,
        kind: vrcx_0_application_core::FavoriteEntityKind,
        group_ids: Vec<i64>,
    ) -> Result<Vec<vrcx_0_application::favorites::LocalFavoriteGroup>> {
        Ok(self
            .runtime
            .desktop_assembly()
            .favorite_mutations()
            .reorder_local_groups(kind, group_ids)?)
    }

    pub fn favorite_local_reorder(
        &self,
        kind: vrcx_0_application_core::FavoriteEntityKind,
        group_id: i64,
        entity_ids: Vec<String>,
    ) -> Result<i64> {
        Ok(self
            .runtime
            .desktop_assembly()
            .favorite_mutations()
            .reorder_local(kind, group_id, entity_ids)?)
    }

    pub fn favorite_import_start(
        &self,
        input: FavoriteImportStartInput,
    ) -> Result<FavoriteImportStatus> {
        Ok(self.runtime.favorite_import().start(input)?)
    }

    pub fn favorite_import_status(&self) -> FavoriteImportStatus {
        self.runtime.favorite_import().status()
    }

    pub fn favorite_import_cancel(&self) -> FavoriteImportStatus {
        self.runtime.favorite_import().cancel()
    }

    pub fn favorite_import_dismiss(&self, run_id: &str) -> bool {
        self.runtime.favorite_import().dismiss(run_id)
    }

    pub async fn persist_favorite_cache_snapshot(
        &self,
        input: FavoriteCacheSnapshotInput,
    ) -> Result<bool> {
        let entity = input.entity.clone();
        let refreshes_world_card = matches!(
            input.kind,
            vrcx_0_application::favorites::FavoriteCacheKind::World
        );
        let assembly = self.runtime.desktop_assembly();
        let scope = assembly.auth_scope().snapshot();
        let written = vrcx_0_application::favorites::persist_favorite_cache_snapshot(
            assembly.world_cache(),
            assembly.avatar_cache(),
            &scope.current_user_id,
            &scope.endpoint,
            input,
        )?;
        if written && refreshes_world_card {
            self.favorite_details
                .refresh_world_card(entity.as_value())
                .await;
        }
        Ok(written)
    }

    pub async fn refresh_local_world_favorite_details(
        &self,
    ) -> Result<vrcx_0_application::favorites::LocalWorldDetailsRefreshOutput> {
        let output = self
            .local_data
            .favorite_local_world_details_refresh()
            .await?;
        self.favorite_details.invalidate_world_cards().await;
        Ok(output)
    }

    pub async fn hydrate_favorite_details(
        &self,
        input: vrcx_0_application::favorites::FavoriteDetailsHydrateInput,
    ) -> Result<vrcx_0_application::favorites::FavoriteDetailsHydrateOutput> {
        let expected_scope = self.require_active_scope("Batch action")?;
        Ok(self.favorite_details.hydrate(input, expected_scope).await?)
    }

    pub async fn transfer_favorite_selection(
        &self,
        input: FavoriteTransferSelectionInput,
    ) -> Result<FavoriteTransferSelectionResult> {
        Ok(self
            .runtime
            .desktop_assembly()
            .favorite_mutations()
            .transfer_selection(input)
            .await?)
    }

    pub async fn remove_favorite_selection(
        &self,
        input: FavoriteBulkRemoveInput,
    ) -> Result<FavoriteBulkRemoveResult> {
        Ok(self
            .runtime
            .desktop_assembly()
            .favorite_mutations()
            .remove_selection(input)
            .await?)
    }
}
