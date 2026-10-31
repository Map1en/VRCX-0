use std::borrow::Cow;
use std::collections::BTreeSet;

use chrono::{DateTime, SecondsFormat, TimeDelta};
use futures_util::future::join_all;
use futures_util::stream::{self, StreamExt};
use serde_json::Value;
use vrcx_0_contracts::feed_live::FeedLiveEntry;
use vrcx_0_contracts::profile_bio::{ProfileBioObservation, RecordedProfileBio};
use vrcx_0_core::friends::FriendRosterBaseline;
use vrcx_0_core::realtime::{RealtimeMessageParseOutcome, RealtimeMessageParser};
use vrcx_0_core::time::iso_millis;
use vrcx_0_logger_protocol::wire::{FrameKind, SnapshotPayload, WireFrame};

use crate::realtime::avatar_change::resolve_avatar_feed_entry;
use crate::realtime::event_kind::RealtimeWsEventKind;
use crate::realtime::friends::RealtimeFriendsRuntime;
use crate::realtime::{FriendIconChange, FriendWake, RealtimeFriendApplyResult};
use crate::social_baseline::service::friend_baseline_from_raw;
use crate::world_enrich::enrich_feed_entry;
use vrcx_0_application_core::{FileCache, WebClient, WorldCache};

const REMOTE_FETCH_CONCURRENCY: usize = 4;
const WORLD_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(2);
const REPLAY_GENERATION: u64 = 1;

#[derive(Debug, Default, PartialEq)]
pub struct ReplayOutcome {
    pub entries: Vec<FeedLiveEntry>,
    pub profile_bios: Vec<RecordedProfileBio>,
    pub frames_without_baseline: usize,
    icon_changes: Vec<FriendIconChange>,
}

pub struct ReplayResolvers<'a> {
    world_cache: &'a WorldCache,
    file_cache: &'a FileCache,
    web: &'a WebClient,
    endpoint: &'a str,
    retried_worlds: BTreeSet<String>,
}

impl<'a> ReplayResolvers<'a> {
    pub fn new(
        world_cache: &'a WorldCache,
        file_cache: &'a FileCache,
        web: &'a WebClient,
        endpoint: &'a str,
    ) -> Self {
        Self {
            world_cache,
            file_cache,
            web,
            endpoint,
            retried_worlds: BTreeSet::new(),
        }
    }
}

struct ReplayStep<'a> {
    order: (i64, u8, i64),
    at_ms: i64,
    received_at: Cow<'a, str>,
    frame: &'a WireFrame,
}

pub async fn replay_logger_frames(
    frames: &[WireFrame],
    account_id: &str,
    clock_offset_ms: i64,
    resolvers: &mut ReplayResolvers<'_>,
) -> ReplayOutcome {
    let mut outcome = replay_frames(frames, account_id, clock_offset_ms);
    let (world_cache, file_cache, web, endpoint) = (
        resolvers.world_cache,
        resolvers.file_cache,
        resolvers.web,
        resolvers.endpoint,
    );
    let unresolved = unresolved_worlds(world_cache, &mut outcome.entries);
    let icon_changes = std::mem::take(&mut outcome.icon_changes);
    if !endpoint.is_empty() {
        stream::iter(&unresolved)
            .for_each_concurrent(REMOTE_FETCH_CONCURRENCY, |world_id| async move {
                world_cache.resolve_name(web, endpoint, world_id).await;
            })
            .await;
        let retry: BTreeSet<String> = unresolved_worlds(world_cache, &mut outcome.entries)
            .into_iter()
            .filter(|world_id| resolvers.retried_worlds.insert(world_id.clone()))
            .collect();
        if !retry.is_empty() {
            tokio::time::sleep(WORLD_RETRY_DELAY).await;
            stream::iter(&retry)
                .for_each_concurrent(REMOTE_FETCH_CONCURRENCY, |world_id| async move {
                    let _ = world_cache.get(web, endpoint, world_id, true, false).await;
                })
                .await;
            unresolved_worlds(world_cache, &mut outcome.entries);
        }
        for changes in icon_changes.chunks(REMOTE_FETCH_CONCURRENCY) {
            let resolved = join_all(
                changes
                    .iter()
                    .map(|change| resolve_avatar_feed_entry(file_cache, web, endpoint, change)),
            )
            .await;
            outcome.entries.extend(resolved.into_iter().flatten());
        }
    }
    outcome
        .entries
        .sort_by(|left, right| left.created_at().cmp(right.created_at()));
    outcome
}

fn unresolved_worlds(world_cache: &WorldCache, entries: &mut [FeedLiveEntry]) -> BTreeSet<String> {
    entries
        .iter_mut()
        .filter_map(|entry| enrich_feed_entry(world_cache, entry, false))
        .map(|pending| pending.world_id)
        .collect()
}

fn replay_frames(frames: &[WireFrame], account_id: &str, clock_offset_ms: i64) -> ReplayOutcome {
    let mut steps: Vec<ReplayStep<'_>> = frames
        .iter()
        .filter(|frame| frame.account_id == account_id)
        .filter_map(|frame| {
            let recorded_at = DateTime::parse_from_rfc3339(&frame.received_at).ok()?;
            let (at_ms, received_at) = if clock_offset_ms == 0 {
                (
                    recorded_at.timestamp_millis(),
                    Cow::Borrowed(frame.received_at.as_str()),
                )
            } else {
                let shifted = recorded_at
                    .checked_sub_signed(TimeDelta::try_milliseconds(clock_offset_ms)?)?;
                (shifted.timestamp_millis(), Cow::Owned(shifted.to_rfc3339()))
            };
            let order = match frame.kind {
                FrameKind::Message | FrameKind::Connect | FrameKind::Profile => {
                    (frame.seq, 1, frame.seq)
                }
                FrameKind::Snapshot => (snapshot_after_seq(frame), 2, frame.seq),
            };
            Some(ReplayStep {
                order,
                at_ms,
                received_at,
                frame,
            })
        })
        .collect();
    steps.sort_by_key(|step| step.order);

    let mut replay = Replay {
        account_id,
        ..Replay::default()
    };
    for step in steps {
        if step.frame.kind == FrameKind::Connect {
            replay.start_segment();
            continue;
        }
        replay.fire_timers(step.at_ms);
        match step.frame.kind {
            FrameKind::Snapshot => replay.apply_snapshot(step.frame, step.at_ms),
            FrameKind::Message => replay.apply_message(&step.frame.payload, &step.received_at),
            FrameKind::Profile => replay.record_profile(step.frame, step.at_ms),
            FrameKind::Connect => {}
        }
    }
    replay.start_segment();
    replay.outcome
}

fn snapshot_after_seq(frame: &WireFrame) -> i64 {
    serde_json::from_str::<SnapshotPayload>(&frame.payload)
        .ok()
        .and_then(|snapshot| snapshot.after_seq)
        .unwrap_or(frame.seq)
}

#[derive(Default)]
struct Replay<'a> {
    runtime: RealtimeFriendsRuntime,
    account_id: &'a str,
    initialized: bool,
    unapplied_in_segment: usize,
    parser: RealtimeMessageParser,
    timers: Vec<FriendWake>,
    outcome: ReplayOutcome,
}

impl Replay<'_> {
    fn start_segment(&mut self) {
        if !self.initialized {
            self.outcome.frames_without_baseline += self.unapplied_in_segment;
        }
        self.unapplied_in_segment = 0;
        self.initialized = false;
        self.runtime = RealtimeFriendsRuntime::default();
        self.timers.clear();
        self.parser = RealtimeMessageParser::default();
    }

    fn apply_snapshot(&mut self, frame: &WireFrame, at_ms: i64) {
        let Ok(snapshot) = serde_json::from_str::<SnapshotPayload>(&frame.payload) else {
            return;
        };
        let Ok(Some(friends_by_id)) = friend_baseline_from_raw(
            &snapshot.current_user,
            snapshot.online_friends,
            snapshot.offline_friends,
        ) else {
            return;
        };
        self.runtime = RealtimeFriendsRuntime::default();
        self.timers.clear();
        let effects = self.runtime.set_baseline_with_effects(
            FriendRosterBaseline {
                current_user_id: self.account_id.to_string(),
                friends_by_id,
                ..FriendRosterBaseline::default()
            },
            REPLAY_GENERATION,
            REPLAY_GENERATION,
            None,
            at_ms,
        );
        self.initialized = true;
        self.timers.extend(effects.schedules);
    }

    fn apply_message(&mut self, text: &str, received_at: &str) {
        let RealtimeMessageParseOutcome::Valid(payload) =
            self.parser.parse_text(text, received_at.to_string())
        else {
            return;
        };
        let Some(kind) =
            RealtimeWsEventKind::from_payload(&payload).filter(|kind| kind.is_friend())
        else {
            return;
        };
        if !self.initialized {
            self.unapplied_in_segment += 1;
            return;
        }
        if let RealtimeFriendApplyResult::Output(output) =
            self.runtime.apply_ws_event(&kind, &payload)
        {
            self.timers.extend(output.wake);
            self.outcome.icon_changes.extend(output.icon_changes);
            self.keep(output.persistence.feed_entries);
        }
    }

    fn record_profile(&mut self, frame: &WireFrame, at_ms: i64) {
        let Some(observation) = serde_json::from_str::<Value>(&frame.payload)
            .ok()
            .and_then(|profile| ProfileBioObservation::from_profile(&profile))
        else {
            return;
        };
        let Some(observed_at) = DateTime::from_timestamp_millis(at_ms) else {
            return;
        };
        self.outcome.profile_bios.push(RecordedProfileBio {
            observation,
            observed_at: iso_millis(observed_at),
        });
    }

    fn fire_timers(&mut self, until_ms: i64) {
        loop {
            self.timers.sort_by_key(|wake| wake.at_ms);
            if self.timers.first().is_none_or(|wake| wake.at_ms > until_ms) {
                return;
            }
            let wake = self.timers.remove(0);
            let Some(at) = DateTime::from_timestamp_millis(wake.at_ms) else {
                continue;
            };
            if let Some(output) = self.runtime.wake(
                &wake.user_id,
                &at.to_rfc3339_opts(SecondsFormat::Nanos, false),
            ) {
                self.timers.extend(output.wake);
                self.keep(output.persistence.feed_entries);
            }
        }
    }

    fn keep(&mut self, entries: Vec<FeedLiveEntry>) {
        self.outcome
            .entries
            .extend(entries.into_iter().filter(|entry| {
                matches!(
                    entry,
                    FeedLiveEntry::Online { .. }
                        | FeedLiveEntry::Offline { .. }
                        | FeedLiveEntry::Gps { .. }
                        | FeedLiveEntry::Status { .. }
                )
            }));
    }
}
