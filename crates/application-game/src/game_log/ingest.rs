use vrcx_0_contracts::game_log::{
    GameLogEventEntry, GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogLocationEntry,
    GameLogLocationTimeUpdate, GameLogPortalSpawnEntry, GameLogResourceLoadEntry,
    GameLogWriteBatch,
};
use vrcx_0_core::game_log_parser::{GameLogEvent, GameLogEventKind};
use vrcx_0_core::game_process::GameProcessEvent;
use vrcx_0_core::location::parse_location;

use super::now_playing_log::{parse_now_playing_log, NowPlayingLogKind};
use super::runtime_state::{
    duration_ms, parse_event_time_ms, player_key, world_id_from_location, GameLogProjection,
    GameLogRuntimeState, PlayerState, RuntimeSnapshot,
};
use super::video::{self, VideoInput};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GameLogIngestOptions {
    pub log_resource_load: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameLogProcessEvent {
    pub process: GameProcessEvent,
    pub changed_at: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScreenshotInput {
    pub created_at: String,
    pub path: String,
    pub snapshot: RuntimeSnapshot,
}

#[derive(Clone, Debug, PartialEq)]
pub enum GameLogSideEffect {
    Video(VideoInput),
    NowPlayingReset,
    VideoDetails {
        created_at: String,
        video_url: String,
        video_name: String,
        thumbnail_url: String,
    },
    NowPlayingTransport {
        created_at: String,
        position: i64,
        paused: bool,
    },
    Screenshot(ScreenshotInput),
    ApiRequest {
        url: String,
    },
    Sticker {
        user_id: String,
        display_name: String,
        inventory_id: String,
    },
    VrcQuit {
        created_at: String,
        is_game_running: bool,
    },
    NoVr {
        no_vr: bool,
    },
    UdonException {
        data: String,
    },
    LocationGroupName {
        created_at: String,
        location: String,
        group_id: String,
    },
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GameLogAvatarChange {
    pub created_at: String,
    pub user_id: String,
    pub display_name: String,
    pub avatar_name: String,
    pub location: String,
    pub world_name: String,
}

#[derive(Debug, Default, PartialEq)]
pub struct GameLogIngestOutput {
    pub batch: GameLogWriteBatch,
    pub input_count: usize,
    pub runtime_persisted_mirrors: Vec<Vec<String>>,
    pub destination_started_at: Vec<String>,
    pub instance_roster_changed: bool,
    pub departed_user_ids: Vec<String>,
    pub replayed_departed_user_ids: Vec<String>,
    pub avatar_changes: Vec<GameLogAvatarChange>,
    pub projection: Option<GameLogProjection>,
    pub side_effects: Vec<GameLogSideEffect>,
}

impl GameLogIngestOutput {
    pub(super) fn append(&mut self, mut next: Self) {
        self.batch.locations.append(&mut next.batch.locations);
        self.batch
            .location_time_updates
            .append(&mut next.batch.location_time_updates);
        self.batch.join_leave.append(&mut next.batch.join_leave);
        self.batch
            .portal_spawns
            .append(&mut next.batch.portal_spawns);
        self.batch.video_plays.append(&mut next.batch.video_plays);
        self.batch
            .resource_loads
            .append(&mut next.batch.resource_loads);
        self.batch.events.append(&mut next.batch.events);
        self.batch.externals.append(&mut next.batch.externals);
        self.input_count += next.input_count;
        self.runtime_persisted_mirrors
            .append(&mut next.runtime_persisted_mirrors);
        self.destination_started_at
            .append(&mut next.destination_started_at);
        self.instance_roster_changed |= next.instance_roster_changed;
        self.departed_user_ids.append(&mut next.departed_user_ids);
        self.replayed_departed_user_ids
            .append(&mut next.replayed_departed_user_ids);
        self.avatar_changes.append(&mut next.avatar_changes);
        self.side_effects.append(&mut next.side_effects);
    }
}

#[derive(Clone, Debug, Default)]
pub struct GameLogIngestEngine {
    state: GameLogRuntimeState,
    has_seen_process_event: bool,
    last_video_created_at: String,
    now_playing_log: NowPlayingLogFollow,
}

#[derive(Clone, Debug, Default)]
struct NowPlayingLogFollow {
    location: String,
    producer_id: String,
    video: Option<(String, String)>,
    paused: bool,
}

impl GameLogIngestEngine {
    pub(super) fn restore_state(&mut self, state: GameLogRuntimeState) {
        self.state = state;
    }

    pub(super) fn checkpoint_state(&self) -> GameLogRuntimeState {
        self.state.clone()
    }
    pub(super) fn start_log_file(&mut self) {
        self.state = GameLogRuntimeState {
            is_game_running: self.state.is_game_running,
            is_steamvr_running: self.state.is_steamvr_running,
            ..Default::default()
        };
    }

    pub fn runtime_snapshot(&self) -> RuntimeSnapshot {
        self.state.snapshot()
    }
    pub fn ingest_events(
        &mut self,
        events: &[GameLogEvent],
        options: GameLogIngestOptions,
    ) -> GameLogIngestOutput {
        if events.is_empty() {
            return GameLogIngestOutput::default();
        }

        let mut output = GameLogIngestOutput {
            input_count: events.len(),
            ..Default::default()
        };

        for event in events {
            let write_count_before = batch_write_count(&output.batch);
            match &event.kind {
                GameLogEventKind::Location {
                    location,
                    world_name,
                } => {
                    self.ingest_location(&mut output.batch, event, location, world_name);
                    if let Some(group_id) = parse_location(location)
                        .group_id
                        .filter(|id| !id.is_empty())
                    {
                        output
                            .side_effects
                            .push(GameLogSideEffect::LocationGroupName {
                                created_at: event.created_at.clone(),
                                location: location.to_string(),
                                group_id,
                            });
                    }
                    output.instance_roster_changed |= !location.is_empty();
                }
                GameLogEventKind::LocationDestination { .. } => {
                    self.finalize_location_session(&mut output.batch, &event.created_at);
                    self.state.last_video_url.clear();
                    self.state.now_playing_url.clear();
                    output.side_effects.push(GameLogSideEffect::NowPlayingReset);
                    self.state.current_location = "traveling".into();
                    self.state.current_world_name.clear();
                    if let GameLogEventKind::LocationDestination { location } = &event.kind {
                        self.state.current_destination = location.clone();
                    }
                    self.state.current_location_started_at = event.created_at.clone();
                    self.state.current_location_started_at_ms =
                        parse_event_time_ms(&event.created_at);
                    output.destination_started_at.push(event.created_at.clone());
                    output.instance_roster_changed = true;
                }
                GameLogEventKind::PlayerJoined {
                    display_name,
                    user_id,
                } => {
                    self.state.has_player_events = true;
                    self.ingest_player_joined(&mut output.batch, event, display_name, user_id);
                    output.instance_roster_changed = true;
                }
                GameLogEventKind::PlayerLeft {
                    display_name,
                    user_id,
                } => {
                    self.state.has_player_events = true;
                    if let Some(user_id) =
                        self.ingest_player_left(&mut output.batch, event, display_name, user_id)
                    {
                        output.departed_user_ids.push(user_id);
                    }
                    output.instance_roster_changed = true;
                }
                GameLogEventKind::PortalSpawn => self.ingest_portal_spawn(&mut output.batch, event),
                GameLogEventKind::AvatarChange {
                    display_name,
                    avatar_name,
                } => self.ingest_avatar_change(&mut output, event, display_name, avatar_name),
                GameLogEventKind::Notification { .. } => {}
                GameLogEventKind::ResourceLoad {
                    resource_type,
                    resource_url,
                } => self.ingest_resource_load(
                    &mut output.batch,
                    event,
                    resource_type,
                    resource_url,
                    options.log_resource_load,
                ),
                GameLogEventKind::VideoPlay {
                    video_url,
                    display_name,
                } => {
                    if let Some(input) = self.prepare_video_play(event, video_url, display_name) {
                        self.push_video(&mut output, input);
                    }
                }
                GameLogEventKind::NowPlaying { data } => {
                    self.ingest_now_playing_log(&mut output, event, data);
                }
                GameLogEventKind::VideoSync { timestamp } => {
                    output
                        .side_effects
                        .push(GameLogSideEffect::NowPlayingTransport {
                            created_at: event.created_at.clone(),
                            position: timestamp
                                .replace(',', "")
                                .parse::<i64>()
                                .ok()
                                .filter(|value| *value >= 0)
                                .unwrap_or(0),
                            paused: false,
                        });
                }
                GameLogEventKind::Vrcx { data } => {
                    match video::parse_provider_video(
                        &event.created_at,
                        &self.state.current_location,
                        data,
                    ) {
                        video::ProviderVideoEvent::Video(input) => {
                            if !self.now_playing_log_active()
                                && self.accept_video_url(&input.video_url)
                            {
                                self.push_video(&mut output, *input);
                            }
                        }
                        video::ProviderVideoEvent::ResetNowPlaying => {
                            self.state.last_video_url.clear();
                            self.state.now_playing_url.clear();
                            output.side_effects.push(GameLogSideEffect::NowPlayingReset);
                        }
                        video::ProviderVideoEvent::Ignored => {}
                        video::ProviderVideoEvent::NotProvider => {
                            output.batch.externals.push(GameLogExternalEntry {
                                created_at: event.created_at.clone(),
                                message: data.clone(),
                                display_name: String::new(),
                                user_id: String::new(),
                                location: self.state.current_location.clone(),
                            });
                        }
                    }
                }
                GameLogEventKind::ApiRequest { url } => {
                    output
                        .side_effects
                        .push(GameLogSideEffect::ApiRequest { url: url.clone() });
                }
                GameLogEventKind::Screenshot { path } => {
                    output
                        .side_effects
                        .push(GameLogSideEffect::Screenshot(ScreenshotInput {
                            created_at: event.created_at.clone(),
                            path: path.clone(),
                            snapshot: self.state.snapshot(),
                        }));
                }
                GameLogEventKind::StickerSpawn {
                    user_id,
                    display_name,
                    inventory_id,
                } => output.side_effects.push(GameLogSideEffect::Sticker {
                    user_id: user_id.clone(),
                    display_name: display_name.clone(),
                    inventory_id: inventory_id.clone(),
                }),
                GameLogEventKind::VrcQuit => output.side_effects.push(GameLogSideEffect::VrcQuit {
                    created_at: event.created_at.clone(),
                    is_game_running: self.state.is_game_running,
                }),
                GameLogEventKind::OpenVrInit => output
                    .side_effects
                    .push(GameLogSideEffect::NoVr { no_vr: false }),
                GameLogEventKind::DesktopMode => output
                    .side_effects
                    .push(GameLogSideEffect::NoVr { no_vr: true }),
                GameLogEventKind::UdonException { data } => output
                    .side_effects
                    .push(GameLogSideEffect::UdonException { data: data.clone() }),
                GameLogEventKind::Event { data } => output.batch.events.push(GameLogEventEntry {
                    created_at: event.created_at.clone(),
                    data: data.clone(),
                }),
                GameLogEventKind::External { data } => {
                    output.batch.externals.push(GameLogExternalEntry {
                        created_at: event.created_at.clone(),
                        message: data.clone(),
                        display_name: String::new(),
                        user_id: String::new(),
                        location: self.state.current_location.clone(),
                    });
                }
            }
            if batch_write_count(&output.batch) > write_count_before {
                output.runtime_persisted_mirrors.push(event.to_compat_row());
            }
        }

        if let Some(event) = events.last() {
            output.projection = Some(
                self.state
                    .projection(&event.created_at, event.compat_type()),
            );
        }

        output
    }

    pub fn handle_process_event(&mut self, event: GameLogProcessEvent) -> GameLogIngestOutput {
        let mut output = GameLogIngestOutput::default();
        let first_process_event = !self.has_seen_process_event;
        let should_restore_seeded_state = first_process_event && event.process.is_game_running;
        self.has_seen_process_event = true;
        self.state.is_game_running = event.process.is_game_running;
        self.state.is_steamvr_running = event.process.is_steamvr_running;
        if should_restore_seeded_state {
            output.instance_roster_changed = true;
            output.projection = Some(self.state.projection(&event.changed_at, "game-started"));
        } else if event.process.game_changed && !event.process.is_game_running {
            self.finalize_location_session(&mut output.batch, &event.changed_at);
            self.state.current_location.clear();
            self.state.current_world_name.clear();
            self.state.current_destination.clear();
            self.state.current_location_started_at.clear();
            self.state.current_location_started_at_ms = None;
            self.state.last_resource_url.clear();
            self.state.last_video_url.clear();
            self.state.now_playing_url.clear();
            output.side_effects.push(GameLogSideEffect::NowPlayingReset);
            output.instance_roster_changed = true;
            output.projection = Some(self.state.projection(&event.changed_at, "game-stopped"));
        } else if first_process_event && !event.process.is_game_running {
            self.reset_now_playing(&mut output);
        }
        output
    }

    fn push_video(&mut self, output: &mut GameLogIngestOutput, input: VideoInput) {
        self.last_video_created_at = input.created_at.clone();
        output.side_effects.push(GameLogSideEffect::Video(input));
        if self.has_seen_process_event && !self.state.is_game_running {
            self.reset_now_playing(output);
        }
    }

    fn reset_now_playing(&mut self, output: &mut GameLogIngestOutput) {
        self.state.last_video_url.clear();
        self.state.now_playing_url.clear();
        output.side_effects.push(GameLogSideEffect::NowPlayingReset);
    }

    fn ingest_location(
        &mut self,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
        location: &str,
        world_name: &str,
    ) {
        if location.is_empty() {
            return;
        }

        batch.locations.push(GameLogLocationEntry {
            created_at: event.created_at.clone(),
            location: location.to_string(),
            world_id: world_id_from_location(location),
            world_name: world_name.to_string(),
            time: 0,
            group_name: String::new(),
        });

        self.state.current_location = location.to_string();
        self.state.current_world_name = world_name.to_string();
        self.state.current_destination.clear();
        self.state.current_location_started_at = event.created_at.clone();
        self.state.current_location_started_at_ms = parse_event_time_ms(&event.created_at);
        self.state.players_by_key.clear();
        self.state.player_avatar_names.clear();
        self.state.has_player_events = false;
        self.state.last_resource_url.clear();
        self.state.last_video_url.clear();
    }

    fn ingest_player_joined(
        &mut self,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
        display_name: &str,
        user_id: &str,
    ) {
        let join_time_ms = parse_event_time_ms(&event.created_at);
        self.state.players_by_key.insert(
            player_key(user_id, display_name),
            PlayerState {
                user_id: user_id.to_string(),
                display_name: display_name.to_string(),
                join_time_ms,
            },
        );

        batch.join_leave.push(GameLogJoinLeaveEntry {
            created_at: event.created_at.clone(),
            event_type: "OnPlayerJoined".into(),
            display_name: display_name.to_string(),
            location: self.state.current_location.clone(),
            user_id: user_id.to_string(),
            world_name: self.state.current_world_name.clone(),
            time: 0,
        });
    }

    fn ingest_player_left(
        &mut self,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
        display_name: &str,
        user_id: &str,
    ) -> Option<String> {
        let left_time_ms = parse_event_time_ms(&event.created_at);
        let player = remove_player_for_leave(&mut self.state, display_name, user_id);
        let duration = duration_ms(player.as_ref().and_then(|p| p.join_time_ms), left_time_ms);

        batch.join_leave.push(GameLogJoinLeaveEntry {
            created_at: event.created_at.clone(),
            event_type: "OnPlayerLeft".into(),
            display_name: display_name.to_string(),
            location: self.state.current_location.clone(),
            user_id: user_id.to_string(),
            world_name: self.state.current_world_name.clone(),
            time: duration,
        });
        if !parse_location(&self.state.current_location).is_real_instance {
            return None;
        }
        player
            .map(|player| player.user_id)
            .filter(|id| !id.is_empty())
            .or_else(|| (!user_id.trim().is_empty()).then(|| user_id.trim().to_string()))
    }

    fn ingest_avatar_change(
        &mut self,
        output: &mut GameLogIngestOutput,
        event: &GameLogEvent,
        display_name: &str,
        avatar_name: &str,
    ) {
        let display_name = display_name.trim();
        let avatar_name = avatar_name.trim();
        if display_name.is_empty() || avatar_name.is_empty() {
            return;
        }
        let previous = self
            .state
            .player_avatar_names
            .insert(display_name.to_string(), avatar_name.to_string());
        if previous.is_none_or(|previous| previous == avatar_name) {
            return;
        }
        let user_id = self
            .state
            .players_by_key
            .values()
            .find(|player| player.display_name == display_name)
            .map(|player| player.user_id.clone())
            .unwrap_or_default();
        output.avatar_changes.push(GameLogAvatarChange {
            created_at: event.created_at.clone(),
            user_id,
            display_name: display_name.to_string(),
            avatar_name: avatar_name.to_string(),
            location: self.state.current_location.clone(),
            world_name: self.state.current_world_name.clone(),
        });
    }

    fn ingest_portal_spawn(&self, batch: &mut GameLogWriteBatch, event: &GameLogEvent) {
        batch.portal_spawns.push(GameLogPortalSpawnEntry {
            created_at: event.created_at.clone(),
            display_name: String::new(),
            location: self.state.current_location.clone(),
            user_id: String::new(),
            instance_id: String::new(),
            world_name: String::new(),
        });
    }

    fn ingest_resource_load(
        &mut self,
        batch: &mut GameLogWriteBatch,
        event: &GameLogEvent,
        resource_type: &str,
        resource_url: &str,
        log_resource_load: bool,
    ) {
        if resource_url.is_empty()
            || self.state.last_resource_url == resource_url
            || !log_resource_load
        {
            return;
        }

        self.state.last_resource_url = resource_url.to_string();
        batch.resource_loads.push(GameLogResourceLoadEntry {
            created_at: event.created_at.clone(),
            resource_url: resource_url.to_string(),
            resource_type: resource_type.to_string(),
            location: self.state.current_location.clone(),
        });
    }

    fn finalize_location_session(&mut self, batch: &mut GameLogWriteBatch, stopped_at: &str) {
        let stopped_at_ms = parse_event_time_ms(stopped_at);
        self.state.player_avatar_names.clear();
        if self.state.current_location.is_empty() || stopped_at_ms.is_none() {
            self.state.players_by_key.clear();
            return;
        }

        for player in self.state.players_by_key.values() {
            batch.join_leave.push(GameLogJoinLeaveEntry {
                created_at: stopped_at.to_string(),
                event_type: "OnPlayerLeft".into(),
                display_name: player.display_name.clone(),
                location: self.state.current_location.clone(),
                user_id: player.user_id.clone(),
                world_name: self.state.current_world_name.clone(),
                time: duration_ms(player.join_time_ms, stopped_at_ms),
            });
        }
        self.state.players_by_key.clear();

        let location_duration =
            duration_ms(self.state.current_location_started_at_ms, stopped_at_ms);
        if !self.state.current_location_started_at.is_empty() {
            batch.location_time_updates.push(GameLogLocationTimeUpdate {
                created_at: self.state.current_location_started_at.clone(),
                time: location_duration,
            });
        }
    }

    fn prepare_video_play(
        &mut self,
        event: &GameLogEvent,
        video_url: &str,
        display_name: &str,
    ) -> Option<VideoInput> {
        if video::uses_provider_video_events(&self.state.current_location)
            || self.now_playing_log_active()
        {
            return None;
        }

        let video_url = decode_video_url(video_url);
        if !self.accept_video_url(&video_url) {
            return None;
        }

        Some(VideoInput {
            created_at: event.created_at.clone(),
            location: self.state.current_location.clone(),
            world_name: self.state.current_world_name.clone(),
            video_url,
            display_name: display_name.to_string(),
            ..Default::default()
        })
    }

    fn now_playing_log_active(&self) -> bool {
        !self.state.current_location.is_empty()
            && self.now_playing_log.location == self.state.current_location
    }

    fn ingest_now_playing_log(
        &mut self,
        output: &mut GameLogIngestOutput,
        event: &GameLogEvent,
        data: &str,
    ) {
        let Some(log) = parse_now_playing_log(data) else {
            return;
        };
        if !self.now_playing_log_active() {
            self.now_playing_log = NowPlayingLogFollow {
                location: self.state.current_location.clone(),
                ..NowPlayingLogFollow::default()
            };
        }
        if let NowPlayingLogKind::Change {
            url,
            name,
            image,
            owner,
            length,
        } = log.kind
        {
            let url = decode_video_url(&url);
            if url.is_empty() {
                return;
            }
            self.now_playing_log.producer_id = log.producer_id;
            self.now_playing_log.paused = false;
            if url == self.state.last_video_url && !self.last_video_created_at.is_empty() {
                let created_at = self.last_video_created_at.clone();
                self.now_playing_log.video = Some((created_at.clone(), url.clone()));
                if let Some(input) = pending_video(output, &created_at, &url) {
                    if length > 0 {
                        input.video_length = length;
                    }
                    if !owner.is_empty() {
                        input.display_name = owner;
                    }
                }
                push_video_details(output, created_at, url, name, image);
                return;
            }
            self.accept_video_url(&url);
            self.now_playing_log.video = Some((event.created_at.clone(), url.clone()));
            let video_id = if video::parse_youtube_video_id(&url).is_empty() {
                String::new()
            } else {
                "YouTube".to_string()
            };
            self.push_video(
                output,
                VideoInput {
                    created_at: event.created_at.clone(),
                    location: self.state.current_location.clone(),
                    world_name: self.state.current_world_name.clone(),
                    video_url: url,
                    video_id,
                    video_name: name,
                    video_length: length,
                    display_name: owner,
                    thumbnail_url: image,
                    ..Default::default()
                },
            );
            return;
        }
        if log.producer_id != self.now_playing_log.producer_id {
            return;
        }
        let Some((created_at, video_url)) = self.now_playing_log.video.clone() else {
            return;
        };
        let transport = |position: i64, paused: bool| GameLogSideEffect::NowPlayingTransport {
            created_at: event.created_at.clone(),
            position,
            paused,
        };
        match log.kind {
            NowPlayingLogKind::Info { name, image } => {
                push_video_details(output, created_at, video_url, name, image);
            }
            NowPlayingLogKind::Play { position } => {
                self.now_playing_log.paused = false;
                output.side_effects.push(transport(position, false));
            }
            NowPlayingLogKind::Pause { position } => {
                self.now_playing_log.paused = true;
                output.side_effects.push(transport(position, true));
            }
            NowPlayingLogKind::Seek { position } => {
                output
                    .side_effects
                    .push(transport(position, self.now_playing_log.paused));
            }
            NowPlayingLogKind::Stop => {
                self.now_playing_log.producer_id.clear();
                self.now_playing_log.video = None;
                self.reset_now_playing(output);
            }
            NowPlayingLogKind::Change { .. } | NowPlayingLogKind::Other => {}
        }
    }

    fn accept_video_url(&mut self, video_url: &str) -> bool {
        if video_url.is_empty() || self.state.last_video_url == video_url {
            return false;
        }
        self.state.last_video_url = video_url.to_string();
        self.state.now_playing_url = video_url.to_string();
        true
    }
}

fn batch_write_count(batch: &GameLogWriteBatch) -> usize {
    batch.locations.len()
        + batch.location_time_updates.len()
        + batch.join_leave.len()
        + batch.portal_spawns.len()
        + batch.video_plays.len()
        + batch.resource_loads.len()
        + batch.events.len()
        + batch.externals.len()
}

fn remove_player_for_leave(
    state: &mut GameLogRuntimeState,
    display_name: &str,
    user_id: &str,
) -> Option<PlayerState> {
    let candidates = state
        .players_by_key
        .iter()
        .map(|(key, player)| (key.clone(), player.display_name.clone()))
        .collect::<Vec<_>>();
    let key = super::roster::resolve_leave_key(&candidates, user_id, display_name)?;
    state.players_by_key.remove(&key)
}

fn pending_video<'a>(
    output: &'a mut GameLogIngestOutput,
    created_at: &str,
    video_url: &str,
) -> Option<&'a mut VideoInput> {
    output
        .side_effects
        .iter_mut()
        .rev()
        .find_map(|side_effect| match side_effect {
            GameLogSideEffect::Video(input)
                if input.created_at == created_at && input.video_url == video_url =>
            {
                Some(input)
            }
            _ => None,
        })
}

fn push_video_details(
    output: &mut GameLogIngestOutput,
    created_at: String,
    video_url: String,
    video_name: String,
    thumbnail_url: String,
) {
    if video_name.is_empty() && thumbnail_url.is_empty() {
        return;
    }
    if let Some(input) = pending_video(output, &created_at, &video_url) {
        if !video_name.is_empty() {
            input.video_name = video_name;
        }
        if !thumbnail_url.is_empty() {
            input.thumbnail_url = thumbnail_url;
        }
        return;
    }
    output.side_effects.push(GameLogSideEffect::VideoDetails {
        created_at,
        video_url,
        video_name,
        thumbnail_url,
    });
}

fn decode_video_url(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|_| value.trim().to_string())
}

#[cfg(test)]
mod tests;
