use std::sync::Arc;

use vrcx_0_application::favorites::{FavoriteMoveResult, FavoriteStore};
use vrcx_0_application_core::Result;
use vrcx_0_contracts::{
    social_aggregates::{FavoriteLocalInput, FavoriteOutput},
    FavoriteRow, LocalFavoriteGroup,
};
use vrcx_0_core::{FavoriteEntityKind, OwnerId};
use vrcx_0_persistence::{favorites, social_aggregates, DatabaseService};

pub struct LocalFavoriteStore {
    db: Arc<DatabaseService>,
}

impl LocalFavoriteStore {
    pub fn new(db: Arc<DatabaseService>) -> Self {
        Self { db }
    }
}

impl FavoriteStore for LocalFavoriteStore {
    fn list_groups(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<LocalFavoriteGroup>> {
        favorites::favorite_group_list(self.db.as_ref(), owner_user_id, kind).map_err(Into::into)
    }

    fn create_group(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        name: &str,
    ) -> Result<LocalFavoriteGroup> {
        favorites::favorite_group_create(self.db.as_ref(), owner_user_id, kind, name)
            .map_err(Into::into)
    }

    fn rename_group(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_id: i64,
        name: &str,
    ) -> Result<i64> {
        favorites::favorite_group_rename(self.db.as_ref(), owner_user_id, kind, group_id, name)
            .map_err(Into::into)
    }

    fn delete_group(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_id: i64,
    ) -> Result<i64> {
        favorites::favorite_group_delete(self.db.as_ref(), owner_user_id, kind, group_id)
            .map_err(Into::into)
    }

    fn reorder_groups(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_ids: &[i64],
    ) -> Result<Vec<LocalFavoriteGroup>> {
        favorites::favorite_group_reorder(self.db.as_ref(), owner_user_id, kind, group_ids)
            .map_err(Into::into)
    }

    fn list(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>> {
        favorites::favorite_list(self.db.as_ref(), owner_user_id, kind).map_err(Into::into)
    }

    fn list_custom_order(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>> {
        favorites::favorite_list_custom_order(self.db.as_ref(), owner_user_id, kind)
            .map_err(Into::into)
    }

    fn add(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_id: i64,
    ) -> Result<i64> {
        favorites::favorite_add(self.db.as_ref(), owner_user_id, kind, entity_id, group_id)
            .map_err(Into::into)
    }

    fn remove(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_id: i64,
    ) -> Result<i64> {
        favorites::favorite_remove(self.db.as_ref(), owner_user_id, kind, entity_id, group_id)
            .map_err(Into::into)
    }

    fn move_between_groups(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        source_group_id: i64,
        target_group_id: i64,
    ) -> Result<FavoriteMoveResult> {
        let result = favorites::favorite_move(
            self.db.as_ref(),
            owner_user_id,
            kind,
            entity_id,
            source_group_id,
            target_group_id,
        )?;
        Ok(FavoriteMoveResult {
            removed: result.removed,
            added: result.added,
        })
    }

    fn reorder(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_id: i64,
        entity_ids: Vec<String>,
    ) -> Result<i64> {
        favorites::favorite_reorder(self.db.as_ref(), owner_user_id, kind, group_id, entity_ids)
            .map_err(Into::into)
    }

    fn mutate_local(
        &self,
        owner_user_id: &OwnerId,
        input: FavoriteLocalInput,
    ) -> Result<FavoriteOutput> {
        social_aggregates::favorite_local(self.db.as_ref(), owner_user_id, input)
            .map_err(Into::into)
    }
}
