use serde_json::Value;
use vrcx_0_contracts::game_log::{
    GameLogJoinLeaveSnapshot, GameLogLocationSnapshot, GameLogWriteBatch, GameLogWriteCount,
    PreviousInstanceEventRow, SessionEventRow, SessionLocationSegmentRow, SessionPlayerDurationRow,
};
use vrcx_0_core::OwnerId;

use crate::Result;

#[async_trait::async_trait]
pub trait BackgroundRemoteApi: Send + Sync {
    async fn get_world(
        &self,
        endpoint: &str,
        world_id: &str,
    ) -> Result<vrcx_0_contracts::VrchatResponse>;
    async fn get_group(
        &self,
        endpoint: &str,
        group_id: &str,
    ) -> Result<vrcx_0_contracts::VrchatResponse>;
    fn prepare_current_user_update(
        &self,
        endpoint: &str,
        user_id: &str,
        patch: Value,
    ) -> Result<vrcx_0_contracts::VrchatRequest>;
    async fn send_current_user_update(
        &self,
        request: vrcx_0_contracts::VrchatRequest,
    ) -> Result<vrcx_0_contracts::VrchatResponse>;
}

#[async_trait::async_trait]
pub trait InstanceMediaPort: Send + Sync {
    async fn get_print(&self, print_id: &str) -> Result<Option<Value>>;
    async fn get_inventory_item(&self, user_id: &str, inventory_id: &str) -> Result<Option<Value>>;
    async fn get_group(&self, group_id: &str) -> Result<Option<Value>>;
    async fn save_ugc_image(
        &self,
        url: &str,
        ugc_folder_path: &str,
        category: vrcx_0_contracts::UgcCategory,
        month_folder: &str,
        file_name: &str,
    ) -> Result<String>;
    fn crop_print_file(&self, path: &str) -> Result<()>;
}

#[async_trait::async_trait]
pub trait VideoMetadataPort: Send + Sync {
    async fn youtube_metadata(&self, video_id: &str, api_key: &str) -> Result<Option<Value>>;
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct PlayerModeration {
    pub blocked: bool,
    pub muted: bool,
}

pub trait GameStateStore: Send + Sync {
    fn get_bool(&self, key: &str, default: bool) -> Result<bool>;
    fn get_string(&self, key: &str, default: &str) -> Result<String>;
    fn get_json(&self, key: &str, default: Value) -> Result<Value>;
    fn set_bool(&self, key: &str, value: bool) -> Result<()>;
    fn set_string(&self, key: &str, value: &str) -> Result<()>;
    fn set_json(&self, key: &str, value: &Value) -> Result<()>;
    fn write_game_log(
        &self,
        owner: &OwnerId,
        batch: &GameLogWriteBatch,
    ) -> Result<GameLogWriteCount>;
    fn fill_location_group_name(
        &self,
        owner: &OwnerId,
        created_at: &str,
        location: &str,
        group_name: &str,
    ) -> Result<u64>;
    fn join_leave_for_location(
        &self,
        owner: &OwnerId,
        location: &str,
        after_date: &str,
        before_date: &str,
    ) -> Result<Vec<GameLogJoinLeaveSnapshot>>;
    fn previous_instance_events(
        &self,
        owner: &OwnerId,
        user_id: &str,
        date_from: &str,
        date_to: &str,
        limit: usize,
    ) -> Result<Vec<PreviousInstanceEventRow>>;
    fn user_id_from_display_name(&self, owner: &OwnerId, display_name: &str) -> Result<String>;
    fn ensure_game_log_tables(&self) -> Result<()>;
    fn location_before_or_at(
        &self,
        owner: &OwnerId,
        created_at: &str,
    ) -> Result<Option<GameLogLocationSnapshot>>;
    fn session_location_segments(
        &self,
        owner: &OwnerId,
        before_id: Option<i64>,
        limit: i64,
    ) -> Result<Vec<SessionLocationSegmentRow>>;
    fn session_location_segments_by_date_range(
        &self,
        owner: &OwnerId,
        after_date: &str,
        before_date: &str,
        limit: i64,
    ) -> Result<Vec<SessionLocationSegmentRow>>;
    fn session_events_for_range(
        &self,
        owner: &OwnerId,
        after_date: &str,
        before_date: &str,
    ) -> Result<Vec<SessionEventRow>>;
    fn session_player_duration_rows(
        &self,
        owner: &OwnerId,
        locations: &[String],
    ) -> Result<Vec<SessionPlayerDurationRow>>;
    fn favorite_friend_group_names_for_users(
        &self,
        owner: &OwnerId,
        user_ids: &[String],
    ) -> Result<Vec<String>>;
    fn player_moderation(&self, owner: &OwnerId, user_id: &str) -> Result<PlayerModeration>;
}

#[cfg(test)]
#[derive(Clone)]
struct Owned<T> {
    owner: String,
    value: T,
}

#[cfg(test)]
#[derive(Default)]
struct TestGameState {
    config: std::collections::HashMap<String, Value>,
    tables_exist: bool,
    locations: Vec<Owned<vrcx_0_contracts::game_log::GameLogLocationEntry>>,
    join_leave: Vec<Owned<vrcx_0_contracts::game_log::GameLogJoinLeaveEntry>>,
    video_plays: Vec<Owned<vrcx_0_contracts::game_log::GameLogVideoPlayEntry>>,
    player_moderations: std::collections::HashMap<String, PlayerModeration>,
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct TestGameStateStore {
    state: std::sync::Mutex<TestGameState>,
    fail_writes: std::sync::atomic::AtomicBool,
    fail_reads: std::sync::atomic::AtomicBool,
    writes_left: std::sync::Mutex<Option<usize>>,
}

#[cfg(test)]
impl TestGameStateStore {
    pub(crate) fn locations(
        &self,
        owner: &OwnerId,
    ) -> Vec<vrcx_0_contracts::game_log::GameLogLocationEntry> {
        self.state
            .lock()
            .expect("test game state lock")
            .locations
            .iter()
            .filter(|row| owner_can_read(&row.owner, owner))
            .map(|row| row.value.clone())
            .collect()
    }

    pub(crate) fn join_leave(
        &self,
        owner: &OwnerId,
    ) -> Vec<vrcx_0_contracts::game_log::GameLogJoinLeaveEntry> {
        let mut rows = self
            .state
            .lock()
            .expect("test game state lock")
            .join_leave
            .iter()
            .enumerate()
            .filter(|(_, row)| owner_can_read(&row.owner, owner))
            .map(|(index, row)| (index, row.value.clone()))
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| {
            left.1
                .created_at
                .cmp(&right.1.created_at)
                .then_with(|| left.0.cmp(&right.0))
        });
        rows.into_iter().map(|(_, row)| row).collect()
    }

    pub(crate) fn video_plays(
        &self,
        owner: &OwnerId,
    ) -> Vec<vrcx_0_contracts::game_log::GameLogVideoPlayEntry> {
        self.state
            .lock()
            .expect("test game state lock")
            .video_plays
            .iter()
            .filter(|row| owner_can_read(&row.owner, owner))
            .map(|row| row.value.clone())
            .collect()
    }

    pub(crate) fn tables_exist(&self) -> bool {
        self.state
            .lock()
            .expect("test game state lock")
            .tables_exist
    }

    pub(crate) fn set_player_moderation(&self, user_id: &str, moderation: PlayerModeration) {
        self.state
            .lock()
            .expect("test game state lock")
            .player_moderations
            .insert(user_id.to_string(), moderation);
    }

    pub(crate) fn set_fail_reads(&self, fail: bool) {
        self.fail_reads
            .store(fail, std::sync::atomic::Ordering::Relaxed);
    }

    pub(crate) fn set_fail_writes(&self, fail: bool) {
        self.fail_writes
            .store(fail, std::sync::atomic::Ordering::Relaxed);
    }

    pub(crate) fn allow_only_writes(&self, count: usize) {
        *self.writes_left.lock().expect("test write budget lock") = Some(count);
    }
}

#[cfg(test)]
fn owner_can_read(stored_owner: &str, requested_owner: &OwnerId) -> bool {
    stored_owner.is_empty() || stored_owner == requested_owner.as_str()
}

#[cfg(test)]
fn location_snapshot(
    row: &vrcx_0_contracts::game_log::GameLogLocationEntry,
) -> GameLogLocationSnapshot {
    GameLogLocationSnapshot {
        created_at: row.created_at.clone(),
        location: row.location.clone(),
        world_id: row.world_id.clone(),
        world_name: row.world_name.clone(),
        group_name: row.group_name.clone(),
    }
}

#[cfg(test)]
impl GameStateStore for TestGameStateStore {
    fn get_bool(&self, key: &str, default: bool) -> Result<bool> {
        if self.fail_reads.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(crate::Error::Custom("temporary config read failure".into()));
        }
        Ok(self
            .state
            .lock()
            .expect("test game state lock")
            .config
            .get(key)
            .and_then(Value::as_bool)
            .unwrap_or(default))
    }

    fn get_string(&self, key: &str, default: &str) -> Result<String> {
        let state = self.state.lock().expect("test game state lock");
        Ok(match state.config.get(key) {
            Some(Value::String(value)) => value.clone(),
            Some(value) => serde_json::to_string(value)?,
            None => default.to_string(),
        })
    }

    fn get_json(&self, key: &str, default: Value) -> Result<Value> {
        Ok(self
            .state
            .lock()
            .expect("test game state lock")
            .config
            .get(key)
            .cloned()
            .unwrap_or(default))
    }

    fn set_bool(&self, key: &str, value: bool) -> Result<()> {
        self.state
            .lock()
            .expect("test game state lock")
            .config
            .insert(key.to_string(), Value::Bool(value));
        Ok(())
    }

    fn set_string(&self, key: &str, value: &str) -> Result<()> {
        self.state
            .lock()
            .expect("test game state lock")
            .config
            .insert(key.to_string(), Value::String(value.to_string()));
        Ok(())
    }

    fn set_json(&self, key: &str, value: &Value) -> Result<()> {
        self.state
            .lock()
            .expect("test game state lock")
            .config
            .insert(key.to_string(), value.clone());
        Ok(())
    }

    fn fill_location_group_name(
        &self,
        owner: &OwnerId,
        created_at: &str,
        location: &str,
        group_name: &str,
    ) -> Result<u64> {
        let mut state = self.state.lock().expect("test game state lock");
        let Some(row) = state.locations.iter_mut().find(|row| {
            owner_can_read(&row.owner, owner)
                && row.value.created_at == created_at
                && row.value.location == location
                && row.value.group_name.is_empty()
        }) else {
            return Ok(0);
        };
        row.value.group_name = group_name.to_string();
        Ok(1)
    }

    fn write_game_log(
        &self,
        owner: &OwnerId,
        batch: &GameLogWriteBatch,
    ) -> Result<GameLogWriteCount> {
        if self.fail_writes.load(std::sync::atomic::Ordering::Relaxed) {
            return Err(crate::Error::Custom("test game state write failure".into()));
        }
        if let Some(left) = self
            .writes_left
            .lock()
            .expect("test write budget lock")
            .as_mut()
        {
            if *left == 0 {
                return Err(crate::Error::Custom("test game state write failure".into()));
            }
            *left -= 1;
        }
        let mut state = self.state.lock().expect("test game state lock");
        state.tables_exist = true;
        if let Some(checkpoint) = &batch.replay_checkpoint {
            state.config.insert(
                "gameLogReplayCheckpoint".into(),
                Value::String(checkpoint.clone()),
            );
        }
        let owner = owner.as_str().to_string();
        let inserted = (batch.locations.len()
            + batch.join_leave.len()
            + batch.portal_spawns.len()
            + batch.video_plays.len()
            + batch.resource_loads.len()
            + batch.events.len()
            + batch.externals.len()) as u64;
        state
            .locations
            .extend(batch.locations.iter().cloned().map(|value| Owned {
                owner: owner.clone(),
                value,
            }));
        let mut location_times_updated = 0_u64;
        for update in &batch.location_time_updates {
            if let Some(row) = state.locations.iter_mut().rev().find(|row| {
                owner_can_read(&row.owner, &OwnerId::new(&owner))
                    && row.value.created_at == update.created_at
            }) {
                row.value.time = update.time;
                location_times_updated += 1;
            }
        }
        state
            .join_leave
            .extend(batch.join_leave.iter().cloned().map(|value| Owned {
                owner: owner.clone(),
                value,
            }));
        state
            .video_plays
            .extend(batch.video_plays.iter().cloned().map(|value| Owned {
                owner: owner.clone(),
                value,
            }));
        Ok(GameLogWriteCount {
            inserted,
            location_times_updated,
            video_names_updated: 0,
        })
    }

    fn join_leave_for_location(
        &self,
        owner: &OwnerId,
        location: &str,
        after_date: &str,
        before_date: &str,
    ) -> Result<Vec<GameLogJoinLeaveSnapshot>> {
        let state = self.state.lock().expect("test game state lock");
        let mut rows = state
            .join_leave
            .iter()
            .enumerate()
            .filter(|(_, row)| {
                owner_can_read(&row.owner, owner)
                    && row.value.location == location
                    && row.value.created_at.as_str() >= after_date
                    && row.value.created_at.as_str() <= before_date
            })
            .map(|(index, row)| GameLogJoinLeaveSnapshot {
                id: index as i64 + 1,
                created_at: row.value.created_at.clone(),
                event_type: row.value.event_type.clone(),
                display_name: row.value.display_name.clone(),
                user_id: row.value.user_id.clone(),
                time: row.value.time,
            })
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        Ok(rows)
    }

    fn previous_instance_events(
        &self,
        owner: &OwnerId,
        user_id: &str,
        date_from: &str,
        date_to: &str,
        limit: usize,
    ) -> Result<Vec<PreviousInstanceEventRow>> {
        let state = self.state.lock().expect("test game state lock");
        let mut rows = state
            .join_leave
            .iter()
            .enumerate()
            .filter(|(_, row)| {
                owner_can_read(&row.owner, owner)
                    && row.value.user_id == user_id
                    && row.value.created_at.as_str() >= date_from
                    && row.value.created_at.as_str() <= date_to
            })
            .filter_map(|(index, event)| {
                let location = state.locations.iter().rev().find(|location| {
                    owner_can_read(&location.owner, owner)
                        && location.value.location == event.value.location
                        && location.value.created_at <= event.value.created_at
                })?;
                let created_at_ts = chrono::DateTime::parse_from_rfc3339(&event.value.created_at)
                    .map(|value| value.timestamp_millis())
                    .unwrap_or_default();
                Some(PreviousInstanceEventRow {
                    created_at: event.value.created_at.clone(),
                    created_at_ts,
                    location: event.value.location.clone(),
                    time: location.value.time,
                    world_name: location.value.world_name.clone(),
                    group_name: location.value.group_name.clone(),
                    event_id: index as i64 + 1,
                    event_type: event.value.event_type.clone(),
                })
            })
            .collect::<Vec<_>>();
        rows.sort_by_key(|row| std::cmp::Reverse(row.event_id));
        rows.truncate(limit);
        Ok(rows)
    }

    fn user_id_from_display_name(&self, owner: &OwnerId, display_name: &str) -> Result<String> {
        Ok(self
            .state
            .lock()
            .expect("test game state lock")
            .join_leave
            .iter()
            .rev()
            .find(|row| {
                owner_can_read(&row.owner, owner)
                    && row.value.display_name == display_name
                    && !row.value.user_id.is_empty()
            })
            .map(|row| row.value.user_id.clone())
            .unwrap_or_default())
    }

    fn ensure_game_log_tables(&self) -> Result<()> {
        self.state
            .lock()
            .expect("test game state lock")
            .tables_exist = true;
        Ok(())
    }

    fn location_before_or_at(
        &self,
        owner: &OwnerId,
        created_at: &str,
    ) -> Result<Option<GameLogLocationSnapshot>> {
        Ok(self
            .state
            .lock()
            .expect("test game state lock")
            .locations
            .iter()
            .filter(|row| {
                owner_can_read(&row.owner, owner) && row.value.created_at.as_str() <= created_at
            })
            .max_by(|left, right| left.value.created_at.cmp(&right.value.created_at))
            .map(|row| location_snapshot(&row.value)))
    }

    fn session_location_segments(
        &self,
        owner: &OwnerId,
        before_id: Option<i64>,
        limit: i64,
    ) -> Result<Vec<SessionLocationSegmentRow>> {
        let state = self.state.lock().expect("test game state lock");
        Ok(state
            .locations
            .iter()
            .enumerate()
            .rev()
            .filter(|(index, row)| {
                let id = *index as i64 + 1;
                owner_can_read(&row.owner, owner) && before_id.is_none_or(|before| id < before)
            })
            .take(limit.max(0) as usize)
            .map(|(index, row)| SessionLocationSegmentRow {
                id: index as i64 + 1,
                created_at: row.value.created_at.clone(),
                location: row.value.location.clone(),
                world_id: row.value.world_id.clone(),
                world_name: row.value.world_name.clone(),
                time: row.value.time,
                group_name: row.value.group_name.clone(),
            })
            .collect())
    }

    fn session_location_segments_by_date_range(
        &self,
        owner: &OwnerId,
        after_date: &str,
        before_date: &str,
        limit: i64,
    ) -> Result<Vec<SessionLocationSegmentRow>> {
        let state = self.state.lock().expect("test game state lock");
        Ok(state
            .locations
            .iter()
            .enumerate()
            .rev()
            .filter(|(_, row)| {
                owner_can_read(&row.owner, owner)
                    && row.value.created_at.as_str() >= after_date
                    && row.value.created_at.as_str() <= before_date
            })
            .take(limit.max(0) as usize)
            .map(|(index, row)| SessionLocationSegmentRow {
                id: index as i64 + 1,
                created_at: row.value.created_at.clone(),
                location: row.value.location.clone(),
                world_id: row.value.world_id.clone(),
                world_name: row.value.world_name.clone(),
                time: row.value.time,
                group_name: row.value.group_name.clone(),
            })
            .collect())
    }

    fn session_events_for_range(
        &self,
        owner: &OwnerId,
        after_date: &str,
        before_date: &str,
    ) -> Result<Vec<SessionEventRow>> {
        let state = self.state.lock().expect("test game state lock");
        let mut rows = Vec::new();
        for (index, row) in state.join_leave.iter().enumerate() {
            if owner_can_read(&row.owner, owner)
                && row.value.created_at.as_str() >= after_date
                && row.value.created_at.as_str() <= before_date
            {
                rows.push(SessionEventRow {
                    row_id: index as i64 + 1,
                    event_type: row.value.event_type.clone(),
                    created_at: row.value.created_at.clone(),
                    display_name: row.value.display_name.clone(),
                    user_id: row.value.user_id.clone(),
                    location: row.value.location.clone(),
                    video_url: None,
                    video_name: None,
                    video_id: None,
                });
            }
        }
        for (index, row) in state.video_plays.iter().enumerate() {
            if owner_can_read(&row.owner, owner)
                && row.value.created_at.as_str() >= after_date
                && row.value.created_at.as_str() <= before_date
            {
                rows.push(SessionEventRow {
                    row_id: index as i64 + 1,
                    event_type: "VideoPlay".to_string(),
                    created_at: row.value.created_at.clone(),
                    display_name: row.value.display_name.clone(),
                    user_id: row.value.user_id.clone(),
                    location: row.value.location.clone(),
                    video_url: Some(row.value.video_url.clone()),
                    video_name: Some(row.value.video_name.clone()),
                    video_id: Some(row.value.video_id.clone()),
                });
            }
        }
        rows.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.row_id.cmp(&right.row_id))
        });
        Ok(rows)
    }

    fn session_player_duration_rows(
        &self,
        owner: &OwnerId,
        locations: &[String],
    ) -> Result<Vec<SessionPlayerDurationRow>> {
        let locations = locations
            .iter()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>();
        let state = self.state.lock().expect("test game state lock");
        let mut rows = state
            .join_leave
            .iter()
            .enumerate()
            .filter(|(_, row)| {
                owner_can_read(&row.owner, owner)
                    && row.value.event_type == "OnPlayerLeft"
                    && locations.contains(row.value.location.as_str())
            })
            .map(|(index, row)| {
                (
                    row.value.created_at.clone(),
                    index,
                    SessionPlayerDurationRow {
                        created_at: row.value.created_at.clone(),
                        location: row.value.location.clone(),
                        display_name: row.value.display_name.clone(),
                        user_id: row.value.user_id.clone(),
                        time: row.value.time,
                    },
                )
            })
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
        Ok(rows.into_iter().map(|(_, _, row)| row).collect())
    }

    fn favorite_friend_group_names_for_users(
        &self,
        _owner: &OwnerId,
        _user_ids: &[String],
    ) -> Result<Vec<String>> {
        Ok(Vec::new())
    }

    fn player_moderation(&self, _owner: &OwnerId, user_id: &str) -> Result<PlayerModeration> {
        Ok(self
            .state
            .lock()
            .expect("test game state lock")
            .player_moderations
            .get(user_id)
            .copied()
            .unwrap_or_default())
    }
}

#[cfg(test)]
#[derive(Default)]
pub(crate) struct TestGameMediaPort {
    pub(crate) groups: std::collections::HashMap<String, Value>,
}

#[cfg(test)]
#[async_trait::async_trait]
impl InstanceMediaPort for TestGameMediaPort {
    async fn get_print(&self, _print_id: &str) -> Result<Option<Value>> {
        Ok(None)
    }
    async fn get_inventory_item(
        &self,
        _user_id: &str,
        _inventory_id: &str,
    ) -> Result<Option<Value>> {
        Ok(None)
    }
    async fn get_group(&self, group_id: &str) -> Result<Option<Value>> {
        Ok(self.groups.get(group_id).cloned())
    }
    async fn save_ugc_image(
        &self,
        _url: &str,
        _ugc_folder_path: &str,
        _category: vrcx_0_contracts::UgcCategory,
        _month_folder: &str,
        _file_name: &str,
    ) -> Result<String> {
        Ok(String::new())
    }
    fn crop_print_file(&self, _path: &str) -> Result<()> {
        Ok(())
    }
}

#[cfg(test)]
#[async_trait::async_trait]
impl VideoMetadataPort for TestGameMediaPort {
    async fn youtube_metadata(&self, _video_id: &str, _api_key: &str) -> Result<Option<Value>> {
        Ok(None)
    }
}
