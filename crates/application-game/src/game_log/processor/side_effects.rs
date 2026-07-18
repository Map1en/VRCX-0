use std::sync::Arc;

use vrcx_0_persistence::config as config_store;
use vrcx_0_persistence::DatabaseService;

use crate::game_log::host::GameLogHostActions;
use crate::game_log::ingest::GameLogSideEffect;
use crate::game_log::instance_media::{
    self as runtime_instance_media, InstanceMediaDeps, InstanceMediaQueue,
};
use crate::game_log::lifecycle as runtime_lifecycle;
use crate::game_log::screenshot as runtime_screenshot;
use crate::game_log::video as runtime_video;
use crate::RuntimeEventBus;
use crate::RuntimeGameEventBusExt;
use crate::{EmptyEventPayload, GameLogSideEffectEvent};
use crate::{ImageCache, TaskSupervisor, WebClient};

use super::GameLogProcessorDeps;

#[derive(Clone)]
pub(super) struct GameLogSideEffectDeps {
    db: Arc<DatabaseService>,
    web: Arc<WebClient>,
    image_cache: Arc<ImageCache>,
    event_bus: RuntimeEventBus,
    tasks: TaskSupervisor,
    media_queue: InstanceMediaQueue,
    host_actions: Arc<dyn GameLogHostActions>,
    pub(super) owner_user_id: String,
}

impl GameLogSideEffectDeps {
    pub(super) fn new(deps: &GameLogProcessorDeps, media_queue: InstanceMediaQueue) -> Self {
        Self {
            db: Arc::clone(&deps.db),
            web: Arc::clone(&deps.web),
            image_cache: Arc::clone(&deps.image_cache),
            event_bus: deps.event_bus.clone(),
            tasks: deps.tasks.clone(),
            media_queue,
            host_actions: Arc::clone(&deps.host_actions),
            owner_user_id: deps.auth_scope.snapshot().current_user_id,
        }
    }

    fn emit_side_effect(&self, event: GameLogSideEffectEvent) {
        self.event_bus.emit_game_log_side_effect(event);
    }

    fn instance_media_deps(&self) -> InstanceMediaDeps {
        InstanceMediaDeps {
            db: Arc::clone(&self.db),
            web: Arc::clone(&self.web),
            image_cache: Arc::clone(&self.image_cache),
            queue: self.media_queue.clone(),
            host_actions: Arc::clone(&self.host_actions),
        }
    }
}

pub(super) fn dispatch_side_effect(deps: GameLogSideEffectDeps, side_effect: GameLogSideEffect) {
    match side_effect {
        GameLogSideEffect::Video(input) => {
            deps.tasks.clone().spawn(async move {
                if let Err(error) = runtime_video::handle_video_play(
                    deps.db.as_ref(),
                    deps.web.as_ref(),
                    &deps.event_bus,
                    &deps.owner_user_id,
                    input,
                )
                .await
                {
                    tracing::warn!("GameLog video side effect failed: {error}");
                }
            });
        }
        GameLogSideEffect::VideoSync {
            timestamp,
            created_at,
        } => {
            runtime_lifecycle::emit_video_sync(&deps.event_bus, &timestamp, &created_at);
        }
        GameLogSideEffect::NowPlayingReset => {
            deps.emit_side_effect(GameLogSideEffectEvent::NowPlayingReset(
                EmptyEventPayload::default(),
            ));
        }
        GameLogSideEffect::Screenshot(input) => {
            deps.tasks.clone().spawn(async move {
                if let Err(error) = runtime_screenshot::handle_screenshot(
                    deps.db.as_ref(),
                    deps.host_actions.as_ref(),
                    &deps.event_bus,
                    &deps.owner_user_id,
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
                deps.db.as_ref(),
                deps.host_actions.as_ref(),
                &deps.event_bus,
                &created_at,
                is_game_running,
            );
        }
        GameLogSideEffect::NoVr { no_vr } => {
            if let Err(error) =
                runtime_lifecycle::set_game_no_vr(deps.db.as_ref(), &deps.event_bus, no_vr)
            {
                tracing::warn!("GameLog NoVR side effect failed: {error}");
            }
        }
        GameLogSideEffect::UdonException { data } => {
            if config_store::get_bool(&deps.db, "udonExceptionLogging", false).unwrap_or(false) {
                tracing::warn!(data, "VRChat Udon exception");
            }
        }
    }
}
