use std::sync::Arc;
use vrcx_0_application_activity::OverlayActivityRuntime;

use vrcx_0_application_core::{
    BackendRuntimeStatusPublisher, RuntimeAuthIdentity, RuntimeAuthScope, RuntimeAuthScopeSnapshot,
};

use crate::game_log::host::GameLogHostActions;
use crate::game_log::ingest::GameLogSideEffect;
use crate::game_log::instance_media::{
    self as runtime_instance_media, InstanceMediaDeps, InstanceMediaQueue,
};
use crate::game_log::lifecycle as runtime_lifecycle;
use crate::game_log::screenshot as runtime_screenshot;
use crate::game_log::video as runtime_video;
use crate::RuntimeEventBus;
use crate::{EmptyEventPayload, GameLogSideEffectEvent, GameLogSideEffectSink};
use crate::{InstanceMediaPort, TaskSupervisor, VideoMetadataPort};

use super::GameLogProcessorDeps;
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
    overlay_activity: OverlayActivityRuntime,
    auth_scope: RuntimeAuthScope,
    auth_scope_snapshot: RuntimeAuthScopeSnapshot,
    media_queue: InstanceMediaQueue,
    host_actions: Arc<dyn GameLogHostActions>,
    pub(super) auth_identity: RuntimeAuthIdentity,
}

impl GameLogSideEffectDeps {
    pub(super) fn new(deps: &GameLogProcessorDeps, media_queue: InstanceMediaQueue) -> Self {
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
            overlay_activity: deps.overlay_activity.clone(),
            auth_scope: deps.auth_scope.clone(),
            auth_scope_snapshot,
            media_queue,
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
            deps.tasks.clone().spawn(async move {
                match runtime_video::handle_video_play(
                    deps.store.as_ref(),
                    deps.video_metadata.as_ref(),
                    &deps.event_bus,
                    &deps.backend_status,
                    &deps.side_effect_sink,
                    &OwnerId::new(deps.auth_identity.user_id),
                    input,
                )
                .await
                {
                    Ok(Some(candidate))
                        if deliver_activity
                            && deps
                                .auth_scope
                                .snapshot()
                                .generation_matches(&deps.auth_scope_snapshot) =>
                    {
                        deps.overlay_activity.ingest_candidate(candidate);
                    }
                    Ok(_) => {}
                    Err(error) => tracing::warn!("GameLog video side effect failed: {error}"),
                }
            });
        }
        GameLogSideEffect::VideoSync {
            timestamp,
            created_at,
        } => {
            runtime_lifecycle::emit_video_sync(&deps.side_effect_sink, &timestamp, &created_at);
        }
        GameLogSideEffect::NowPlayingReset => {
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
                &deps.side_effect_sink,
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
