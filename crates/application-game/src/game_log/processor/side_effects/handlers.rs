use std::sync::Arc;

use vrcx_0_contracts::game_log::{GameLogVideoPlayName, GameLogWriteBatch};
use vrcx_0_core::OwnerId;

use crate::game_log::ingest::ScreenshotInput;
use crate::game_log::instance_media as runtime_instance_media;
use crate::game_log::screenshot as runtime_screenshot;
use crate::game_log::video::{self as runtime_video, NowPlayingTransport, VideoInput};
use crate::NowPlayingPayload;

use super::{
    announce_now_playing, end_now_playing_at, fill_location_group_name, GameLogSideEffectDeps,
};

pub(super) fn handle_video(deps: GameLogSideEffectDeps, input: VideoInput, deliver_activity: bool) {
    let generation = deps.now_playing.begin();
    deps.tasks
        .clone()
        .spawn_cancellable(move |stop_token| async move {
            match runtime_video::handle_video_play(
                &deps.stores,
                deps.config.as_ref(),
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
                        if let Some(ends_at_ms) = announce_now_playing(&deps, played.now_playing) {
                            end_now_playing_at(&deps, generation, ends_at_ms, &stop_token).await;
                        }
                    }
                }
                Ok(None) => {}
                Err(error) => tracing::warn!("GameLog video side effect failed: {error}"),
            }
        });
}

pub(super) fn handle_video_details(
    deps: GameLogSideEffectDeps,
    created_at: String,
    video_url: String,
    video_name: String,
    thumbnail_url: String,
) {
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
            .stores
            .writer
            .write_game_log(&OwnerId::new(deps.auth_identity.user_id.clone()), &batch)
        {
            tracing::warn!("GameLog video name update failed: {error}");
        }
    }
    let name = (!video_name.is_empty()).then_some(video_name);
    announce_now_playing(
        &deps,
        NowPlayingPayload {
            titled: name.as_ref().map(|_| true),
            name: name.clone(),
            video_name: name,
            thumbnail_url: (!thumbnail_url.is_empty()).then_some(thumbnail_url),
            updated_at: chrono::Utc::now().to_rfc3339(),
            ..Default::default()
        },
    );
}

pub(super) fn handle_now_playing_transport(
    deps: GameLogSideEffectDeps,
    created_at: String,
    position: i64,
    paused: bool,
) {
    let transport = NowPlayingTransport {
        created_at,
        position,
        paused,
    };
    if let Some((generation, length_seconds)) = deps.now_playing.transport(transport.clone()) {
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

pub(super) fn handle_screenshot(deps: GameLogSideEffectDeps, input: ScreenshotInput) {
    deps.tasks.clone().spawn(async move {
        if let Err(error) = runtime_screenshot::handle_screenshot(
            deps.stores.locations.as_ref(),
            deps.config.as_ref(),
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

pub(super) fn handle_api_request(deps: GameLogSideEffectDeps, url: String) {
    deps.tasks.clone().spawn(async move {
        if let Err(error) =
            runtime_instance_media::handle_api_request(deps.instance_media_deps(), &url).await
        {
            tracing::warn!("GameLog instance media side effect failed: {error}");
        }
    });
}

pub(super) fn handle_sticker(
    deps: GameLogSideEffectDeps,
    user_id: String,
    display_name: String,
    inventory_id: String,
) {
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

pub(super) fn handle_location_group_name(
    deps: GameLogSideEffectDeps,
    created_at: String,
    location: String,
    group_id: String,
) {
    deps.tasks.clone().spawn(async move {
        if let Err(error) = fill_location_group_name(&deps, &created_at, &location, &group_id).await
        {
            tracing::warn!("GameLog group name side effect failed: {error}");
        }
    });
}
