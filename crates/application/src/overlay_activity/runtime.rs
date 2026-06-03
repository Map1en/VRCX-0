use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex};

use serde_json::Value;

use super::content::build_activity_content;
use super::definitions::{default_rule, known_definition_for_type, normalize_id};
use super::types::{
    OverlayActivityActorRelation, OverlayActivityCandidate, OverlayActivityEntry,
    OverlayActivityFavoriteGroupKeys, OverlayActivityFilters, OverlayActivityRule,
    OverlayActivityScope, OverlayActivitySnapshot,
};

const DEFAULT_CAPACITY: usize = 128;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct OverlayFavoriteGroups {
    groups: HashMap<String, HashSet<String>>,
    all_favorites: HashSet<String>,
}

impl OverlayFavoriteGroups {
    pub fn from_map(groups: HashMap<String, Vec<String>>) -> Self {
        let mut normalized_groups = HashMap::new();
        let mut all_favorites = HashSet::new();
        for (group_key, user_ids) in groups {
            let group_key = normalize_id(&group_key);
            if group_key.is_empty() {
                continue;
            }
            let mut group = HashSet::new();
            for user_id in user_ids {
                let user_id = normalize_id(&user_id);
                if user_id.is_empty() {
                    continue;
                }
                all_favorites.insert(user_id.clone());
                group.insert(user_id);
            }
            if !group.is_empty() {
                normalized_groups.insert(group_key, group);
            }
        }
        Self {
            groups: normalized_groups,
            all_favorites,
        }
    }

    pub fn from_pairs<'a, I, U>(pairs: I) -> Self
    where
        I: IntoIterator<Item = (&'a str, &'a [U])>,
        U: AsRef<str> + 'a,
    {
        let mut groups = HashMap::new();
        let mut all_favorites = HashSet::new();
        for (group_key, user_ids) in pairs {
            let group_key = normalize_id(group_key);
            if group_key.is_empty() {
                continue;
            }
            let mut group = HashSet::new();
            for user_id in user_ids {
                let user_id = normalize_id(user_id.as_ref());
                if user_id.is_empty() {
                    continue;
                }
                all_favorites.insert(user_id.clone());
                group.insert(user_id);
            }
            if !group.is_empty() {
                groups.insert(group_key, group);
            }
        }
        Self {
            groups,
            all_favorites,
        }
    }

    fn contains_any(&self, user_id: &str) -> bool {
        self.all_favorites.contains(user_id)
    }

    fn contains_selected(&self, group_keys: &[String], user_id: &str) -> bool {
        group_keys.iter().any(|group_key| {
            self.groups
                .get(group_key)
                .is_some_and(|group| group.contains(user_id))
        })
    }
}

#[derive(Clone)]
pub struct OverlayActivityRuntime {
    pub(super) state: Arc<Mutex<OverlayActivityState>>,
    sink: Arc<Mutex<Option<Arc<dyn OverlayActivitySink>>>>,
}

pub trait OverlayActivitySink: Send + Sync {
    fn emit_overlay_activity_snapshot(&self, snapshot: OverlayActivitySnapshot);
}

#[derive(Clone, Debug)]
pub(super) struct OverlayActivityState {
    pub(super) filters: OverlayActivityFilters,
    pub(super) favorite_groups: OverlayFavoriteGroups,
    pub(super) friend_user_ids: HashSet<String>,
    pub(super) entries: VecDeque<OverlayActivityEntry>,
    pub(super) source_ids: HashSet<String>,
    pub(super) next_sequence: u64,
    pub(super) capacity: usize,
}

impl Default for OverlayActivityState {
    fn default() -> Self {
        Self {
            filters: OverlayActivityFilters::default(),
            favorite_groups: OverlayFavoriteGroups::default(),
            friend_user_ids: HashSet::new(),
            entries: VecDeque::new(),
            source_ids: HashSet::new(),
            next_sequence: 1,
            capacity: DEFAULT_CAPACITY,
        }
    }
}

impl Default for OverlayActivityRuntime {
    fn default() -> Self {
        Self::new()
    }
}

impl OverlayActivityRuntime {
    pub fn new() -> Self {
        Self {
            state: Arc::new(Mutex::new(OverlayActivityState::default())),
            sink: Arc::new(Mutex::new(None)),
        }
    }

    pub fn with_filters(filters: OverlayActivityFilters) -> Self {
        let runtime = Self::new();
        runtime.set_filters(filters);
        runtime
    }

    pub fn set_filters(&self, filters: OverlayActivityFilters) {
        let snapshot = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            if state.filters == filters {
                return;
            }
            state.filters = filters;
            state.entries.clear();
            state.source_ids.clear();
            snapshot_from_state(&state)
        };
        self.emit_snapshot(snapshot);
    }

    pub fn set_sink<S>(&self, sink: S)
    where
        S: OverlayActivitySink + 'static,
    {
        if let Ok(mut current) = self.sink.lock() {
            *current = Some(Arc::new(sink));
        }
    }

    pub fn set_favorite_groups(&self, favorite_groups: OverlayFavoriteGroups) {
        if let Ok(mut state) = self.state.lock() {
            state.favorite_groups = favorite_groups;
        }
    }

    pub fn set_friend_user_ids<I, S>(&self, user_ids: I)
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        if let Ok(mut state) = self.state.lock() {
            state.friend_user_ids = user_ids
                .into_iter()
                .map(|user_id| normalize_id(user_id.as_ref()))
                .filter(|user_id| !user_id.is_empty())
                .collect();
        }
    }

    pub fn clear_runtime_state(&self) {
        let snapshot = {
            let Ok(mut state) = self.state.lock() else {
                return;
            };
            state.favorite_groups = OverlayFavoriteGroups::default();
            state.friend_user_ids.clear();
            state.entries.clear();
            state.source_ids.clear();
            state.next_sequence = 1;
            snapshot_from_state(&state)
        };
        self.emit_snapshot(snapshot);
    }

    pub fn ingest_candidate(
        &self,
        candidate: OverlayActivityCandidate,
    ) -> Option<OverlayActivityEntry> {
        let (entry, snapshot) = {
            let mut state = self.state.lock().ok()?;
            let definition = known_definition_for_type(&candidate.activity_type)?;
            let rule = state
                .filters
                .wrist
                .types
                .get(definition.key)
                .cloned()
                .unwrap_or_else(|| default_rule(definition));
            if !candidate_matches_rule(&state, &candidate, &rule) {
                return None;
            }
            let source_id = normalize_source_id(&candidate);
            if state.source_ids.contains(&source_id) {
                return None;
            }
            let actor_display_name = candidate.actor_display_name.trim().to_string();
            let content = build_activity_content(
                definition.key,
                definition.category,
                &candidate,
                &actor_display_name,
            );
            let actor_user_id = normalize_id(&candidate.actor_user_id);
            let actor_relation = actor_relation_for_user_id(&state, &actor_user_id);
            let entry = OverlayActivityEntry {
                sequence: state.next_sequence,
                source_id: source_id.clone(),
                activity_type: definition.key.to_string(),
                category: definition.category,
                created_at: candidate.created_at,
                actor_user_id,
                actor_display_name,
                content,
                actor_relation,
                payload: candidate.payload,
            };
            state.next_sequence = state.next_sequence.saturating_add(1);
            state.source_ids.insert(source_id);
            state.entries.push_back(entry.clone());
            while state.entries.len() > state.capacity {
                if let Some(removed) = state.entries.pop_front() {
                    state.source_ids.remove(&removed.source_id);
                }
            }
            (entry, snapshot_from_state(&state))
        };
        self.emit_snapshot(snapshot);
        Some(entry)
    }

    pub fn snapshot(&self) -> OverlayActivitySnapshot {
        let Ok(state) = self.state.lock() else {
            return OverlayActivitySnapshot::default();
        };
        snapshot_from_state(&state)
    }

    pub(super) fn insert_friend_user_id(&self, user_id: String) {
        if let Ok(mut state) = self.state.lock() {
            let user_id = normalize_id(&user_id);
            if !user_id.is_empty() {
                state.friend_user_ids.insert(user_id);
            }
        }
    }

    pub(super) fn remove_friend_user_id(&self, user_id: &str) {
        if let Ok(mut state) = self.state.lock() {
            state.friend_user_ids.remove(&normalize_id(user_id));
        }
    }

    fn emit_snapshot(&self, snapshot: OverlayActivitySnapshot) {
        let sink = self.sink.lock().ok().and_then(|sink| sink.clone());
        if let Some(sink) = sink {
            sink.emit_overlay_activity_snapshot(snapshot);
        }
    }
}

fn snapshot_from_state(state: &OverlayActivityState) -> OverlayActivitySnapshot {
    OverlayActivitySnapshot {
        entries: state
            .entries
            .iter()
            .cloned()
            .map(|mut entry| {
                entry.actor_relation = actor_relation_for_user_id(state, &entry.actor_user_id);
                entry
            })
            .collect(),
    }
}

fn actor_relation_for_user_id(
    state: &OverlayActivityState,
    actor_user_id: &str,
) -> OverlayActivityActorRelation {
    let actor_user_id = normalize_id(actor_user_id);
    if actor_user_id.is_empty() {
        return OverlayActivityActorRelation::None;
    }
    if state.favorite_groups.contains_any(&actor_user_id) {
        return OverlayActivityActorRelation::Favorite;
    }
    if state.friend_user_ids.contains(&actor_user_id) {
        return OverlayActivityActorRelation::Friend;
    }
    OverlayActivityActorRelation::None
}

fn candidate_matches_rule(
    state: &OverlayActivityState,
    candidate: &OverlayActivityCandidate,
    rule: &OverlayActivityRule,
) -> bool {
    let actor_user_id = normalize_id(&candidate.actor_user_id);
    match rule.scope {
        OverlayActivityScope::Off => false,
        OverlayActivityScope::On => true,
        OverlayActivityScope::Friends => state.friend_user_ids.contains(&actor_user_id),
        OverlayActivityScope::SelectedFavorites => match &rule.favorite_group_keys {
            OverlayActivityFavoriteGroupKeys::All => {
                state.favorite_groups.contains_any(&actor_user_id)
            }
            OverlayActivityFavoriteGroupKeys::Selected(group_keys) => state
                .favorite_groups
                .contains_selected(group_keys, &actor_user_id),
        },
        OverlayActivityScope::AllFavorites => state.favorite_groups.contains_any(&actor_user_id),
        OverlayActivityScope::EveryoneInInstance => candidate.current_instance,
    }
}

fn normalize_source_id(candidate: &OverlayActivityCandidate) -> String {
    let source_id = candidate.source_id.trim();
    if source_id.is_empty() {
        format!(
            "{}:{}:{}",
            candidate.activity_type.trim(),
            candidate.actor_user_id.trim(),
            candidate.created_at.trim()
        )
    } else {
        source_id.to_string()
    }
}

pub(super) fn string_field(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .map(ToString::to_string)
        .unwrap_or_default()
}

pub(super) fn first_non_empty<const N: usize>(values: [String; N]) -> String {
    values
        .into_iter()
        .find(|value| !value.trim().is_empty())
        .unwrap_or_default()
}
