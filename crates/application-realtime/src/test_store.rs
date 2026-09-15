use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::{json, Value};
use vrcx_0_application_core::{Error, Result};
use vrcx_0_contracts::feed_live::FeedLiveEntry;

use vrcx_0_contracts::feed::{
    FeedLatestQueryInput, FeedLiveEntryInput, FeedLiveQueryMatcher, FeedQueryMode,
    FeedReadModelOutput, FeedRowOutput, FeedRowsQueryInput, FeedSearchQueryInput,
};
use vrcx_0_contracts::friend_log::{
    FriendLogCurrentEntryInput, FriendLogCurrentOutput, FriendLogDeleteOptionsInput,
    FriendLogHistoryEntryInput, FriendLogHistoryOutput, FriendLogHistoryQueryInput,
    FriendLogMutationResult, FriendLogReplaceOptionsInput, FriendLogUpsertOptionsInput,
};
use vrcx_0_contracts::notifications::{NotificationListItemOutput, NotificationListQueryInput};
use vrcx_0_contracts::realtime::{
    FriendLogDelete, FriendLogUpsert, RealtimePersistenceBatch, RealtimeWriteCounts,
};
use vrcx_0_contracts::FavoriteRow;
use vrcx_0_core::json::text_of;
use vrcx_0_core::trust::trust_level_changed;
use vrcx_0_core::{FavoriteEntityKind, OwnerId};

use crate::RealtimeStore;

#[derive(Default)]
struct TestRealtimeStoreState {
    config: HashMap<String, Value>,
    current: HashMap<String, Vec<FriendLogCurrentOutput>>,
    history: HashMap<String, Vec<FriendLogHistoryOutput>>,
    feeds: HashMap<String, Vec<FeedLiveEntry>>,
    notifications_v1: HashMap<String, Vec<Value>>,
    notifications_v2: HashMap<String, Vec<Value>>,
    game_world_names: HashMap<String, String>,
    next_history_id: i64,
    fail_writes: bool,
}

pub struct TestRealtimeStore {
    database_path: PathBuf,
    state: Mutex<TestRealtimeStoreState>,
}

impl TestRealtimeStore {
    pub fn new(database_path: PathBuf) -> Self {
        Self {
            database_path,
            state: Mutex::new(TestRealtimeStoreState::default()),
        }
    }

    pub fn set_fail_writes(&self, fail: bool) {
        self.state.lock().expect("test store lock").fail_writes = fail;
    }

    pub fn friend_log_current_list(&self, user_id: &str) -> Result<Vec<FriendLogCurrentOutput>> {
        <Self as RealtimeStore>::friend_log_current_list(self, user_id)
    }

    pub fn friend_log_delete_current(
        &self,
        user_id: &str,
        target_user_ids: Vec<String>,
        options: FriendLogDeleteOptionsInput,
    ) -> Result<FriendLogMutationResult> {
        <Self as RealtimeStore>::friend_log_delete_current(self, user_id, target_user_ids, options)
    }

    pub fn feed_rows(&self, query: FeedRowsQueryInput) -> Result<Vec<FeedRowOutput>> {
        let state = self.state.lock().expect("test store lock");
        let filters = query.filters.clone();
        let matcher = FeedLiveQueryMatcher::from_parts(
            &query.user_id,
            &filters,
            &query.search,
            &query.date_from,
            &query.date_to,
            false,
            &query.vip_list,
            &query.scoped_user_ids,
            &query.excluded_user_ids,
            query.max_entries,
        );
        let mut rows = state
            .feeds
            .get(&query.user_id)
            .into_iter()
            .flatten()
            .filter(|entry| matcher.matches(entry))
            .filter(|entry| match query.mode {
                FeedQueryMode::Search | FeedQueryMode::Lookup => true,
                FeedQueryMode::Instance => !entry.location().is_empty(),
            })
            .map(FeedRowOutput::from)
            .collect::<Vec<_>>();
        rows.reverse();
        if query.max_entries > 0 {
            rows.truncate(query.max_entries as usize);
        }
        Ok(rows)
    }

    pub fn notification_list(
        &self,
        query: NotificationListQueryInput,
    ) -> Result<Vec<NotificationListItemOutput>> {
        let state = self.state.lock().expect("test store lock");
        let mut rows = state
            .notifications_v1
            .get(&query.user_id)
            .into_iter()
            .flatten()
            .map(|value| notification_from_value(value, 1))
            .chain(
                state
                    .notifications_v2
                    .get(&query.user_id)
                    .into_iter()
                    .flatten()
                    .map(|value| notification_from_value(value, 2)),
            )
            .filter(|row| query.filters.is_empty() || query.filters.contains(&row.r#type))
            .filter(|row| {
                let search = query.search.trim().to_uppercase();
                search.is_empty()
                    || [&row.sender_username, &row.message, &row.title, &row.r#type]
                        .iter()
                        .any(|value| value.to_uppercase().contains(&search))
            })
            .collect::<Vec<_>>();
        rows.sort_by(|left, right| right.created_at.cmp(&left.created_at));
        let limit = if query.limit > 0 {
            query.limit
        } else if query.per_table_limit > 0 {
            query.per_table_limit.saturating_mul(2)
        } else {
            i64::MAX
        };
        rows.truncate(limit as usize);
        Ok(rows)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, TestRealtimeStoreState>> {
        let state = self.state.lock().expect("test store lock");
        if state.fail_writes {
            return Err(Error::Custom("test store write failure".into()));
        }
        Ok(state)
    }
}

impl RealtimeStore for TestRealtimeStore {
    fn database_path(&self) -> PathBuf {
        self.database_path.clone()
    }

    fn get_bool(&self, key: &str, default: bool) -> Result<bool> {
        Ok(self
            .state
            .lock()
            .expect("test store lock")
            .config
            .get(key)
            .and_then(Value::as_bool)
            .unwrap_or(default))
    }

    fn get_string(&self, key: &str, default: &str) -> Result<String> {
        Ok(self
            .state
            .lock()
            .expect("test store lock")
            .config
            .get(key)
            .map(|value| text_of(Some(value)))
            .unwrap_or_else(|| default.to_string()))
    }

    fn get_json(&self, key: &str, default: Value) -> Result<Value> {
        Ok(self
            .state
            .lock()
            .expect("test store lock")
            .config
            .get(key)
            .cloned()
            .unwrap_or(default))
    }

    fn set_bool(&self, key: &str, value: bool) -> Result<()> {
        self.lock()?
            .config
            .insert(key.to_string(), Value::Bool(value));
        Ok(())
    }

    fn favorite_list(
        &self,
        _owner: Option<&OwnerId>,
        _kind: FavoriteEntityKind,
    ) -> Result<Vec<FavoriteRow>> {
        Ok(Vec::new())
    }

    fn friend_log_current_list(&self, user_id: &str) -> Result<Vec<FriendLogCurrentOutput>> {
        Ok(self
            .state
            .lock()
            .expect("test store lock")
            .current
            .get(user_id)
            .cloned()
            .unwrap_or_default())
    }

    fn friend_log_replace_current(
        &self,
        user_id: &str,
        entries: Vec<FriendLogCurrentEntryInput>,
        options: FriendLogReplaceOptionsInput,
    ) -> Result<FriendLogMutationResult> {
        if !is_valid_test_owner(user_id) {
            return Err(Error::Custom("invalid test owner id".into()));
        }
        let mut state = self.lock()?;
        let rows = entries
            .into_iter()
            .filter(|entry| !entry.user_id.trim().is_empty())
            .map(|entry| FriendLogCurrentOutput {
                user_id: entry.user_id.trim().to_string(),
                display_name: normalized_display_name(&entry.display_name, "Unknown"),
                trust_level: entry.trust_level.unwrap_or_else(|| "Visitor".into()),
                friend_number: value_i64(&entry.friend_number),
            })
            .collect::<Vec<_>>();
        let count = rows.len() as i64;
        state.current.insert(user_id.to_string(), rows);
        let history_count = append_input_history(
            &mut state,
            user_id,
            options
                .history_entries
                .into_iter()
                .chain(options.added_history_entries),
        );
        Ok(FriendLogMutationResult {
            user_id: user_id.to_string(),
            target_user_id: String::new(),
            count,
            inserted: None,
            history_count,
        })
    }

    fn friend_log_delete_current(
        &self,
        user_id: &str,
        target_user_ids: Vec<String>,
        options: FriendLogDeleteOptionsInput,
    ) -> Result<FriendLogMutationResult> {
        if !is_valid_test_owner(user_id) {
            return Err(Error::Custom("invalid test owner id".into()));
        }
        let mut state = self.lock()?;
        let targets = target_user_ids
            .iter()
            .map(|target| target.trim())
            .collect::<Vec<_>>();
        let rows = state.current.entry(user_id.to_string()).or_default();
        let before = rows.len();
        rows.retain(|row| !targets.contains(&row.user_id.as_str()));
        let count = (before - rows.len()) as i64;
        let history_count =
            append_input_history(&mut state, user_id, options.history_entries.into_iter());
        Ok(FriendLogMutationResult {
            user_id: user_id.to_string(),
            target_user_id: String::new(),
            count,
            inserted: None,
            history_count,
        })
    }

    fn friend_log_upsert_current(
        &self,
        user_id: &str,
        entry: FriendLogCurrentEntryInput,
        options: FriendLogUpsertOptionsInput,
    ) -> Result<FriendLogMutationResult> {
        if !is_valid_test_owner(user_id) {
            return Err(Error::Custom("invalid test owner id".into()));
        }
        let target_user_id = entry.user_id.trim().to_string();
        let mut state = self.lock()?;
        let rows = state.current.entry(user_id.to_string()).or_default();
        let existing = rows.iter_mut().find(|row| row.user_id == target_user_id);
        let inserted = existing.is_none();
        if let Some(existing) = existing {
            existing.display_name =
                normalized_display_name(&entry.display_name, &existing.display_name);
            if let Some(trust_level) = entry.trust_level.filter(|value| !value.trim().is_empty()) {
                existing.trust_level = trust_level;
            }
            let friend_number = value_i64(&entry.friend_number);
            if friend_number > 0 {
                existing.friend_number = friend_number;
            }
        } else {
            rows.push(FriendLogCurrentOutput {
                user_id: target_user_id.clone(),
                display_name: normalized_display_name(&entry.display_name, "Unknown"),
                trust_level: entry.trust_level.unwrap_or_else(|| "Visitor".into()),
                friend_number: value_i64(&entry.friend_number),
            });
        }
        let history_count =
            append_input_history(&mut state, user_id, options.history_entry.into_iter());
        Ok(FriendLogMutationResult {
            user_id: user_id.to_string(),
            target_user_id,
            count: 1,
            inserted: Some(inserted),
            history_count: history_count + i64::from(options.force_history),
        })
    }

    fn friend_log_history(
        &self,
        input: FriendLogHistoryQueryInput,
    ) -> Result<Vec<FriendLogHistoryOutput>> {
        let mut rows = self
            .state
            .lock()
            .expect("test store lock")
            .history
            .get(&input.user_id)
            .cloned()
            .unwrap_or_default();
        rows.retain(|row| {
            (input.target_user_id.is_empty() || row.user_id == input.target_user_id)
                && (input.types.is_empty() || input.types.contains(&row.r#type))
        });
        rows.sort_by_key(|row| row.row_id);
        Ok(rows)
    }

    fn friend_log_history_add(
        &self,
        user_id: &str,
        entries: Vec<FriendLogHistoryEntryInput>,
    ) -> Result<i64> {
        if !is_valid_test_owner(user_id) {
            return Err(Error::Custom("invalid test owner id".into()));
        }
        let mut state = self.lock()?;
        Ok(append_input_history(
            &mut state,
            user_id,
            entries.into_iter(),
        ))
    }

    fn notification_expire(&self, user_id: &str, notification_id: &str) -> Result<()> {
        if !is_valid_test_owner(user_id) {
            return Err(Error::Custom("invalid test owner id".into()));
        }
        let mut state = self.lock()?;
        set_notification_flag(
            state
                .notifications_v1
                .entry(user_id.to_string())
                .or_default(),
            notification_id,
            "expired",
        );
        set_notification_flag(
            state
                .notifications_v2
                .entry(user_id.to_string())
                .or_default(),
            notification_id,
            "expired",
        );
        Ok(())
    }

    fn write_realtime_batch(
        &self,
        owner: &OwnerId,
        batch: &RealtimePersistenceBatch,
    ) -> Result<RealtimeWriteCounts> {
        if owner.as_str().contains('!') {
            return Err(Error::Custom("invalid test owner id".into()));
        }
        if let Some(entry) = batch.feed_entries.iter().find(|entry| {
            matches!(
                entry,
                FeedLiveEntry::OnPlayerJoining { .. } | FeedLiveEntry::InstanceClosed { .. }
            )
        }) {
            return Err(Error::Custom(format!(
                "Unknown realtime feed entry type: {}",
                entry.entry_type()
            )));
        }
        let mut state = self.lock()?;
        let owner_id = owner.as_str().to_string();
        let mut affected = 0u64;
        for entry in &batch.friend_log_upserts {
            affected = affected.saturating_add(apply_friend_upsert(&mut state, &owner_id, entry));
        }
        for entry in &batch.friend_log_deletes {
            affected = affected.saturating_add(apply_friend_delete(&mut state, &owner_id, entry));
        }
        let feeds = state.feeds.entry(owner_id.clone()).or_default();
        for entry in &batch.feed_entries {
            let mut entry = entry.clone();
            entry.set_owner_user_id(owner_id.clone());
            feeds.push(entry);
            affected = affected.saturating_add(1);
        }
        for entry in &batch.notification_v1_upserts {
            upsert_json_row(
                state.notifications_v1.entry(owner_id.clone()).or_default(),
                entry.clone(),
            );
            affected = affected.saturating_add(1);
        }
        for entry in &batch.notification_v2_upserts {
            upsert_json_row(
                state.notifications_v2.entry(owner_id.clone()).or_default(),
                entry.clone(),
            );
            affected = affected.saturating_add(1);
        }
        for update in &batch.notification_v2_updates {
            let rows = state.notifications_v2.entry(owner_id.clone()).or_default();
            if let Some(row) = rows
                .iter_mut()
                .find(|row| value_string(row, &["id"]) == update.id)
            {
                if let (Some(row), Some(updates)) =
                    (row.as_object_mut(), update.updates.as_object())
                {
                    row.extend(updates.clone());
                }
            } else if let Some(updates) = update.updates.as_object() {
                let mut row = updates.clone();
                row.insert("id".into(), Value::String(update.id.clone()));
                row.entry("createdAt")
                    .or_insert_with(|| Value::String(update.received_at.clone()));
                row.entry("created_at")
                    .or_insert_with(|| Value::String(update.received_at.clone()));
                rows.push(Value::Object(row));
            }
        }
        for expiration in &batch.notification_expirations {
            set_notification_flag(
                state.notifications_v1.entry(owner_id.clone()).or_default(),
                &expiration.id,
                "expired",
            );
            set_notification_flag(
                state.notifications_v2.entry(owner_id.clone()).or_default(),
                &expiration.id,
                "expired",
            );
        }
        for id in &batch.notification_seen {
            set_notification_flag(
                state.notifications_v1.entry(owner_id.clone()).or_default(),
                id,
                "seen",
            );
            set_notification_flag(
                state.notifications_v2.entry(owner_id.clone()).or_default(),
                id,
                "seen",
            );
        }
        Ok(RealtimeWriteCounts {
            affected_count: affected,
            game_log_affected_count: 0,
        })
    }

    fn lookup_game_log_world_name(&self, world_id: &str) -> Result<String> {
        Ok(self
            .state
            .lock()
            .expect("test store lock")
            .game_world_names
            .get(world_id)
            .cloned()
            .unwrap_or_default())
    }

    fn feed_latest(
        &self,
        query: FeedLatestQueryInput,
        live_entries: Vec<FeedLiveEntryInput>,
        watermark: i64,
        include_persisted_rows: bool,
    ) -> Result<FeedReadModelOutput> {
        let matcher = FeedLiveQueryMatcher::for_latest(&query);
        self.feed_read_model(
            &query.user_id,
            matcher,
            live_entries,
            watermark,
            include_persisted_rows,
            query.max_rows,
        )
    }

    fn feed_search(
        &self,
        query: FeedSearchQueryInput,
        live_entries: Vec<FeedLiveEntryInput>,
        watermark: i64,
        include_persisted_rows: bool,
    ) -> Result<FeedReadModelOutput> {
        let matcher = FeedLiveQueryMatcher::for_search(&query);
        self.feed_read_model(
            &query.user_id,
            matcher,
            live_entries,
            watermark,
            include_persisted_rows,
            query.max_rows,
        )
    }
}

impl TestRealtimeStore {
    fn feed_read_model(
        &self,
        user_id: &str,
        matcher: FeedLiveQueryMatcher,
        live_entries: Vec<FeedLiveEntryInput>,
        watermark: i64,
        include_persisted_rows: bool,
        max_rows: i64,
    ) -> Result<FeedReadModelOutput> {
        let state = self.state.lock().expect("test store lock");
        let mut rows = live_entries
            .iter()
            .filter(|entry| matcher.matches(&entry.entry))
            .map(|entry| FeedRowOutput::from(&entry.entry))
            .collect::<Vec<_>>();
        if include_persisted_rows {
            rows.extend(
                state
                    .feeds
                    .get(user_id)
                    .into_iter()
                    .flatten()
                    .rev()
                    .filter(|entry| matcher.matches(entry))
                    .map(FeedRowOutput::from),
            );
        }
        let mut seen = std::collections::HashSet::new();
        rows.retain(|row| {
            seen.insert(format!(
                "{}:{}:{}:{}",
                row.r#type.as_deref().unwrap_or_default(),
                row.created_at.as_deref().unwrap_or_default(),
                row.user_id.as_deref().unwrap_or_default(),
                row.location.as_deref().unwrap_or_default(),
            ))
        });
        if max_rows > 0 {
            rows.truncate(max_rows as usize);
        }
        Ok(FeedReadModelOutput {
            rows,
            max_sequence: watermark,
            persisted_cursor: None,
            persisted_has_more: false,
        })
    }
}

fn apply_friend_upsert(
    state: &mut TestRealtimeStoreState,
    owner: &str,
    entry: &FriendLogUpsert,
) -> u64 {
    let target = entry.target_user_id.trim();
    if target.is_empty() {
        return 0;
    }
    let rows = state.current.entry(owner.to_string()).or_default();
    if let Some(existing) = rows.iter_mut().find(|row| row.user_id == target) {
        let old_name = existing.display_name.clone();
        let old_trust = existing.trust_level.clone();
        let display_name = normalized_display_name(&entry.display_name, &old_name);
        let trust_level = if entry.trust_level.trim().is_empty() {
            old_trust.clone()
        } else {
            entry.trust_level.clone()
        };
        existing.display_name = display_name.clone();
        existing.trust_level = trust_level.clone();
        if entry.friend_number > 0 {
            existing.friend_number = entry.friend_number;
        }
        let friend_number = existing.friend_number;
        let mut count = 1;
        if old_name != "Unknown" && display_name != "Unknown" && old_name != display_name {
            push_history(
                state,
                owner,
                &entry.created_at,
                "DisplayName",
                target,
                &display_name,
                &old_name,
                &trust_level,
                "",
                friend_number,
            );
            count += 1;
        }
        if trust_level_changed(&old_trust, &trust_level) {
            push_history(
                state,
                owner,
                &entry.created_at,
                "TrustLevel",
                target,
                &display_name,
                "",
                &trust_level,
                &old_trust,
                friend_number,
            );
            count += 1;
        }
        if entry.force_history {
            push_history(
                state,
                owner,
                &entry.created_at,
                "Friend",
                target,
                &display_name,
                "",
                &trust_level,
                "",
                friend_number,
            );
            count += 1;
        }
        count
    } else {
        let friend_number = if entry.friend_number > 0 {
            entry.friend_number
        } else {
            rows.iter().map(|row| row.friend_number).max().unwrap_or(0) + 1
        };
        let display_name = normalized_display_name(&entry.display_name, "Unknown");
        let trust_level = if entry.trust_level.trim().is_empty() {
            "Visitor".to_string()
        } else {
            entry.trust_level.clone()
        };
        rows.push(FriendLogCurrentOutput {
            user_id: target.to_string(),
            display_name: display_name.clone(),
            trust_level: trust_level.clone(),
            friend_number,
        });
        push_history(
            state,
            owner,
            &entry.created_at,
            "Friend",
            target,
            &display_name,
            "",
            &trust_level,
            "",
            friend_number,
        );
        2
    }
}

fn apply_friend_delete(
    state: &mut TestRealtimeStoreState,
    owner: &str,
    entry: &FriendLogDelete,
) -> u64 {
    let rows = state.current.entry(owner.to_string()).or_default();
    let Some(index) = rows
        .iter()
        .position(|row| row.user_id == entry.target_user_id.trim())
    else {
        return 0;
    };
    let existing = rows.remove(index);
    push_history(
        state,
        owner,
        &entry.created_at,
        "Unfriend",
        &existing.user_id,
        &existing.display_name,
        "",
        &existing.trust_level,
        "",
        existing.friend_number,
    );
    2
}

fn append_input_history(
    state: &mut TestRealtimeStoreState,
    owner: &str,
    entries: impl Iterator<Item = FriendLogHistoryEntryInput>,
) -> i64 {
    let mut count = 0;
    for entry in entries {
        push_history(
            state,
            owner,
            &entry.created_at,
            &entry.r#type,
            &entry.user_id,
            &entry.display_name,
            &entry.previous_display_name,
            &entry.trust_level,
            &entry.previous_trust_level,
            value_i64(&entry.friend_number),
        );
        count += 1;
    }
    count
}

#[allow(clippy::too_many_arguments)]
fn push_history(
    state: &mut TestRealtimeStoreState,
    owner: &str,
    created_at: &str,
    entry_type: &str,
    user_id: &str,
    display_name: &str,
    previous_display_name: &str,
    trust_level: &str,
    previous_trust_level: &str,
    friend_number: i64,
) {
    state.next_history_id += 1;
    let row_id = state.next_history_id;
    state
        .history
        .entry(owner.to_string())
        .or_default()
        .push(FriendLogHistoryOutput {
            row_id,
            created_at: created_at.to_string(),
            r#type: entry_type.to_string(),
            user_id: user_id.to_string(),
            display_name: display_name.to_string(),
            previous_display_name: previous_display_name.to_string(),
            trust_level: trust_level.to_string(),
            previous_trust_level: previous_trust_level.to_string(),
            friend_number,
        });
}

fn upsert_json_row(rows: &mut Vec<Value>, row: Value) {
    let id = value_string(&row, &["id"]);
    if let Some(existing) = rows
        .iter_mut()
        .find(|existing| value_string(existing, &["id"]) == id)
    {
        *existing = row;
    } else {
        rows.push(row);
    }
}

fn set_notification_flag(rows: &mut [Value], id: &str, key: &str) {
    if let Some(row) = rows.iter_mut().find(|row| value_string(row, &["id"]) == id) {
        row[key] = Value::Bool(true);
    }
}

fn normalized_display_name(value: &str, fallback: &str) -> String {
    let value = value.trim();
    if value.is_empty() || value == "Unknown" {
        fallback.to_string()
    } else {
        value.to_string()
    }
}

fn is_valid_test_owner(user_id: &str) -> bool {
    !user_id.is_empty()
        && user_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
}

fn value_i64(value: &Value) -> i64 {
    value
        .as_i64()
        .or_else(|| value.as_str().and_then(|value| value.parse().ok()))
        .unwrap_or(0)
}

fn value_string(value: &Value, keys: &[&str]) -> String {
    let Some(object) = value.as_object() else {
        return String::new();
    };
    keys.iter()
        .find_map(|key| object.get(*key).filter(|value| !value.is_null()))
        .map(|value| text_of(Some(value)))
        .unwrap_or_default()
}

fn value_bool(value: &Value, keys: &[&str]) -> bool {
    let text = value_string(value, keys);
    matches!(text.as_str(), "true" | "1")
}

fn notification_from_value(value: &Value, version: i64) -> NotificationListItemOutput {
    let created_at = value_string(value, &["createdAt", "created_at"]);
    NotificationListItemOutput {
        id: value_string(value, &["id"]),
        version,
        created_at: created_at.clone(),
        created_at_legacy: created_at,
        updated_at: value_string(value, &["updatedAt", "updated_at"]),
        expires_at: value_string(value, &["expiresAt", "expires_at"]),
        r#type: value_string(value, &["type"]),
        link: value_string(value, &["link"]),
        link_text: value_string(value, &["linkText", "link_text"]),
        message: value_string(value, &["message"]),
        title: value_string(value, &["title"]),
        image_url: value_string(value, &["imageUrl", "image_url"]),
        seen: value_bool(value, &["seen"]),
        sender_user_id: value_string(value, &["senderUserId", "sender_user_id"]),
        sender_username: value_string(value, &["senderUsername", "sender_username"]),
        receiver_user_id: value_string(value, &["receiverUserId", "receiver_user_id"]),
        data: value.get("data").cloned().unwrap_or_else(|| json!({})),
        responses: value.get("responses").cloned().unwrap_or_else(|| json!({})),
        details: value.get("details").cloned().unwrap_or_else(|| json!({})),
        location: value_string(value, &["location"]),
        expired: value_bool(value, &["expired"]),
    }
}
