use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use vrcx_0_core::game_log_parser::VIDEO_ERROR_EVENT_PREFIX;

use chrono::{DateTime, Utc};
use vrcx_0_contracts::activity::{ActivityEvent, ActivityKind, ActivitySubject};
use vrcx_0_core::location::parse_location;

use super::content::build_activity_content;
use super::definitions::{default_rule, definition, normalize_id, KindDefinition};
use super::types::{
    ActivityActorRelation, ActivityDelivery, ActivityEntry, ActivityFavoriteGroupKeys,
    ActivityFilters, ActivityRule, ActivityScope, ActivitySnapshot, NotificationSurface,
};

const DEFAULT_CAPACITY: usize = 128;
const DEDUP_CAPACITY: usize = 4096;
const DEDUP_TTL: Duration = Duration::from_secs(120);
const DELIVERY_LIVE_GRACE: chrono::Duration = chrono::Duration::seconds(5);

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ActivityFavoriteGroups {
    groups: HashMap<String, HashSet<String>>,
    all_favorites: HashSet<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct JoinedDeliveryCoverage {
    vr: bool,
    hmd: bool,
}

impl ActivityFavoriteGroups {
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

    pub fn group_instance_notification_group_ids(&self, filters: &ActivityFilters) -> Vec<String> {
        let mut group_ids = BTreeSet::new();
        for surface in [
            NotificationSurface::Wrist,
            NotificationSurface::Desktop,
            NotificationSurface::ExternalOverlay,
            NotificationSurface::Hmd,
            NotificationSurface::Webhook,
            NotificationSurface::Tts,
            NotificationSurface::DesktopWidget,
        ] {
            let rule = filters.rule_for(surface, ActivityKind::GroupInstanceOpened);
            match rule.scope {
                ActivityScope::AllFavorites => {
                    group_ids.extend(self.all_favorites.iter().cloned());
                }
                ActivityScope::SelectedFavorites => {
                    if let ActivityFavoriteGroupKeys::Selected(keys) = rule.favorite_group_keys {
                        for key in keys {
                            if let Some(selected) = self.groups.get(&normalize_id(&key)) {
                                group_ids.extend(selected.iter().cloned());
                            }
                        }
                    }
                }
                _ => {}
            }
        }
        group_ids.into_iter().collect()
    }

    fn contains_any(&self, subject_id: &str) -> bool {
        self.all_favorites.contains(subject_id)
    }

    fn contains_selected(&self, group_keys: &[String], subject_id: &str) -> bool {
        group_keys.iter().any(|group_key| {
            self.groups
                .get(group_key)
                .is_some_and(|group| group.contains(subject_id))
        })
    }
}

#[derive(Clone)]
pub struct ActivityRouter {
    pub(super) inner: Arc<ActivityRouterInner>,
}

pub(super) struct ActivityRouterInner {
    pub(super) state: Mutex<ActivityState>,
    sink: Mutex<Option<Arc<dyn ActivitySink>>>,
    group_notification_inputs_revision: AtomicU64,
}

pub trait ActivitySink: Send + Sync {
    fn emit_overlay_activity_snapshot(&self, snapshot: ActivitySnapshot);

    fn emit_overlay_activity_delivery(&self, _delivery: ActivityDelivery) {}
}

#[derive(Clone, Debug)]
pub(super) struct ActivityState {
    pub(super) filters: ActivityFilters,
    pub(super) friend_favorite_groups: ActivityFavoriteGroups,
    pub(super) group_favorite_groups: ActivityFavoriteGroups,
    pub(super) friend_user_ids: HashSet<String>,
    feed_hidden_user_ids: HashSet<String>,
    hide_all_feed_activity: bool,
    hide_private_location_changes: bool,
    hide_video_errors: bool,
    current_instance_location: String,
    current_instance_user_ids: HashSet<String>,
    joined_delivery_coverage: HashMap<(String, String), JoinedDeliveryCoverage>,
    pub(super) entries: VecDeque<ActivityEntry>,
    pub(super) source_ids: HashSet<String>,
    pub(super) seen_order: VecDeque<(Instant, String)>,
    pub(super) next_sequence: u64,
    pub(super) capacity: usize,
    pub(super) dedup_capacity: usize,
    pub(super) live_since: Option<DateTime<Utc>>,
}

impl Default for ActivityState {
    fn default() -> Self {
        Self {
            filters: ActivityFilters::default(),
            friend_favorite_groups: ActivityFavoriteGroups::default(),
            group_favorite_groups: ActivityFavoriteGroups::default(),
            friend_user_ids: HashSet::new(),
            feed_hidden_user_ids: HashSet::new(),
            hide_all_feed_activity: false,
            hide_private_location_changes: false,
            hide_video_errors: false,
            current_instance_location: String::new(),
            current_instance_user_ids: HashSet::new(),
            joined_delivery_coverage: HashMap::new(),
            entries: VecDeque::new(),
            source_ids: HashSet::new(),
            seen_order: VecDeque::new(),
            next_sequence: 1,
            capacity: DEFAULT_CAPACITY,
            dedup_capacity: DEDUP_CAPACITY,
            live_since: None,
        }
    }
}

impl Default for ActivityRouter {
    fn default() -> Self {
        Self::new()
    }
}

impl ActivityRouter {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(ActivityRouterInner {
                state: Mutex::new(ActivityState::default()),
                sink: Mutex::new(None),
                group_notification_inputs_revision: AtomicU64::new(0),
            }),
        }
    }

    pub fn with_filters(filters: ActivityFilters) -> Self {
        let runtime = Self::new();
        runtime.set_filters(filters);
        runtime
    }

    pub fn set_filters(&self, filters: ActivityFilters) {
        let snapshot = {
            let Ok(mut state) = self.inner.state.lock() else {
                return;
            };
            if state.filters == filters {
                return;
            }
            state.filters = filters;
            state.entries.clear();
            state.source_ids.clear();
            state.seen_order.clear();
            state.joined_delivery_coverage.clear();
            snapshot_from_state(&state)
        };
        self.invalidate_group_notification_inputs();
        self.emit_snapshot(snapshot);
    }

    pub fn group_notification_inputs_revision(&self) -> u64 {
        self.inner
            .group_notification_inputs_revision
            .load(Ordering::Acquire)
    }

    pub fn invalidate_group_notification_inputs(&self) {
        self.inner
            .group_notification_inputs_revision
            .fetch_add(1, Ordering::AcqRel);
    }

    pub fn set_sink<S>(&self, sink: S)
    where
        S: ActivitySink + 'static,
    {
        if let Ok(mut current) = self.inner.sink.lock() {
            *current = Some(Arc::new(sink));
        }
    }

    pub fn set_feed_hidden_users(&self, user_ids: HashSet<String>, hide_all_activity: bool) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.feed_hidden_user_ids = user_ids;
            state.hide_all_feed_activity = hide_all_activity;
        }
    }

    pub fn set_hide_private_location_changes(&self, hide: bool) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.hide_private_location_changes = hide;
        }
    }

    pub fn set_hide_video_errors(&self, hide: bool) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.hide_video_errors = hide;
        }
    }

    pub fn set_favorite_groups(&self, favorite_groups: ActivityFavoriteGroups) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.friend_favorite_groups = favorite_groups;
        }
    }

    pub fn set_group_favorite_groups(&self, favorite_groups: ActivityFavoriteGroups) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.group_favorite_groups = favorite_groups;
        }
    }

    pub fn set_friend_user_ids<I, S>(&self, user_ids: I)
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        if let Ok(mut state) = self.inner.state.lock() {
            state.friend_user_ids = user_ids
                .into_iter()
                .map(|user_id| normalize_id(user_id.as_ref()))
                .filter(|user_id| !user_id.is_empty())
                .collect();
        }
    }

    pub fn set_current_instance_presence<I, S>(&self, location: &str, user_ids: I)
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        let location = location.trim().to_string();
        let user_ids = user_ids
            .into_iter()
            .map(|user_id| normalize_id(user_id.as_ref()))
            .filter(|user_id| !user_id.is_empty())
            .collect::<HashSet<_>>();
        if let Ok(mut state) = self.inner.state.lock() {
            if state.current_instance_location != location {
                state.joined_delivery_coverage.clear();
            }
            state
                .joined_delivery_coverage
                .retain(|(user_id, joined_location), _| {
                    joined_location == &location && user_ids.contains(user_id)
                });
            state.current_instance_location = location;
            state.current_instance_user_ids = user_ids;
        }
    }

    pub fn arm_delivery(&self) {
        if let Ok(mut state) = self.inner.state.lock() {
            state.live_since.get_or_insert_with(Utc::now);
        }
    }

    pub fn update_friend_user_ids(&self, added: Vec<String>, removed: Vec<String>) {
        if let Ok(mut state) = self.inner.state.lock() {
            for user_id in added {
                let user_id = normalize_id(&user_id);
                if !user_id.is_empty() {
                    state.friend_user_ids.insert(user_id);
                }
            }
            for user_id in removed {
                state.friend_user_ids.remove(&normalize_id(&user_id));
            }
        }
    }

    pub fn clear_runtime_state(&self) {
        let snapshot = {
            let Ok(mut state) = self.inner.state.lock() else {
                return;
            };
            state.friend_favorite_groups = ActivityFavoriteGroups::default();
            state.group_favorite_groups = ActivityFavoriteGroups::default();
            state.friend_user_ids.clear();
            state.current_instance_location.clear();
            state.current_instance_user_ids.clear();
            state.joined_delivery_coverage.clear();
            state.entries.clear();
            state.source_ids.clear();
            state.seen_order.clear();
            state.next_sequence = 1;
            state.live_since = None;
            snapshot_from_state(&state)
        };
        self.invalidate_group_notification_inputs();
        self.emit_snapshot(snapshot);
    }

    pub fn ingest_activity(&self, events: Vec<ActivityEvent>) -> Vec<ActivityEntry> {
        events
            .into_iter()
            .filter_map(|event| self.ingest(event))
            .collect()
    }

    pub fn ingest(&self, event: ActivityEvent) -> Option<ActivityEntry> {
        let (entry, snapshot, delivery) = {
            let mut state = self.inner.state.lock().ok()?;
            let definition = definition(event.kind);

            let source_id = normalize_source_id(&event);
            if state.source_ids.contains(&source_id) {
                return None;
            }
            clear_joined_delivery_coverage_for_departing_gps(&mut state, &event);
            let hidden_kind = event.kind == ActivityKind::Gps
                || (state.hide_all_feed_activity
                    && matches!(
                        event.kind,
                        ActivityKind::Online
                            | ActivityKind::Offline
                            | ActivityKind::Status
                            | ActivityKind::AvatarChange
                            | ActivityKind::Bio
                    ));
            if hidden_kind
                && state
                    .feed_hidden_user_ids
                    .contains(&normalize_id(&event.actor.user_id))
            {
                return None;
            }

            let notifies = !(state.hide_private_location_changes
                && event.kind == ActivityKind::Gps
                && parse_location(&event.facts.location).is_private)
                && !(state.hide_video_errors
                    && event.kind == ActivityKind::Event
                    && event.facts.message.starts_with(VIDEO_ERROR_EVENT_PREFIX));
            let wrist = surface_matches(&state, &event, NotificationSurface::Wrist, &definition);
            let desktop = notifies
                && surface_matches(&state, &event, NotificationSurface::Desktop, &definition);
            let mut vr = notifies
                && surface_matches(
                    &state,
                    &event,
                    NotificationSurface::ExternalOverlay,
                    &definition,
                );
            let mut hmd =
                notifies && surface_matches(&state, &event, NotificationSurface::Hmd, &definition);
            let webhook = notifies
                && surface_matches(&state, &event, NotificationSurface::Webhook, &definition);
            let tts =
                notifies && surface_matches(&state, &event, NotificationSurface::Tts, &definition);
            let widget = notifies
                && surface_matches(
                    &state,
                    &event,
                    NotificationSurface::DesktopWidget,
                    &definition,
                );
            let vr_suppressed = vr
                && suppresses_current_instance_gps(
                    &state,
                    &event,
                    NotificationSurface::ExternalOverlay,
                );
            if vr_suppressed {
                vr = false;
            }
            let hmd_suppressed =
                hmd && suppresses_current_instance_gps(&state, &event, NotificationSurface::Hmd);
            if hmd_suppressed {
                hmd = false;
            }
            if !wrist && !desktop && !vr && !hmd && !webhook && !tts && !widget {
                if vr_suppressed || hmd_suppressed {
                    remember_source_id(&mut state, source_id);
                }
                return None;
            }
            remember_source_id(&mut state, source_id.clone());

            let actor_user_id = normalize_id(&event.actor.user_id);
            let actor_relation = actor_relation_for_user_id(&state, &actor_user_id);
            let entry = ActivityEntry {
                sequence: state.next_sequence,
                source_id,
                kind: event.kind,
                category: definition.category,
                content: build_activity_content(&event),
                created_at: event.created_at,
                actor_user_id,
                actor_display_name: event.actor.display_name.trim().to_string(),
                actor_relation,
            };
            state.next_sequence = state.next_sequence.saturating_add(1);

            let snapshot = if wrist {
                state.entries.push_back(entry.clone());
                while state.entries.len() > state.capacity {
                    state.entries.pop_front();
                }
                Some(snapshot_from_state(&state))
            } else {
                None
            };

            let delivery_is_live = (desktop || vr || hmd || webhook || tts || widget)
                && is_live_event(&state, &entry.created_at);
            let delivery = if delivery_is_live {
                remember_joined_delivery(&mut state, &entry, vr, hmd);
                Some(ActivityDelivery {
                    entry: entry.clone(),
                    desktop,
                    vr,
                    hmd,
                    webhook,
                    tts,
                    widget,
                })
            } else {
                None
            };

            (entry, snapshot, delivery)
        };
        if let Some(snapshot) = snapshot {
            self.emit_snapshot(snapshot);
        }
        if let Some(delivery) = delivery {
            self.emit_delivery(delivery);
        }
        Some(entry)
    }

    pub fn deliver_test_notification(&self, message: &str) {
        let created_at = Utc::now().to_rfc3339();
        let mut event = ActivityEvent::new(
            ActivityKind::Event,
            format!("test-notification:{created_at}"),
            created_at,
        );
        event.facts.message = message.to_string();
        let sequence = {
            let Ok(mut state) = self.inner.state.lock() else {
                return;
            };
            let sequence = state.next_sequence;
            state.next_sequence = sequence.saturating_add(1);
            sequence
        };
        self.emit_delivery(ActivityDelivery {
            entry: ActivityEntry {
                sequence,
                source_id: event.source_id.clone(),
                kind: event.kind,
                category: definition(event.kind).category,
                content: build_activity_content(&event),
                created_at: event.created_at,
                actor_user_id: String::new(),
                actor_display_name: String::new(),
                actor_relation: ActivityActorRelation::None,
            },
            desktop: true,
            vr: true,
            hmd: true,
            webhook: false,
            tts: true,
            widget: true,
        });
    }

    pub fn snapshot(&self) -> ActivitySnapshot {
        let Ok(state) = self.inner.state.lock() else {
            return ActivitySnapshot::default();
        };
        snapshot_from_state(&state)
    }

    pub fn filters(&self) -> ActivityFilters {
        self.inner
            .state
            .lock()
            .map(|state| state.filters.clone())
            .unwrap_or_default()
    }

    fn emit_snapshot(&self, snapshot: ActivitySnapshot) {
        let sink = self.inner.sink.lock().ok().and_then(|sink| sink.clone());
        if let Some(sink) = sink {
            sink.emit_overlay_activity_snapshot(snapshot);
        }
    }

    fn emit_delivery(&self, delivery: ActivityDelivery) {
        let sink = self.inner.sink.lock().ok().and_then(|sink| sink.clone());
        if let Some(sink) = sink {
            sink.emit_overlay_activity_delivery(delivery);
        }
    }
}

fn surface_matches(
    state: &ActivityState,
    event: &ActivityEvent,
    surface: NotificationSurface,
    definition: &KindDefinition,
) -> bool {
    let fallback = default_rule(definition, surface);
    let rule = state
        .filters
        .surface(surface)
        .types
        .get(definition.kind.key())
        .unwrap_or(&fallback);
    event_matches_rule(state, event, rule)
}

fn suppresses_current_instance_gps(
    state: &ActivityState,
    event: &ActivityEvent,
    surface: NotificationSurface,
) -> bool {
    if event.kind != ActivityKind::Gps {
        return false;
    }
    if state.filters.rule_for(surface, ActivityKind::Gps).scope != ActivityScope::SelectedFavorites
        || !surface_filters_joined_friends(state, surface)
    {
        return false;
    }
    let Some(key) =
        current_instance_friend_key(state, &event.actor.user_id, event.facts.location.trim())
    else {
        return false;
    };
    let Some(coverage) = state.joined_delivery_coverage.get(&key) else {
        return false;
    };
    match surface {
        NotificationSurface::ExternalOverlay => coverage.vr,
        NotificationSurface::Hmd => coverage.hmd,
        _ => false,
    }
}

fn clear_joined_delivery_coverage_for_departing_gps(
    state: &mut ActivityState,
    event: &ActivityEvent,
) {
    if event.kind != ActivityKind::Gps {
        return;
    }
    let user_id = normalize_id(&event.actor.user_id);
    let location = event.facts.location.trim();
    if user_id.is_empty() || location.is_empty() || location == state.current_instance_location {
        return;
    }
    state
        .joined_delivery_coverage
        .retain(|(covered_user_id, _), _| covered_user_id != &user_id);
}

fn remember_joined_delivery(state: &mut ActivityState, entry: &ActivityEntry, vr: bool, hmd: bool) {
    if entry.kind != ActivityKind::OnPlayerJoined {
        return;
    }
    let Some(key) =
        current_instance_friend_key(state, &entry.actor_user_id, &entry.content.location)
    else {
        return;
    };
    let vr = vr && surface_filters_joined_friends(state, NotificationSurface::ExternalOverlay);
    let hmd = hmd && surface_filters_joined_friends(state, NotificationSurface::Hmd);
    if !vr && !hmd {
        return;
    }
    let coverage = state.joined_delivery_coverage.entry(key).or_default();
    coverage.vr |= vr;
    coverage.hmd |= hmd;
}

fn current_instance_friend_key(
    state: &ActivityState,
    actor_user_id: &str,
    location: &str,
) -> Option<(String, String)> {
    let user_id = normalize_id(actor_user_id);
    let location = location.trim().to_string();
    if user_id.is_empty()
        || location.is_empty()
        || location != state.current_instance_location
        || !state.friend_user_ids.contains(&user_id)
        || !state.current_instance_user_ids.contains(&user_id)
    {
        return None;
    }
    Some((user_id, location))
}

fn surface_filters_joined_friends(state: &ActivityState, surface: NotificationSurface) -> bool {
    state
        .filters
        .rule_for(surface, ActivityKind::OnPlayerJoined)
        .scope
        == ActivityScope::Friends
}

fn remember_source_id(state: &mut ActivityState, source_id: String) {
    if state.source_ids.insert(source_id.clone()) {
        let now = Instant::now();
        state.seen_order.push_back((now, source_id));
        while let Some((seen_at, _)) = state.seen_order.front() {
            let expired = now.duration_since(*seen_at) > DEDUP_TTL;
            let over_capacity = state.seen_order.len() > state.dedup_capacity;
            if !expired && !over_capacity {
                break;
            }
            if let Some((_, removed)) = state.seen_order.pop_front() {
                state.source_ids.remove(&removed);
            }
        }
    }
}

fn is_live_event(state: &ActivityState, created_at: &str) -> bool {
    let Some(live_since) = state.live_since else {
        return false;
    };
    let trimmed = created_at.trim();
    if trimmed.is_empty() {
        return true;
    }
    match DateTime::parse_from_rfc3339(trimmed) {
        Ok(timestamp) => timestamp.with_timezone(&Utc) >= live_since - DELIVERY_LIVE_GRACE,
        Err(_) => true,
    }
}

fn snapshot_from_state(state: &ActivityState) -> ActivitySnapshot {
    ActivitySnapshot {
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

fn actor_relation_for_user_id(state: &ActivityState, actor_user_id: &str) -> ActivityActorRelation {
    let actor_user_id = normalize_id(actor_user_id);
    if actor_user_id.is_empty() {
        return ActivityActorRelation::None;
    }
    if state.friend_favorite_groups.contains_any(&actor_user_id) {
        return ActivityActorRelation::Favorite;
    }
    if state.friend_user_ids.contains(&actor_user_id) {
        return ActivityActorRelation::Friend;
    }
    ActivityActorRelation::None
}

fn event_matches_rule(state: &ActivityState, event: &ActivityEvent, rule: &ActivityRule) -> bool {
    let actor_user_id = normalize_id(&event.actor.user_id);
    let favorite_membership = match &event.subject {
        ActivitySubject::None => None,
        ActivitySubject::User(user_id) => {
            Some((&state.friend_favorite_groups, normalize_id(user_id)))
        }
        ActivitySubject::Group(group_id) => {
            Some((&state.group_favorite_groups, normalize_id(group_id)))
        }
    };
    match rule.scope {
        ActivityScope::Off => false,
        ActivityScope::On => true,
        ActivityScope::Friends => state.friend_user_ids.contains(&actor_user_id),
        ActivityScope::SelectedFavorites => match &rule.favorite_group_keys {
            ActivityFavoriteGroupKeys::All => favorite_membership
                .as_ref()
                .is_some_and(|(groups, subject_id)| groups.contains_any(subject_id)),
            ActivityFavoriteGroupKeys::Selected(group_keys) => favorite_membership
                .as_ref()
                .is_some_and(|(groups, subject_id)| {
                    groups.contains_selected(group_keys, subject_id)
                }),
        },
        ActivityScope::AllFavorites => favorite_membership
            .as_ref()
            .is_some_and(|(groups, subject_id)| groups.contains_any(subject_id)),
        ActivityScope::EveryoneInInstance => event.in_current_instance,
    }
}

fn normalize_source_id(event: &ActivityEvent) -> String {
    let source_id = event.source_id.trim();
    if source_id.is_empty() {
        format!(
            "{}:{}:{}",
            event.kind.key(),
            event.actor.user_id.trim(),
            event.created_at.trim()
        )
    } else {
        source_id.to_string()
    }
}
