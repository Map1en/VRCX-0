use vrcx_0_contracts::{
    social_aggregates::{FavoriteLocalInput, FavoriteOutput},
    FavoriteRow, LocalFavoriteGroup,
};

use vrcx_0_application_core::{AuthenticatedMutationContext, Result};
use vrcx_0_application_core::{
    FavoriteChange, FavoriteChangeScope, FavoriteEntityKind, FavoritesChangedPayload,
    RuntimeEventBus,
};
use vrcx_0_core::OwnerId;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FavoriteMoveResult {
    pub removed: i64,
    pub added: i64,
}

pub trait FavoriteStore: Send + Sync {
    fn list_groups(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<LocalFavoriteGroup>>;
    fn create_group(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        name: &str,
    ) -> Result<LocalFavoriteGroup>;
    fn rename_group(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_id: i64,
        name: &str,
    ) -> Result<i64>;
    fn delete_group(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_id: i64,
    ) -> Result<i64>;
    fn reorder_groups(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_ids: &[i64],
    ) -> Result<Vec<LocalFavoriteGroup>>;
    fn list(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>>;
    fn list_custom_order(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>>;
    fn add(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_id: i64,
    ) -> Result<i64>;
    fn remove(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_id: i64,
    ) -> Result<i64>;
    fn move_between_groups(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        source_group_id: i64,
        target_group_id: i64,
    ) -> Result<FavoriteMoveResult>;
    fn reorder(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_id: i64,
        entity_ids: Vec<String>,
    ) -> Result<i64>;
    fn mutate_local(
        &self,
        owner_user_id: &OwnerId,
        input: FavoriteLocalInput,
    ) -> Result<FavoriteOutput>;
}

#[derive(Clone, Debug, serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct LocalFavoriteSnapshot {
    pub favorites: Vec<FavoriteRow>,
    pub groups: Vec<LocalFavoriteGroup>,
}

pub(super) struct LocalFavoriteMutationDeps<'a> {
    pub store: &'a dyn FavoriteStore,
    pub event_bus: &'a RuntimeEventBus,
    pub mutation: AuthenticatedMutationContext<'a>,
}

impl LocalFavoriteMutationDeps<'_> {
    fn owner(&self) -> OwnerId {
        OwnerId::new(self.mutation.scope().current_user_id.clone())
    }
}

fn notify_local_favorite_change(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    change: FavoriteChange,
) {
    let payload = if kind == FavoriteEntityKind::World {
        FavoritesChangedPayload::invalidated(
            deps.mutation.scope(),
            FavoriteChangeScope::World,
            true,
            false,
        )
    } else {
        FavoritesChangedPayload::from_changes(
            deps.mutation.scope(),
            kind.into(),
            true,
            false,
            vec![change],
        )
    };
    deps.event_bus.emit(payload);
}

pub(super) fn add_local_favorite_scoped(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_id: i64,
) -> Result<i64> {
    deps.mutation.ensure_current()?;
    let affected = deps
        .store
        .add(Some(&deps.owner()), kind, entity_id.clone(), group_id)?;
    deps.mutation.ensure_current()?;
    notify_local_favorite_change(
        deps,
        kind,
        FavoriteChange::LocalAdded {
            kind,
            entity_id,
            group_id,
        },
    );
    Ok(affected)
}

pub(super) fn remove_local_favorite_scoped(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_id: i64,
) -> Result<i64> {
    deps.mutation.ensure_current()?;
    let affected = deps
        .store
        .remove(Some(&deps.owner()), kind, entity_id.clone(), group_id)?;
    deps.mutation.ensure_current()?;
    notify_local_favorite_change(
        deps,
        kind,
        FavoriteChange::LocalRemoved {
            kind,
            entity_id,
            group_id,
        },
    );
    Ok(affected)
}

pub fn list_local_favorites(
    store: &dyn FavoriteStore,
    owner_user_id: &OwnerId,
    kind: FavoriteEntityKind,
) -> Result<Vec<FavoriteRow>> {
    store.list(Some(owner_user_id), kind)
}

pub fn list_local_favorite_custom_order(
    store: &dyn FavoriteStore,
    owner_user_id: &OwnerId,
    kind: FavoriteEntityKind,
) -> Result<Vec<FavoriteRow>> {
    store.list_custom_order(Some(owner_user_id), kind)
}

pub fn get_local_favorite_snapshot(
    store: &dyn FavoriteStore,
    owner_user_id: &OwnerId,
    kind: FavoriteEntityKind,
) -> Result<LocalFavoriteSnapshot> {
    Ok(LocalFavoriteSnapshot {
        favorites: list_local_favorites(store, owner_user_id, kind)?,
        groups: store.list_groups(Some(owner_user_id), kind)?,
    })
}

pub(super) fn reorder_local_favorite_groups_scoped(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    group_ids: Vec<i64>,
) -> Result<Vec<LocalFavoriteGroup>> {
    deps.mutation.ensure_current()?;
    let groups = deps
        .store
        .reorder_groups(Some(&deps.owner()), kind, &group_ids)?;
    deps.mutation.ensure_current()?;
    deps.event_bus.emit(FavoritesChangedPayload::invalidated(
        deps.mutation.scope(),
        kind.into(),
        true,
        false,
    ));
    Ok(groups)
}

pub(super) fn reorder_local_favorites_scoped(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    group_id: i64,
    entity_ids: Vec<String>,
) -> Result<i64> {
    deps.mutation.ensure_current()?;
    let affected = deps
        .store
        .reorder(Some(&deps.owner()), kind, group_id, entity_ids)?;
    deps.mutation.ensure_current()?;
    Ok(affected)
}

pub(super) fn create_local_favorite_group_scoped(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    name: String,
) -> Result<LocalFavoriteGroup> {
    deps.mutation.ensure_current()?;
    let group = deps.store.create_group(Some(&deps.owner()), kind, &name)?;
    deps.mutation.ensure_current()?;
    notify_local_favorite_change(
        deps,
        kind,
        FavoriteChange::LocalGroupCreated {
            group: group.clone(),
        },
    );
    Ok(group)
}

pub(super) fn rename_local_favorite_group_scoped(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    group_id: i64,
    name: String,
) -> Result<i64> {
    deps.mutation.ensure_current()?;
    let affected = deps
        .store
        .rename_group(Some(&deps.owner()), kind, group_id, &name)?;
    deps.mutation.ensure_current()?;
    if affected > 0 {
        notify_local_favorite_change(
            deps,
            kind,
            FavoriteChange::LocalGroupRenamed {
                kind,
                group_id,
                name: name.trim().to_string(),
            },
        );
    }
    Ok(affected)
}

pub(super) fn delete_local_favorite_group_scoped(
    deps: &LocalFavoriteMutationDeps<'_>,
    kind: FavoriteEntityKind,
    group_id: i64,
) -> Result<i64> {
    deps.mutation.ensure_current()?;
    let affected = deps
        .store
        .delete_group(Some(&deps.owner()), kind, group_id)?;
    deps.mutation.ensure_current()?;
    notify_local_favorite_change(
        deps,
        kind,
        FavoriteChange::LocalGroupDeleted { kind, group_id },
    );
    Ok(affected)
}
