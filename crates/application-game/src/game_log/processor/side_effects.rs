use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application_core::{
    sleep_until_due_or_stopped, BackendRuntimeStatusPublisher, RuntimeAuthIdentity,
    RuntimeAuthScope, RuntimeAuthScopeSnapshot, TaskStopToken,
};

use crate::game_log::host::GameLogHostActions;
use crate::game_log::ingest::GameLogSideEffect;
use crate::game_log::instance_media::{
    self as runtime_instance_media, InstanceMediaDeps, InstanceMediaQueue,
};
use crate::game_log::lifecycle as runtime_lifecycle;
use crate::game_log::screenshot as runtime_screenshot;
use crate::game_log::video::{
    self as runtime_video, now_playing_ends_at_ms, NowPlayingClock, NowPlayingTransport,
};
use crate::RuntimeEventBus;
use crate::{EmptyEventPayload, GameLogSideEffectEvent, GameLogSideEffectSink};
use crate::{InstanceMediaPort, NowPlayingPayload, TaskSupervisor, VideoMetadataPort};

use super::GameLogProcessorDeps;
use vrcx_0_contracts::game_log::{GameLogVideoPlayName, GameLogWriteBatch};
use vrcx_0_core::OwnerId;

#[derive(Clone)]
pub(super) struct GameLogSideEffectDeps {
    store: Arc<dyn crate::GameStateStore>,
    instance_media: Arc<dyn InstanceMediaPort>,
    video_metadata: Arc<dyn VideoMetadataPort>,
    event_bus: RuntimeEventBus,
    backend_status: BackendRuntimeStatusPublisher,
    side_effect_sink: GameLogSideEffectSink,
    tasks: TaskSupervisor,
    activity: Arc<dyn vrcx_0_application_core::ActivityIngress>,
    auth_scope: RuntimeAuthScope,
    auth_scope_snapshot: RuntimeAuthScopeSnapshot,
    media_queue: InstanceMediaQueue,
    now_playing: NowPlayingClock,
    host_actions: Arc<dyn GameLogHostActions>,
    pub(super) auth_identity: RuntimeAuthIdentity,
}

impl GameLogSideEffectDeps {
    pub(super) fn new(
        deps: &GameLogProcessorDeps,
        media_queue: InstanceMediaQueue,
        now_playing: NowPlayingClock,
    ) -> Self {
        let auth_scope_snapshot = deps.auth_scope.snapshot();
        let auth_identity = deps.auth_scope.identity();
        Self {
            store: Arc::clone(&deps.store),
            instance_media: Arc::clone(&deps.instance_media),
            video_metadata: Arc::clone(&deps.video_metadata),
            event_bus: deps.event_bus.clone(),
            backend_status: deps.backend_status.clone(),
            side_effect_sink: deps.side_effect_sink.clone(),
            tasks: deps.tasks.clone(),
            activity: Arc::clone(&deps.activity),
            auth_scope: deps.auth_scope.clone(),
            auth_scope_snapshot,
            media_queue,
            now_playing,
            host_actions: Arc::clone(&deps.host_actions),
            auth_identity,
        }
    }

    fn emit_side_effect(&self, event: GameLogSideEffectEvent) {
        self.side_effect_sink.emit(event);
    }

    fn instance_media_deps(&self) -> InstanceMediaDeps {
        InstanceMediaDeps {
            store: Arc::clone(&self.store),
            media: Arc::clone(&self.instance_media),
            queue: self.media_queue.clone(),
            host_actions: Arc::clone(&self.host_actions),
        }
    }
}

pub(super) fn dispatch_side_effect(
    deps: GameLogSideEffectDeps,
    side_effect: GameLogSideEffect,
    deliver_activity: bool,
) {
    match side_effect {
        GameLogSideEffect::Video(input) => {
            let generation = deps.now_playing.begin();
            deps.tasks
                .clone()
                .spawn_cancellable(move |stop_token| async move {
                    match runtime_video::handle_video_play(
                        deps.store.as_ref(),
                        deps.video_metadata.as_ref(),
                        &deps.event_bus,
                        &deps.backend_status,
                        &OwnerId::new(deps.auth_identity.user_id.clone()),
                        input,
                    )
                    .await
                    {
                        Ok(Some(mut played)) => {
                            if deliver_activity
                                && deps
                                    .auth_scope
                                    .snapshot()
                                    .generation_matches(&deps.auth_scope_snapshot)
                            {
                                deps.activity.ingest_activity(vec![played.activity]);
                            }
                            if deps.now_playing.play(generation, &mut played.now_playing) {
                                if let Some(ends_at_ms) =
                                    announce_now_playing(&deps, played.now_playing)
                                {
                                    end_now_playing_at(&deps, generation, ends_at_ms, &stop_token)
                                        .await;
                                }
                            }
                        }
                        Ok(None) => {}
                        Err(error) => tracing::warn!("GameLog video side effect failed: {error}"),
                    }
                });
        }
        GameLogSideEffect::VideoDetails {
            created_at,
            video_url,
            video_name,
            thumbnail_url,
        } => {
            if !video_name.is_empty() {
                let batch = GameLogWriteBatch {
                    video_play_names: vec![GameLogVideoPlayName {
                        created_at,
                        video_url,
                        video_name: video_name.clone(),
                    }],
                    ..Default::default()
                };
                if let Err(error) = deps
                    .store
                    .write_game_log(&OwnerId::new(deps.auth_identity.user_id.clone()), &batch)
                {
                    tracing::warn!("GameLog video name update failed: {error}");
                }
            }
            let name = (!video_name.is_empty()).then_some(video_name);
            announce_now_playing(
                &deps,
                NowPlayingPayload {
                    name: name.clone(),
                    video_name: name,
                    thumbnail_url: (!thumbnail_url.is_empty()).then_some(thumbnail_url),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                    ..Default::default()
                },
            );
        }
        GameLogSideEffect::NowPlayingTransport {
            created_at,
            position,
            paused,
        } => {
            let transport = NowPlayingTransport {
                created_at,
                position,
                paused,
            };
            if let Some((generation, length_seconds)) =
                deps.now_playing.transport(transport.clone())
            {
                let mut payload = NowPlayingPayload {
                    length: Some(length_seconds),
                    updated_at: chrono::Utc::now().to_rfc3339(),
                    ..Default::default()
                };
                transport.apply_to(&mut payload);
                if let Some(ends_at_ms) = announce_now_playing(&deps, payload) {
                    deps.tasks
                        .clone()
                        .spawn_cancellable(move |stop_token| async move {
                            end_now_playing_at(&deps, generation, ends_at_ms, &stop_token).await;
                        });
                }
            }
        }
        GameLogSideEffect::NowPlayingReset => {
            deps.now_playing.begin();
            deps.emit_side_effect(GameLogSideEffectEvent::NowPlayingReset(
                EmptyEventPayload::default(),
            ));
        }
        GameLogSideEffect::Screenshot(input) => {
            deps.tasks.clone().spawn(async move {
                if let Err(error) = runtime_screenshot::handle_screenshot(
                    deps.store.as_ref(),
                    Arc::clone(&deps.host_actions),
                    &deps.side_effect_sink,
                    &deps.auth_identity,
                    input,
                )
                .await
                {
                    tracing::warn!("GameLog screenshot side effect failed: {error}");
                }
            });
        }
        GameLogSideEffect::ApiRequest { url } => {
            deps.tasks.clone().spawn(async move {
                if let Err(error) =
                    runtime_instance_media::handle_api_request(deps.instance_media_deps(), &url)
                        .await
                {
                    tracing::warn!("GameLog instance media side effect failed: {error}");
                }
            });
        }
        GameLogSideEffect::Sticker {
            user_id,
            display_name,
            inventory_id,
        } => {
            deps.tasks.clone().spawn(async move {
                if let Err(error) = runtime_instance_media::handle_sticker_spawn(
                    deps.instance_media_deps(),
                    &user_id,
                    &display_name,
                    &inventory_id,
                )
                .await
                {
                    tracing::warn!("GameLog sticker side effect failed: {error}");
                }
            });
        }
        GameLogSideEffect::VrcQuit {
            created_at,
            is_game_running,
        } => {
            runtime_lifecycle::handle_vrc_quit(
                deps.store.as_ref(),
                deps.host_actions.as_ref(),
                &created_at,
                is_game_running,
            );
        }
        GameLogSideEffect::NoVr { no_vr } => {
            if let Err(error) = runtime_lifecycle::set_game_no_vr(
                deps.store.as_ref(),
                &deps.side_effect_sink,
                no_vr,
            ) {
                tracing::warn!("GameLog NoVR side effect failed: {error}");
            }
        }
        GameLogSideEffect::LocationGroupName {
            created_at,
            location,
            group_id,
        } => {
            deps.tasks.clone().spawn(async move {
                if let Err(error) =
                    fill_location_group_name(&deps, &created_at, &location, &group_id).await
                {
                    tracing::warn!("GameLog group name side effect failed: {error}");
                }
            });
        }
        GameLogSideEffect::UdonException { data } => {
            if deps
                .store
                .get_bool("udonExceptionLogging", false)
                .unwrap_or(false)
            {
                tracing::warn!(data, "VRChat Udon exception");
            }
        }
    }
}

async fn fill_location_group_name(
    deps: &GameLogSideEffectDeps,
    created_at: &str,
    location: &str,
    group_id: &str,
) -> crate::Result<()> {
    let Some(group) = deps.instance_media.get_group(group_id).await? else {
        return Ok(());
    };
    let group_name = group
        .get("name")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or_default();
    if group_name.is_empty() {
        return Ok(());
    }
    deps.store.fill_location_group_name(
        &OwnerId::new(deps.auth_identity.user_id.clone()),
        created_at,
        location,
        group_name,
    )?;
    Ok(())
}

fn announce_now_playing(deps: &GameLogSideEffectDeps, payload: NowPlayingPayload) -> Option<i64> {
    let ends_at_ms = now_playing_ends_at_ms(&payload);
    deps.emit_side_effect(GameLogSideEffectEvent::NowPlaying(Box::new(payload)));
    ends_at_ms
}

async fn end_now_playing_at(
    deps: &GameLogSideEffectDeps,
    generation: u64,
    ends_at_ms: i64,
    stop_token: &TaskStopToken,
) {
    let remaining_ms = ends_at_ms - chrono::Utc::now().timestamp_millis();
    let due = std::time::Duration::from_millis(u64::try_from(remaining_ms).unwrap_or(0));
    if sleep_until_due_or_stopped(due, stop_token).await && deps.now_playing.finish(generation) {
        deps.emit_side_effect(GameLogSideEffectEvent::NowPlayingReset(
            EmptyEventPayload::default(),
        ));
    }
}
