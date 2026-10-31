use std::sync::Arc;

use vrcx_0_application_core::{
    FavoriteChangeScope, FavoritesChangedPayload, RemoteMutationGate, RuntimeAuthScope,
    RuntimeAuthScopeSnapshot, RuntimeDiagnostics, RuntimeEventBus, RuntimeOperationStatus,
    RuntimeSyncEngine, WorldCache,
};
use vrcx_0_contracts::social_aggregates::{FavoriteLocalInput, FavoriteOutput};
use vrcx_0_core::FavoriteEntityKind;

use super::bulk_remove::{remove_favorites_selection, FavoriteBulkRemoveDeps};
use super::favorite_transfer::{transfer_favorite_selection, FavoriteTransferDeps};
use super::local_favorites::{
    add_local_favorite_scoped, create_local_favorite_group_scoped,
    delete_local_favorite_group_scoped, remove_local_favorite_scoped,
    rename_local_favorite_group_scoped, reorder_local_favorite_groups_scoped,
    reorder_local_favorites_scoped, LocalFavoriteMutationDeps,
};
use super::remote_favorites::{
    add_remote_favorite, clear_remote_favorite_group, delete_remote_favorite,
    save_remote_favorite_group, FavoriteRemoteMutationDeps,
};
use super::{
    FavoriteBulkRemoveInput, FavoriteBulkRemoveResult, FavoriteImportLocation,
    FavoriteImportOperation, FavoriteImportStatus, FavoriteRemoteAddInput,
    FavoriteRemoteDeleteInput, FavoriteRemoteGroupClearInput, FavoriteRemoteGroupSaveInput,
    FavoriteTransferSelectionInput, FavoriteTransferSelectionResult, LocalFavoriteGroupWrite,
};
use vrcx_0_application_core::{AuthenticatedMutationContext, Result};
use vrcx_0_core::OwnerId;

#[derive(Clone)]
pub struct FavoriteMutationCoordinator {
    store: Arc<dyn super::FavoriteStore>,
    remote: Arc<dyn super::FavoriteRemote>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
    event_bus: RuntimeEventBus,
    auth_scope: RuntimeAuthScope,
    remote_mutations: Arc<RemoteMutationGate>,
    world_cache: Arc<WorldCache>,
}

#[derive(Clone)]
pub struct FavoriteMutationRuntimeDeps {
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
    event_bus: RuntimeEventBus,
    auth_scope: RuntimeAuthScope,
    remote_mutations: Arc<RemoteMutationGate>,
    world_cache: Arc<WorldCache>,
}

impl FavoriteMutationRuntimeDeps {
    pub fn new(
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
        event_bus: RuntimeEventBus,
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
        world_cache: Arc<WorldCache>,
    ) -> Self {
        Self {
            diagnostics,
            sync,
            event_bus,
            auth_scope,
            remote_mutations,
            world_cache,
        }
    }
}

impl FavoriteMutationCoordinator {
    pub fn new(
        store: Arc<dyn super::FavoriteStore>,
        remote: Arc<dyn super::FavoriteRemote>,
        runtime: FavoriteMutationRuntimeDeps,
    ) -> Self {
        Self {
            store,
            remote,
            diagnostics: runtime.diagnostics,
            sync: runtime.sync,
            event_bus: runtime.event_bus,
            auth_scope: runtime.auth_scope,
            remote_mutations: runtime.remote_mutations,
            world_cache: runtime.world_cache,
        }
    }

    fn capture(&self, label: &'static str) -> Result<AuthenticatedMutationContext<'_>> {
        AuthenticatedMutationContext::capture(&self.auth_scope, &self.remote_mutations, label)
    }

    fn local_deps(&self, label: &'static str) -> Result<LocalFavoriteMutationDeps<'_>> {
        Ok(LocalFavoriteMutationDeps {
            store: self.store.as_ref(),
            event_bus: &self.event_bus,
            mutation: self.capture(label)?,
        })
    }

    fn remote_deps(&self, label: &'static str) -> Result<FavoriteRemoteMutationDeps<'_>> {
        Ok(FavoriteRemoteMutationDeps {
            remote: self.remote.as_ref(),
            event_bus: &self.event_bus,
            mutation: self.capture(label)?,
        })
    }

    fn notify_invalidated(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
        kind: FavoriteChangeScope,
        local_changed: bool,
        remote_changed: bool,
    ) {
        if !local_changed && !remote_changed {
            return;
        }
        self.event_bus
            .emit_favorites_changed(FavoritesChangedPayload::invalidated(
                scope,
                kind,
                local_changed,
                remote_changed,
            ));
    }

    pub fn add_local(
        &self,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_name: String,
    ) -> Result<i64> {
        add_local_favorite_scoped(
            &self.local_deps("Local favorite mutation")?,
            kind,
            entity_id,
            group_name,
        )
    }

    pub fn remove_local(
        &self,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_name: String,
    ) -> Result<i64> {
        remove_local_favorite_scoped(
            &self.local_deps("Local favorite mutation")?,
            kind,
            entity_id,
            group_name,
        )
    }

    pub fn create_local_group(
        &self,
        kind: FavoriteEntityKind,
        group_name: String,
    ) -> Result<LocalFavoriteGroupWrite> {
        create_local_favorite_group_scoped(
            &self.local_deps("Local favorite mutation")?,
            kind,
            group_name,
        )
    }

    pub fn rename_local_group(
        &self,
        kind: FavoriteEntityKind,
        group_name: String,
        new_group_name: String,
    ) -> Result<LocalFavoriteGroupWrite> {
        rename_local_favorite_group_scoped(
            &self.local_deps("Local favorite mutation")?,
            kind,
            group_name,
            new_group_name,
        )
    }

    pub fn delete_local_group(
        &self,
        kind: FavoriteEntityKind,
        group_name: String,
    ) -> Result<LocalFavoriteGroupWrite> {
        delete_local_favorite_group_scoped(
            &self.local_deps("Local favorite mutation")?,
            kind,
            group_name,
        )
    }

    pub fn reorder_local_groups(
        &self,
        kind: FavoriteEntityKind,
        group_names: Vec<String>,
    ) -> Result<Vec<String>> {
        reorder_local_favorite_groups_scoped(
            &self.local_deps("Local favorite mutation")?,
            kind,
            group_names,
        )
    }

    pub fn reorder_local(
        &self,
        kind: FavoriteEntityKind,
        group_name: String,
        entity_ids: Vec<String>,
    ) -> Result<i64> {
        reorder_local_favorites_scoped(
            &self.local_deps("Local favorite mutation")?,
            kind,
            group_name,
            entity_ids,
        )
    }

    pub fn mutate_local(
        &self,
        label: &'static str,
        input: FavoriteLocalInput,
    ) -> Result<FavoriteOutput> {
        let dry_run = input.dry_run;
        let mutation = self.capture(label)?;
        let output = self.store.mutate_local(
            &OwnerId::new(mutation.scope().current_user_id.clone()),
            input,
        )?;
        if !dry_run {
            mutation.ensure_current()?;
            self.notify_invalidated(mutation.scope(), output.kind.into(), true, false);
        }
        Ok(output)
    }

    pub async fn add_remote(
        &self,
        label: &'static str,
        input: FavoriteRemoteAddInput,
    ) -> Result<vrcx_0_application_core::vrchat_api::VrchatApiResponse> {
        let deps = self.remote_deps(label)?;
        add_remote_favorite(&deps, input).await
    }

    pub async fn delete_remote(
        &self,
        label: &'static str,
        input: FavoriteRemoteDeleteInput,
    ) -> Result<vrcx_0_application_core::vrchat_api::VrchatApiResponse> {
        let deps = self.remote_deps(label)?;
        delete_remote_favorite(&deps, input).await
    }

    pub async fn save_remote_group(
        &self,
        label: &'static str,
        input: FavoriteRemoteGroupSaveInput,
    ) -> Result<vrcx_0_application_core::vrchat_api::VrchatApiResponse> {
        let deps = self.remote_deps(label)?;
        save_remote_favorite_group(&deps, input).await
    }

    pub async fn clear_remote_group(
        &self,
        label: &'static str,
        input: FavoriteRemoteGroupClearInput,
    ) -> Result<vrcx_0_application_core::vrchat_api::VrchatApiResponse> {
        let deps = self.remote_deps(label)?;
        clear_remote_favorite_group(&deps, input).await
    }

    pub async fn transfer_selection(
        &self,
        input: FavoriteTransferSelectionInput,
    ) -> Result<FavoriteTransferSelectionResult> {
        let command = "app__favorites_transfer_selection";
        let item_count = input
            .batches
            .iter()
            .map(|batch| batch.items.len())
            .sum::<usize>();
        let kind = input
            .batches
            .first()
            .map(|first| {
                if input.batches.iter().all(|batch| batch.kind == first.kind) {
                    first.kind.into()
                } else {
                    FavoriteChangeScope::All
                }
            })
            .unwrap_or(FavoriteChangeScope::All);
        self.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            format!("Transferring {item_count} favorite item(s)."),
        );
        let mutation = self.capture("Favorite transfer")?;
        let event_scope = mutation.scope().clone();
        let result = transfer_favorite_selection(
            &FavoriteTransferDeps {
                store: self.store.as_ref(),
                remote: self.remote.as_ref(),
                world_cache: self.world_cache.as_ref(),
                mutation,
            },
            input,
        )
        .await;
        match &result {
            Ok(output) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Ok,
                    format!("succeeded={}, failed={}", output.succeeded, output.failed),
                );
                self.sync.record(
                    "favorite",
                    RuntimeOperationStatus::Ready,
                    format!(
                        "Transferred {} favorite item(s); {} failed.",
                        output.succeeded, output.failed
                    ),
                    0,
                );
                self.notify_invalidated(
                    &event_scope,
                    kind,
                    output.local_changed,
                    output.remote_changed,
                );
            }
            Err(error) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Error,
                    error.to_string(),
                );
                self.sync.record_failure("favorite", error.to_string());
            }
        }
        result
    }

    pub async fn remove_selection(
        &self,
        input: FavoriteBulkRemoveInput,
    ) -> Result<FavoriteBulkRemoveResult> {
        let command = "app__favorites_remove_selection";
        let target_count = input.items.len();
        self.diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            format!("Removing {target_count} favorite item(s)."),
        );
        let mutation = self.capture("Favorite bulk remove")?;
        let expected_scope = mutation.scope().clone();
        let result = remove_favorites_selection(
            &FavoriteBulkRemoveDeps {
                store: self.store.as_ref(),
                remote: self.remote.as_ref(),
                mutation,
            },
            input,
        )
        .await;
        match &result {
            Ok(output) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Ok,
                    format!("succeeded={}, failed={}", output.succeeded, output.failed),
                );
                self.sync.record(
                    "favorite",
                    RuntimeOperationStatus::Ready,
                    format!(
                        "Removed {} favorite item(s); {} failed.",
                        output.succeeded, output.failed
                    ),
                    0,
                );
                self.notify_invalidated(
                    &expected_scope,
                    output.kind.into(),
                    output.local_changed,
                    output.remote_changed,
                );
            }
            Err(error) => {
                self.diagnostics.record_command(
                    command,
                    RuntimeOperationStatus::Error,
                    error.to_string(),
                );
                self.sync.record_failure("favorite", error.to_string());
            }
        }
        result
    }

    pub(crate) fn complete_import(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
        status: &FavoriteImportStatus,
        location: Option<FavoriteImportLocation>,
    ) {
        if status.operation != FavoriteImportOperation::Import || status.succeeded == 0 {
            return;
        }
        self.notify_invalidated(
            scope,
            status.kind.into(),
            location == Some(FavoriteImportLocation::Local),
            location == Some(FavoriteImportLocation::Remote),
        );
    }

    pub fn complete_shared_collection_import(
        &self,
        scope: &RuntimeAuthScopeSnapshot,
        imported: usize,
    ) {
        if imported > 0 {
            self.notify_invalidated(scope, FavoriteChangeScope::World, true, false);
        }
    }
}

#[cfg(test)]
mod tests;
