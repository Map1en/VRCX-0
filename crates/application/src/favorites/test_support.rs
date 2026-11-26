use std::collections::HashMap;
use std::sync::Mutex;

use vrcx_0_application_core::{Error, Result, RuntimeAuthScope};
use vrcx_0_contracts::vrchat_api::VrchatResponse;
use vrcx_0_contracts::{
    social_aggregates::{FavoriteAction, FavoriteLocalInput, FavoriteOutput},
    FavoriteRow, LocalFavoriteGroup,
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
    online_favorites: Option<String>,
    favorite_groups: Option<String>,
    remote_writes: Mutex<Vec<String>>,
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

    pub(super) fn with_online_favorites(
        favorites: Vec<serde_json::Value>,
        groups: Vec<serde_json::Value>,
    ) -> Self {
        Self {
            online_favorites: Some(serde_json::Value::Array(favorites).to_string()),
            favorite_groups: Some(serde_json::Value::Array(groups).to_string()),
            ..Self::default()
        }
    }

    pub(super) fn and_favorite_worlds<'a>(
        mut self,
        rows_by_tag: impl IntoIterator<Item = (&'a str, Vec<serde_json::Value>)>,
    ) -> Self {
        self.favorite_worlds_by_tag =
            Self::with_favorite_worlds(rows_by_tag).favorite_worlds_by_tag;
        self
    }

    pub(super) fn remote_writes(&self) -> Vec<String> {
        self.remote_writes
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
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
        offset: i32,
        _command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        let data = match (offset, &self.online_favorites) {
            (0, Some(rows)) => rows.clone(),
            _ => "[]".to_string(),
        };
        Box::pin(async move { Ok(response(&data)) })
    }

    fn limits<'a>(
        &'a self,
        _endpoint: String,
        _command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        Box::pin(async { Ok(response("{}")) })
    }

    fn groups<'a>(
        &'a self,
        _endpoint: String,
        _n: i32,
        offset: i32,
        _owner_id: String,
        _command: Option<FavoriteRemoteCommand>,
    ) -> FavoriteRemoteFuture<'a, VrchatResponse> {
        let data = match (offset, &self.favorite_groups) {
            (0, Some(rows)) => rows.clone(),
            _ => "[]".to_string(),
        };
        Box::pin(async move { Ok(response(&data)) })
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
        self.remote_writes
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(format!(
                "add {} {} {}",
                input.kind.as_str(),
                input.entity_id,
                input.tags
            ));
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
        self.remote_writes
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .push(format!("delete {object_id}"));
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
struct StoredGroup {
    id: i64,
    kind: FavoriteEntityKind,
    owner_user_id: Option<String>,
    name: String,
    sort_order: i64,
}

#[derive(Clone)]
struct StoredFavorite {
    id: i64,
    sort_order: Option<i64>,
    group_id: i64,
    entity_id: String,
}

#[derive(Default)]
struct TestFavoriteStoreState {
    groups: Vec<StoredGroup>,
    favorites: Vec<StoredFavorite>,
    next_id: i64,
}

#[derive(Default)]
pub(super) struct TestFavoriteStore {
    state: Mutex<TestFavoriteStoreState>,
}

impl TestFavoriteStore {
    fn owner(kind: FavoriteEntityKind, owner_user_id: Option<&OwnerId>) -> Option<String> {
        (kind == FavoriteEntityKind::Friend)
            .then(|| owner_user_id.map(|owner| owner.as_str().to_string()))
            .flatten()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, TestFavoriteStoreState> {
        self.state.lock().unwrap_or_else(|error| error.into_inner())
    }

    fn visible_groups(
        state: &TestFavoriteStoreState,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Vec<StoredGroup> {
        let owner = Self::owner(kind, owner_user_id);
        let mut groups = state
            .groups
            .iter()
            .filter(|group| {
                group.kind == kind
                    && (group.owner_user_id.is_none() || group.owner_user_id == owner)
            })
            .cloned()
            .collect::<Vec<_>>();
        groups.sort_by_key(|group| (group.owner_user_id.is_none(), group.sort_order, group.id));
        groups
    }

    fn visible_group(
        state: &TestFavoriteStoreState,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_id: i64,
    ) -> Result<StoredGroup> {
        Self::visible_groups(state, owner_user_id, kind)
            .into_iter()
            .find(|group| group.id == group_id)
            .ok_or_else(|| Error::Custom("Local favorite group was not found.".into()))
    }

    fn to_group(group: &StoredGroup) -> LocalFavoriteGroup {
        LocalFavoriteGroup {
            id: group.id,
            kind: group.kind,
            name: group.name.clone(),
            shared: group.kind == FavoriteEntityKind::Friend && group.owner_user_id.is_none(),
        }
    }

    fn rows(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        custom_order: bool,
    ) -> Vec<FavoriteRow> {
        let state = self.lock();
        let groups = Self::visible_groups(&state, owner_user_id, kind);
        let mut rows = state
            .favorites
            .iter()
            .filter_map(|row| {
                groups
                    .iter()
                    .find(|group| group.id == row.group_id)
                    .map(|group| (row.clone(), group.name.clone()))
            })
            .collect::<Vec<_>>();
        if custom_order {
            rows.sort_by_key(|(row, _)| (row.sort_order.unwrap_or(-row.id), row.id));
        } else {
            rows.sort_by_key(|(row, _)| row.id);
        }
        rows.into_iter()
            .map(|(row, name)| {
                FavoriteRow::new(kind, String::new(), row.entity_id, row.group_id, name)
            })
            .collect()
    }

    fn insert(state: &mut TestFavoriteStoreState, group_id: i64, entity_id: String) -> i64 {
        if state
            .favorites
            .iter()
            .any(|row| row.group_id == group_id && row.entity_id == entity_id)
        {
            return 0;
        }
        state.next_id += 1;
        let id = state.next_id;
        state.favorites.push(StoredFavorite {
            id,
            sort_order: None,
            group_id,
            entity_id,
        });
        1
    }
}

impl FavoriteStore for TestFavoriteStore {
    fn list_groups(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<LocalFavoriteGroup>> {
        Ok(Self::visible_groups(&self.lock(), owner_user_id, kind)
            .iter()
            .map(Self::to_group)
            .collect())
    }

    fn create_group(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        name: &str,
    ) -> Result<LocalFavoriteGroup> {
        let name = name.trim().to_string();
        if name.is_empty() {
            return Err(Error::Custom(
                "Local favorite group name is required.".into(),
            ));
        }
        let owner = Self::owner(kind, owner_user_id);
        let mut state = self.lock();
        if let Some(group) = state
            .groups
            .iter()
            .find(|group| group.kind == kind && group.owner_user_id == owner && group.name == name)
        {
            return Ok(Self::to_group(group));
        }
        state.next_id += 1;
        let group = StoredGroup {
            id: state.next_id,
            kind,
            sort_order: state
                .groups
                .iter()
                .filter(|group| group.kind == kind && group.owner_user_id == owner)
                .map(|group| group.sort_order + 1)
                .max()
                .unwrap_or_default(),
            owner_user_id: owner,
            name,
        };
        state.groups.push(group.clone());
        Ok(Self::to_group(&group))
    }

    fn rename_group(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_id: i64,
        name: &str,
    ) -> Result<i64> {
        let name = name.trim().to_string();
        let mut state = self.lock();
        let group = Self::visible_group(&state, owner_user_id, kind, group_id)?;
        if group.name == name {
            return Ok(0);
        }
        if state.groups.iter().any(|other| {
            other.id != group_id
                && other.kind == kind
                && other.owner_user_id == group.owner_user_id
                && other.name == name
        }) {
            return Err(Error::Custom(
                "A local favorite group with this name already exists.".into(),
            ));
        }
        for stored in state
            .groups
            .iter_mut()
            .filter(|stored| stored.id == group_id)
        {
            stored.name = name.clone();
        }
        Ok(1)
    }

    fn delete_group(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_id: i64,
    ) -> Result<i64> {
        let mut state = self.lock();
        Self::visible_group(&state, owner_user_id, kind, group_id)?;
        let before = state.favorites.len();
        state.favorites.retain(|row| row.group_id != group_id);
        let removed = (before - state.favorites.len()) as i64;
        state.groups.retain(|group| group.id != group_id);
        Ok(removed)
    }

    fn reorder_groups(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_ids: &[i64],
    ) -> Result<Vec<LocalFavoriteGroup>> {
        {
            let mut state = self.lock();
            let current = Self::visible_groups(&state, owner_user_id, kind);
            let mut order: Vec<i64> = Vec::new();
            for group_id in group_ids
                .iter()
                .copied()
                .chain(current.iter().map(|group| group.id))
            {
                if current.iter().any(|group| group.id == group_id) && !order.contains(&group_id) {
                    order.push(group_id);
                }
            }
            for (position, group_id) in order.iter().enumerate() {
                for group in state
                    .groups
                    .iter_mut()
                    .filter(|group| group.id == *group_id)
                {
                    group.sort_order = position as i64;
                }
            }
        }
        self.list_groups(owner_user_id, kind)
    }

    fn list(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>> {
        Ok(self.rows(owner_user_id, kind, false))
    }

    fn list_custom_order(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>> {
        Ok(self.rows(owner_user_id, kind, true))
    }

    fn add(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_id: i64,
    ) -> Result<i64> {
        let mut state = self.lock();
        Self::visible_group(&state, owner_user_id, kind, group_id)?;
        Ok(Self::insert(
            &mut state,
            group_id,
            entity_id.trim().to_string(),
        ))
    }

    fn remove(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        group_id: i64,
    ) -> Result<i64> {
        let mut state = self.lock();
        if Self::visible_group(&state, owner_user_id, kind, group_id).is_err() {
            return Ok(0);
        }
        let before = state.favorites.len();
        state
            .favorites
            .retain(|row| !(row.group_id == group_id && row.entity_id == entity_id));
        Ok((before - state.favorites.len()) as i64)
    }

    fn move_between_groups(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        entity_id: String,
        source_group_id: i64,
        target_group_id: i64,
    ) -> Result<FavoriteMoveResult> {
        {
            let state = self.lock();
            Self::visible_group(&state, owner_user_id, kind, source_group_id)?;
            Self::visible_group(&state, owner_user_id, kind, target_group_id)?;
        }
        let removed = self.remove(owner_user_id, kind, entity_id.clone(), source_group_id)?;
        let added = self.add(owner_user_id, kind, entity_id, target_group_id)?;
        Ok(FavoriteMoveResult { removed, added })
    }

    fn reorder(
        &self,
        owner_user_id: Option<&OwnerId>,
        kind: FavoriteEntityKind,
        group_id: i64,
        entity_ids: Vec<String>,
    ) -> Result<i64> {
        let mut state = self.lock();
        Self::visible_group(&state, owner_user_id, kind, group_id)?;
        let mut affected = 0;
        for (position, entity_id) in entity_ids.iter().enumerate() {
            for row in state
                .favorites
                .iter_mut()
                .filter(|row| row.group_id == group_id && &row.entity_id == entity_id)
            {
                row.sort_order = Some(position as i64);
                affected += 1;
            }
        }
        Ok(affected)
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
            let existing = self
                .list_groups(Some(owner_user_id), input.kind)?
                .into_iter()
                .find(|candidate| candidate.name == group);
            match input.action {
                FavoriteAction::Add => {
                    let target = match existing {
                        Some(target) => target,
                        None => self.create_group(Some(owner_user_id), input.kind, &group)?,
                    };
                    self.add(
                        Some(owner_user_id),
                        input.kind,
                        entity_id.clone(),
                        target.id,
                    )?
                }
                FavoriteAction::Remove => match existing {
                    Some(target) => self.remove(
                        Some(owner_user_id),
                        input.kind,
                        entity_id.clone(),
                        target.id,
                    )?,
                    None => 0,
                },
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
