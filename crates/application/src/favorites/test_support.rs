use std::collections::HashMap;
use std::sync::Mutex;

use vrcx_0_application_core::{Error, Result, RuntimeAuthScope};
use vrcx_0_contracts::vrchat_api::VrchatResponse;
use vrcx_0_contracts::{
    social_aggregates::{FavoriteAction, FavoriteLocalInput, FavoriteOutput},
    FavoriteRow,
};
use vrcx_0_core::{FavoriteEntityKind, OwnerId};

use super::{
    FavoriteMoveResult, FavoriteRemote, FavoriteRemoteAddInput, FavoriteRemoteCommand,
    FavoriteRemoteFuture, FavoriteRemoteGroupClearInput, FavoriteRemoteGroupSaveInput,
    FavoriteStore,
};

#[derive(Default)]
pub(super) struct TestFavoriteRemote {
    replace_scope_on_clear: Option<RuntimeAuthScope>,
    favorite_worlds_by_tag: HashMap<String, String>,
    fetched_tags: Mutex<Vec<String>>,
    probed_ids: Mutex<Vec<String>>,
}

impl TestFavoriteRemote {
    pub(super) fn replacing_scope_on_clear(scope: RuntimeAuthScope) -> Self {
        Self {
            replace_scope_on_clear: Some(scope),
            ..Self::default()
        }
    }

    pub(super) fn with_favorite_worlds<'a>(
        rows_by_tag: impl IntoIterator<Item = (&'a str, Vec<serde_json::Value>)>,
    ) -> Self {
        Self {
            favorite_worlds_by_tag: rows_by_tag
                .into_iter()
                .map(|(tag, rows)| {
                    (
                        tag.to_string(),
                        serde_json::to_string(&rows).unwrap_or_else(|_| "[]".to_string()),
                    )
                })
                .collect(),
            ..Self::default()
        }
    }

    pub(super) fn fetched_tags(&self) -> Vec<String> {
        self.fetched_tags
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }

    pub(super) fn probed_ids(&self) -> Vec<String> {
        self.probed_ids
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
    }
}

fn response(data: &str) -> VrchatResponse {
    VrchatResponse {
        status: 200,
        data: data.into(),
    }
}

impl FavoriteRemote for TestFavoriteRemote {
    fn list<'a>(
        &'a self,
        _endpoint: String,
        _n: i32,
        _offset: i32,
        _command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async { Ok(response("[]")) })
    }

    fn limits<'a>(
        &'a self,
        _endpoint: String,
        _command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async { Ok(response("{}")) })
    }

    fn favorite_worlds<'a>(
        &'a self,
        _endpoint: String,
        _n: i32,
        offset: i32,
        _owner_id: String,
        _user_id: String,
        tag: String,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move {
            if offset > 0 {
                return Ok(response("[]"));
            }
            self.fetched_tags
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .push(tag.clone());
            Ok(response(
                self.favorite_worlds_by_tag
                    .get(&tag)
                    .map_or("[]", String::as_str),
            ))
        })
    }

    fn favorite_avatars<'a>(
        &'a self,
        _endpoint: String,
        _n: i32,
        _offset: i32,
        _tag: String,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async { Ok(response("[]")) })
    }

    fn world<'a>(
        &'a self,
        _endpoint: String,
        world_id: String,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move {
            self.probed_ids
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .push(world_id.clone());
            if world_id.contains("deleted") {
                return Ok(VrchatResponse {
                    status: 404,
                    data: r#"{"error":{"message":"not found"}}"#.into(),
                });
            }
            if world_id.contains("unreachable") {
                return Ok(VrchatResponse {
                    status: 500,
                    data: r#"{"error":{"message":"boom"}}"#.into(),
                });
            }
            Ok(response(&format!(r#"{{"id":"{world_id}"}}"#)))
        })
    }

    fn avatar<'a>(
        &'a self,
        _endpoint: String,
        avatar_id: String,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move { Ok(response(&format!(r#"{{"id":"{avatar_id}"}}"#))) })
    }

    fn user<'a>(
        &'a self,
        _endpoint: String,
        user_id: String,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async move { Ok(response(&format!(r#"{{"id":"{user_id}"}}"#))) })
    }

    fn add<'a>(
        &'a self,
        _endpoint: String,
        input: FavoriteRemoteAddInput,
        _command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, (String, String, VrchatResponse)> {
        Box::pin(async move {
            let kind = input.kind.as_str().to_string();
            let entity_id = input.entity_id;
            let data = serde_json::json!({"id": "fvrt_test", "favoriteId": entity_id});
            Ok((kind, entity_id, response(&data.to_string())))
        })
    }

    fn delete<'a>(
        &'a self,
        _endpoint: String,
        object_id: String,
        _command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, (String, VrchatResponse)> {
        Box::pin(async move { Ok((object_id, response("{}"))) })
    }

    fn save_group<'a>(
        &'a self,
        _endpoint: String,
        _current_user_id: String,
        input: FavoriteRemoteGroupSaveInput,
        _command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, (String, VrchatResponse)> {
        Box::pin(async move { Ok((input.group, response("{}"))) })
    }

    fn clear_group<'a>(
        &'a self,
        _endpoint: String,
        _current_user_id: String,
        input: FavoriteRemoteGroupClearInput,
        _command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, (String, VrchatResponse)> {
        let replace_scope_on_clear = self.replace_scope_on_clear.clone();
        Box::pin(async move {
            if let Some(scope) = replace_scope_on_clear {
                scope.set("usr_other", "https://api.vrchat.cloud/api/1");
            }
            Ok((input.group, response("{}")))
        })
    }
}

#[derive(Clone)]
struct StoredFavorite {
    id: i64,
    sort_order: Option<i64>,
    owner_user_id: Option<String>,
    kind: FavoriteEntityKind,
    entity_id: String,
    group_name: String,
}

#[derive(Default)]
struct TestFavoriteStoreState {
    configs: HashMap<String, serde_json::Value>,
    favorites: Vec<StoredFavorite>,
    next_id: i64,
}

#[derive(Default)]
pub(super) struct TestFavoriteStore {
    state: Mutex<TestFavoriteStoreState>,
}

impl TestFavoriteStore {
    fn owner(owner_user_id: Option<&OwnerId>) -> Option<String> {
        owner_user_id.map(|owner| owner.as_str().to_string())
    }

    fn visible_rows(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Vec<StoredFavorite> {
        let owner = Self::owner(owner_user_id);
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .favorites
            .iter()
            .filter(|row| {
                row.kind == kind && (row.owner_user_id == owner || row.owner_user_id.is_none())
            })
            .cloned()
            .collect()
    }

    fn rows_to_favorites(rows: Vec<StoredFavorite>) -> Vec<FavoriteRow> {
        rows.into_iter()
            .map(|row| FavoriteRow::new(row.kind, String::new(), row.entity_id, row.group_name))
            .collect()
    }
}

impl FavoriteStore for TestFavoriteStore {
    fn config_json(&self, key: &str, fallback: serde_json::Value) -> Result<serde_json::Value> {
        Ok(self
            .state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .configs
            .get(key)
            .cloned()
            .unwrap_or(fallback))
    }

    fn set_config_json(&self, key: &str, value: serde_json::Value) -> Result<()> {
        self.state
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .configs
            .insert(key.to_string(), value);
        Ok(())
    }

    fn resolve_config_key(&self, key: &str) -> String {
        key.to_string()
    }

    fn list(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>> {
        Ok(Self::rows_to_favorites(
            self.visible_rows(owner_user_id, kind),
        ))
    }

    fn list_custom_order(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>> {
        let mut rows = self.visible_rows(owner_user_id, kind);
        rows.sort_by_key(|row| (row.sort_order.unwrap_or(-row.id), row.id));
        Ok(Self::rows_to_favorites(rows))
    }

    fn add(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_name: String,
    ) -> Result<i64> {
        let owner_user_id = Self::owner(owner_user_id);
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if state.favorites.iter().any(|row| {
            row.owner_user_id == owner_user_id
                && row.kind == kind
                && row.entity_id == entity_id
                && row.group_name == group_name
        }) {
            return Ok(0);
        }
        state.next_id += 1;
        let id = state.next_id;
        state.favorites.push(StoredFavorite {
            id,
            sort_order: None,
            owner_user_id,
            kind,
            entity_id,
            group_name,
        });
        Ok(1)
    }

    fn remove(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_name: String,
    ) -> Result<i64> {
        let owner_user_id = Self::owner(owner_user_id);
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let before = state.favorites.len();
        state.favorites.retain(|row| {
            !(row.owner_user_id == owner_user_id
                && row.kind == kind
                && row.entity_id == entity_id
                && row.group_name == group_name)
        });
        Ok((before - state.favorites.len()) as i64)
    }

    fn move_between_groups(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        source_group_name: String,
        target_group_name: String,
    ) -> Result<FavoriteMoveResult> {
        let removed = self.remove(owner_user_id, kind, entity_id.clone(), source_group_name)?;
        let added = self.add(owner_user_id, kind, entity_id, target_group_name)?;
        Ok(FavoriteMoveResult { removed, added })
    }

    fn reorder(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_name: String,
        entity_ids: Vec<String>,
    ) -> Result<i64> {
        let owner = Self::owner(owner_user_id);
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let mut affected = 0;
        for (position, entity_id) in entity_ids.iter().enumerate() {
            for row in &mut state.favorites {
                if row.kind == kind
                    && (row.owner_user_id == owner || row.owner_user_id.is_none())
                    && row.group_name == group_name
                    && &row.entity_id == entity_id
                {
                    row.sort_order = Some(position as i64);
                    affected += 1;
                }
            }
        }
        Ok(affected)
    }

    fn rename_group_with_config(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        config_key: &str,
        group_name: &str,
        new_group_name: &str,
        groups: &[String],
    ) -> Result<i64> {
        self.set_config_json(config_key, serde_json::json!(groups))?;
        let owner_user_id = if kind == FavoriteEntityKind::Friend && !config_key.contains(':') {
            None
        } else {
            Self::owner(owner_user_id)
        };
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let mut affected = 0;
        for row in &mut state.favorites {
            if row.owner_user_id == owner_user_id
                && row.kind == kind
                && row.group_name == group_name
            {
                row.group_name = new_group_name.to_string();
                affected += 1;
            }
        }
        Ok(affected)
    }

    fn delete_group_with_config(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        config_key: &str,
        group_name: &str,
        groups: &[String],
    ) -> Result<i64> {
        self.set_config_json(config_key, serde_json::json!(groups))?;
        let owner_user_id = if kind == FavoriteEntityKind::Friend && !config_key.contains(':') {
            None
        } else {
            Self::owner(owner_user_id)
        };
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        let before = state.favorites.len();
        state.favorites.retain(|row| {
            !(row.owner_user_id == owner_user_id
                && row.kind == kind
                && row.group_name == group_name)
        });
        Ok((before - state.favorites.len()) as i64)
    }

    fn mutate_local(
        &self,
        owner_user_id: &OwnerId,
        input: FavoriteLocalInput,
    ) -> Result<FavoriteOutput> {
        let entity_id = input.entity_id.trim().to_string();
        let group = input.group.trim().to_string();
        if entity_id.is_empty() || !entity_id.starts_with(input.kind.entity_id_prefix()) {
            return Err(Error::Custom("favorite requires a valid entity id".into()));
        }
        if group.is_empty() {
            return Err(Error::Custom("favorite requires group".into()));
        }
        let affected_rows = if input.dry_run {
            0
        } else {
            match input.action {
                FavoriteAction::Add => self.add(
                    Some(owner_user_id),
                    input.kind,
                    entity_id.clone(),
                    group.clone(),
                )?,
                FavoriteAction::Remove => self.remove(
                    Some(owner_user_id),
                    input.kind,
                    entity_id.clone(),
                    group.clone(),
                )?,
            }
        };
        Ok(FavoriteOutput {
            kind: input.kind,
            entity_id,
            group,
            action: input.action,
            dry_run: input.dry_run,
            affected_rows,
            caveats: Vec::new(),
        })
    }
}
