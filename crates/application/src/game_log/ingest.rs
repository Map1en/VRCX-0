use vrcx_0_core::log_watcher::{GameLogEvent, GameLogEventKind};
use vrcx_0_persistence::game_log::{
    GameLogEventEntry, GameLogExternalEntry, GameLogJoinLeaveEntry, GameLogJoinLeaveSnapshot,
    GameLogLocationEntry, GameLogLocationTimeUpdate, GameLogPortalSpawnEntry,
    GameLogResourceLoadEntry, GameLogWriteBatch,
};

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
    pub is_game_running: bool,
    pub is_steamvr_running: bool,
    pub game_changed: bool,
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
    VideoSync {
        timestamp: String,
        created_at: String,
    },
    NowPlayingReset,
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
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct GameLogIngestOutput {
    pub batch: GameLogWriteBatch,
    pub raw_rows: Vec<Vec<String>>,
    pub runtime_persisted_mirrors: Vec<Vec<String>>,
    pub projection: Option<GameLogProjection>,
    pub side_effects: Vec<GameLogSideEffect>,
}

#[derive(Clone, Debug, Default)]
pub struct GameLogIngestEngine {
    state: GameLogRuntimeState,
}

impl GameLogIngestEngine {
    pub fn runtime_snapshot(&self) -> RuntimeSnapshot {
        self.state.snapshot()
    }
    pub fn seed_current_location(
        &mut self,
        location: String,
        world_name: String,
        started_at: String,
    ) {
        if location.is_empty() || !self.state.current_location.is_empty() {
            return;
        }
        self.state.current_location = location;
        self.state.current_world_name = world_name;
        self.state.current_location_started_at = started_at.clone();
        self.state.current_location_started_at_ms = parse_event_time_ms(&started_at);
    }

    pub fn seed_current_roster(&mut self, entries: &[GameLogJoinLeaveSnapshot]) {
        if self.state.current_location.is_empty() || !self.state.players_by_key.is_empty() {
            return;
        }
        for entry in entries {
            if entry.user_id.trim().is_empty() && entry.display_name.trim().is_empty() {
                continue;
            }
            let key = player_key(&entry.user_id, &entry.display_name);
            match entry.event_type.as_str() {
                "OnPlayerJoined" => {
                    self.state.players_by_key.insert(
                        key,
                        PlayerState {
                            user_id: entry.user_id.clone(),
                            display_name: entry.display_name.clone(),
                            join_time_ms: parse_event_time_ms(&entry.created_at),
                        },
                    );
                }
                "OnPlayerLeft" => {
                    self.state.players_by_key.remove(&key);
                }
                _ => {}
            }
        }
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
            raw_rows: events.iter().map(GameLogEvent::to_compat_row).collect(),
            ..Default::default()
        };

        for event in events {
            let write_count_before = batch_write_count(&output.batch);
            match &event.kind {
                GameLogEventKind::Location {
                    location,
                    world_name,
                } => self.ingest_location(&mut output.batch, event, location, world_name),
                GameLogEventKind::LocationDestination { .. } => {
                    self.finalize_location_session(&mut output.batch, &event.created_at);
                    self.state.current_location = "traveling".into();
                    self.state.current_world_name.clear();
                    if let GameLogEventKind::LocationDestination { location } = &event.kind {
                        self.state.current_destination = location.clone();
                    }
                    self.state.current_location_started_at = event.created_at.clone();
                    self.state.current_location_started_at_ms =
                        parse_event_time_ms(&event.created_at);
                }
                GameLogEventKind::PlayerJoined {
                    display_name,
                    user_id,
                } => self.ingest_player_joined(&mut output.batch, event, display_name, user_id),
                GameLogEventKind::PlayerLeft {
                    display_name,
                    user_id,
                } => self.ingest_player_left(&mut output.batch, event, display_name, user_id),
                GameLogEventKind::PortalSpawn => self.ingest_portal_spawn(&mut output.batch, event),
                GameLogEventKind::Notification { .. } | GameLogEventKind::AvatarChange { .. } => {}
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
                        output.side_effects.push(GameLogSideEffect::Video(input));
                    }
                }
                GameLogEventKind::VideoSync { timestamp } => {
                    output.side_effects.push(GameLogSideEffect::VideoSync {
                        timestamp: timestamp.clone(),
                        created_at: event.created_at.clone(),
                    });
                }
                GameLogEventKind::Vrcx { data } => {
                    match video::parse_provider_video(
                        &event.created_at,
                        &self.state.current_location,
                        data,
                    ) {
                        video::ProviderVideoEvent::Video(input) => {
                            if self.accept_video_url(&input.video_url) {
                                output.side_effects.push(GameLogSideEffect::Video(*input));
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

        if let Some(row) = output.raw_rows.last() {
            output.projection = Some(self.state.projection(
                row.get(1).map(String::as_str).unwrap_or_default(),
                row.get(2).map(String::as_str).unwrap_or_default(),
            ));
        }

        output
    }

    pub fn handle_process_event(&mut self, event: GameLogProcessEvent) -> GameLogIngestOutput {
        let mut output = GameLogIngestOutput::default();
        self.state.is_game_running = event.is_game_running;
        self.state.is_steamvr_running = event.is_steamvr_running;
        if event.game_changed && !event.is_game_running {
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
            output.projection = Some(self.state.projection(&event.changed_at, "game-stopped"));
        }
        output
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
    ) {
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
    let key = player_key(user_id, display_name);
    if let Some(player) = state.players_by_key.remove(&key) {
        return Some(player);
    }

    let normalized_display_name = display_name.trim();
    if normalized_display_name.is_empty() {
        return None;
    }

    let matches = state
        .players_by_key
        .iter()
        .filter(|(_, player)| {
            player
                .display_name
                .trim()
                .eq_ignore_ascii_case(normalized_display_name)
        })
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return None;
    }

    state.players_by_key.remove(&matches[0])
}

fn decode_video_url(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(|value| value.trim().to_string())
        .unwrap_or_else(|_| value.trim().to_string())
}

#[cfg(test)]
mod tests {
    use vrcx_0_core::log_watcher::{GameLogEvent, GameLogEventKind};

    use super::{GameLogIngestEngine, GameLogIngestOptions, GameLogJoinLeaveSnapshot};

    fn event(created_at: &str, kind: GameLogEventKind) -> GameLogEvent {
        GameLogEvent {
            file_name: "output_log.txt".into(),
            created_at: created_at.into(),
            kind,
        }
    }

    #[test]
    fn resource_load_without_write_does_not_emit_runtime_persisted_mirror() {
        let mut engine = GameLogIngestEngine::default();
        let output = engine.ingest_events(
            &[event(
                "2026-05-14T00:00:00.000Z",
                GameLogEventKind::ResourceLoad {
                    resource_type: "ImageLoad".into(),
                    resource_url: "https://example.test/image.png".into(),
                },
            )],
            GameLogIngestOptions {
                log_resource_load: false,
            },
        );

        assert!(output.batch.is_empty());
        assert!(output.runtime_persisted_mirrors.is_empty());
    }

    #[test]
    fn provider_video_vrcx_event_does_not_emit_core_persisted_mirror() {
        let mut engine = GameLogIngestEngine::default();
        let output = engine.ingest_events(
            &[event(
                "2026-05-14T00:00:00.000Z",
                GameLogEventKind::Vrcx {
                    data: "VideoPlay(PyPyDance) \"https://example.test\",0,10,\"Song (Alpha)\""
                        .into(),
                },
            )],
            GameLogIngestOptions::default(),
        );

        assert!(output.batch.is_empty());
        assert_eq!(output.side_effects.len(), 1);
        assert!(output.runtime_persisted_mirrors.is_empty());
    }

    #[test]
    fn player_left_tolerates_missing_join_user_id_when_display_name_is_unique() {
        let mut engine = GameLogIngestEngine::default();
        let output = engine.ingest_events(
            &[
                event(
                    "2026-05-14T04:00:00.000Z",
                    GameLogEventKind::Location {
                        location: "wrld_ingest:1".into(),
                        world_name: "Ingest World".into(),
                    },
                ),
                event(
                    "2026-05-14T04:00:10.000Z",
                    GameLogEventKind::PlayerJoined {
                        display_name: "Left Player".into(),
                        user_id: String::new(),
                    },
                ),
                event(
                    "2026-05-14T04:00:40.000Z",
                    GameLogEventKind::PlayerLeft {
                        display_name: "Left Player".into(),
                        user_id: "usr_left".into(),
                    },
                ),
            ],
            GameLogIngestOptions::default(),
        );

        assert_eq!(output.batch.join_leave.len(), 2);
        assert_eq!(output.batch.join_leave[1].event_type, "OnPlayerLeft");
        assert_eq!(output.batch.join_leave[1].time, 30000);
        assert!(output
            .projection
            .unwrap()
            .current_location_players
            .is_empty());
    }

    #[test]
    fn external_vrcx_event_emits_mirror_when_external_row_is_written() {
        let mut engine = GameLogIngestEngine::default();
        let output = engine.ingest_events(
            &[event(
                "2026-05-14T00:00:00.000Z",
                GameLogEventKind::Vrcx {
                    data: "UnknownProvider payload".into(),
                },
            )],
            GameLogIngestOptions::default(),
        );

        assert_eq!(output.batch.externals.len(), 1);
        assert_eq!(output.runtime_persisted_mirrors.len(), 1);
        assert_eq!(output.runtime_persisted_mirrors[0][2], "vrcx");
    }

    #[test]
    fn seed_current_roster_pairs_leave_with_real_join_time() {
        let mut engine = GameLogIngestEngine::default();
        engine.seed_current_location(
            "wrld_seed:1".into(),
            "Seed World".into(),
            "2026-05-14T04:00:00.000Z".into(),
        );
        let entries = vec![
            GameLogJoinLeaveSnapshot {
                created_at: "2026-05-14T04:00:10.000Z".into(),
                event_type: "OnPlayerJoined".into(),
                display_name: "Alice".into(),
                user_id: "usr_alice".into(),
            },
            GameLogJoinLeaveSnapshot {
                created_at: "2026-05-14T04:00:20.000Z".into(),
                event_type: "OnPlayerJoined".into(),
                display_name: "Bob".into(),
                user_id: "usr_bob".into(),
            },
            GameLogJoinLeaveSnapshot {
                created_at: "2026-05-14T04:05:00.000Z".into(),
                event_type: "OnPlayerLeft".into(),
                display_name: "Bob".into(),
                user_id: "usr_bob".into(),
            },
        ];
        engine.seed_current_roster(&entries);

        let output = engine.ingest_events(
            &[event(
                "2026-05-14T04:40:10.000Z",
                GameLogEventKind::PlayerLeft {
                    display_name: "Alice".into(),
                    user_id: "usr_alice".into(),
                },
            )],
            GameLogIngestOptions::default(),
        );

        assert_eq!(output.batch.join_leave.len(), 1);
        assert_eq!(output.batch.join_leave[0].event_type, "OnPlayerLeft");
        // 04:40:10 - 04:00:10 = 2400s; without the seed this would be 0.
        assert_eq!(output.batch.join_leave[0].time, 2_400_000);
    }

    #[test]
    fn seed_current_roster_ignored_when_roster_already_populated() {
        let mut engine = GameLogIngestEngine::default();
        engine.seed_current_location(
            "wrld_seed:1".into(),
            "Seed World".into(),
            "2026-05-14T04:00:00.000Z".into(),
        );
        engine.ingest_events(
            &[event(
                "2026-05-14T04:00:05.000Z",
                GameLogEventKind::PlayerJoined {
                    display_name: "Alice".into(),
                    user_id: "usr_alice".into(),
                },
            )],
            GameLogIngestOptions::default(),
        );
        engine.seed_current_roster(&[GameLogJoinLeaveSnapshot {
            created_at: "2020-01-01T00:00:00.000Z".into(),
            event_type: "OnPlayerJoined".into(),
            display_name: "Alice".into(),
            user_id: "usr_alice".into(),
        }]);

        let output = engine.ingest_events(
            &[event(
                "2026-05-14T04:00:35.000Z",
                GameLogEventKind::PlayerLeft {
                    display_name: "Alice".into(),
                    user_id: "usr_alice".into(),
                },
            )],
            GameLogIngestOptions::default(),
        );

        // The live join (04:00:05) wins over the stale seed, so 30s not years.
        assert_eq!(output.batch.join_leave[0].time, 30000);
    }

    #[test]
    fn seeded_location_applies_to_join_without_location_event() {
        let mut engine = GameLogIngestEngine::default();
        engine.seed_current_location(
            "wrld_seed:1".into(),
            "Seed World".into(),
            "2026-05-14T10:00:00.000Z".into(),
        );
        let output = engine.ingest_events(
            &[event(
                "2026-05-14T10:05:00.000Z",
                GameLogEventKind::PlayerJoined {
                    display_name: "Resumed".into(),
                    user_id: "usr_resumed".into(),
                },
            )],
            GameLogIngestOptions::default(),
        );

        assert_eq!(output.batch.join_leave.len(), 1);
        assert_eq!(output.batch.join_leave[0].location, "wrld_seed:1");
        assert_eq!(
            engine.runtime_snapshot().started_at,
            "2026-05-14T10:00:00.000Z"
        );
    }

    #[test]
    fn seed_does_not_override_observed_location() {
        let mut engine = GameLogIngestEngine::default();
        engine.ingest_events(
            &[event(
                "2026-05-14T10:00:00.000Z",
                GameLogEventKind::Location {
                    location: "wrld_real:1".into(),
                    world_name: "Real".into(),
                },
            )],
            GameLogIngestOptions::default(),
        );
        engine.seed_current_location(
            "wrld_seed:1".into(),
            "Seed".into(),
            "2026-05-14T09:00:00.000Z".into(),
        );
        let output = engine.ingest_events(
            &[event(
                "2026-05-14T10:01:00.000Z",
                GameLogEventKind::PlayerJoined {
                    display_name: "Player".into(),
                    user_id: "usr_player".into(),
                },
            )],
            GameLogIngestOptions::default(),
        );

        assert_eq!(output.batch.join_leave[0].location, "wrld_real:1");
    }
}
