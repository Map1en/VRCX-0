use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application_core::{
    sleep_until_due_or_stopped, BackendRuntimeStatusPublisher, ConfigStore, RuntimeAuthIdentity,
    RuntimeAuthScope, RuntimeAuthScopeSnapshot, TaskStopToken,
};

use crate::game_log::host::GameLogHostActions;
use crate::game_log::ingest::GameLogSideEffect;
use crate::game_log::instance_media::{InstanceMediaDeps, InstanceMediaQueue};
use crate::game_log::lifecycle as runtime_lifecycle;
use crate::game_log::video::{now_playing_ends_at_ms, NowPlayingClock};
use crate::RuntimeEventBus;
use crate::{EmptyEventPayload, GameLogSideEffectEvent, GameLogSideEffectSink};
use crate::{InstanceMediaPort, NowPlayingPayload, TaskSupervisor, VideoMetadataPort};

use super::GameLogProcessorDeps;
use vrcx_0_core::OwnerId;

mod handlers;

use handlers::{
    handle_api_request, handle_location_group_name, handle_now_playing_transport,
    handle_screenshot, handle_sticker, handle_video, handle_video_details,
};

#[derive(Clone)]
pub(super) struct GameLogSideEffectDeps {
    stores: crate::GameLogStores,
    config: Arc<dyn ConfigStore>,
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
            stores: deps.stores.clone(),
            config: Arc::clone(&deps.config),
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
            config: Arc::clone(&self.config),
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
        GameLogSideEffect::Video(input) => handle_video(deps, input, deliver_activity),
        GameLogSideEffect::VideoDetails {
            created_at,
            video_url,
            video_name,
            thumbnail_url,
        } => handle_video_details(deps, created_at, video_url, video_name, thumbnail_url),
        GameLogSideEffect::NowPlayingTransport {
            created_at,
            position,
            paused,
        } => handle_now_playing_transport(deps, created_at, position, paused),
        GameLogSideEffect::NowPlayingReset => {
            deps.now_playing.begin();
            deps.emit_side_effect(GameLogSideEffectEvent::NowPlayingReset(
                EmptyEventPayload::default(),
            ));
        }
        GameLogSideEffect::Screenshot(input) => handle_screenshot(deps, input),
        GameLogSideEffect::ApiRequest { url } => handle_api_request(deps, url),
        GameLogSideEffect::Sticker {
            user_id,
            display_name,
            inventory_id,
        } => handle_sticker(deps, user_id, display_name, inventory_id),
        GameLogSideEffect::VrcQuit {
            created_at,
            is_game_running,
        } => {
            runtime_lifecycle::handle_vrc_quit(
                deps.config.as_ref(),
                deps.host_actions.as_ref(),
                &created_at,
                is_game_running,
            );
        }
        GameLogSideEffect::NoVr { no_vr } => {
            if let Err(error) = runtime_lifecycle::set_game_no_vr(
                deps.config.as_ref(),
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
        } => handle_location_group_name(deps, created_at, location, group_id),
        GameLogSideEffect::UdonException { data } => {
            if deps
                .config
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
    deps.stores.group_names.fill_location_group_name(
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
