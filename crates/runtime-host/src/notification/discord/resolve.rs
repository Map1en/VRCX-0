use std::time::Duration;

use serde_json::Value;
use vrcx_0_application::{OverlayActivityDelivery, WebClient, WorldCache};
use vrcx_0_core::avatar::avatar_name_from_file_name;
use vrcx_0_core::location::parse_location;
use vrcx_0_persistence::worlds::world_cache_get;
use vrcx_0_persistence::DatabaseService;
use vrcx_0_vrchat_client::avatars::avatar_file_get_input;
use vrcx_0_vrchat_client::http_api::ApiScope;

use crate::notification::image_file::extract_file_id;
use crate::notification::user_image::UserImageCache;

const DISCORD_RESOLVE_TIMEOUT: Duration = Duration::from_secs(10);

pub(crate) struct DiscordDeps<'a> {
    pub(crate) world_cache: &'a WorldCache,
    pub(crate) user_image_cache: &'a UserImageCache,
    pub(crate) web: &'a WebClient,
    pub(crate) db: &'a DatabaseService,
    pub(crate) endpoint: &'a str,
    pub(crate) allow_user_icon: bool,
}

pub(super) async fn resolve_avatar_name(
    deps: &DiscordDeps<'_>,
    delivery: &OverlayActivityDelivery,
) -> String {
    let Some(file_id) = extract_file_id(&delivery.entry.content.image_url) else {
        return String::new();
    };
    let Ok((_, request)) = avatar_file_get_input(deps.endpoint.to_string(), file_id) else {
        return String::new();
    };
    let response = match tokio::time::timeout(
        DISCORD_RESOLVE_TIMEOUT,
        deps.web.execute_api(request, ApiScope::Vrchat, deps.db),
    )
    .await
    {
        Ok(Ok(response)) => response,
        _ => return String::new(),
    };
    if !(200..=299).contains(&response.status) {
        return String::new();
    }
    let Ok(value) = serde_json::from_str::<Value>(&response.data) else {
        return String::new();
    };
    value
        .get("name")
        .and_then(Value::as_str)
        .and_then(avatar_name_from_file_name)
        .unwrap_or_default()
}

pub(super) async fn resolve_actor_icon_url(
    deps: &DiscordDeps<'_>,
    delivery: &OverlayActivityDelivery,
) -> String {
    let actor = delivery.entry.actor_user_id.trim();
    if actor.is_empty() {
        return String::new();
    }
    match tokio::time::timeout(
        DISCORD_RESOLVE_TIMEOUT,
        deps.user_image_cache.resolve(
            deps.web,
            deps.db,
            deps.endpoint,
            actor,
            deps.allow_user_icon,
        ),
    )
    .await
    {
        Ok(result) => result.unwrap_or_default(),
        Err(_) => String::new(),
    }
}

pub(super) async fn resolve_world_thumbnail_url(
    deps: &DiscordDeps<'_>,
    delivery: &OverlayActivityDelivery,
) -> String {
    let content = &delivery.entry.content;
    let explicit = content.world_id.trim();
    let world_id = if explicit.is_empty() {
        parse_location(&content.location).world_id
    } else {
        explicit.to_string()
    };
    if world_id.is_empty() {
        return String::new();
    }
    let _ = tokio::time::timeout(
        DISCORD_RESOLVE_TIMEOUT,
        deps.world_cache
            .resolve_name(deps.web, deps.endpoint, &world_id),
    )
    .await;
    match world_cache_get(deps.db, world_id.clone()) {
        Ok(Some(world)) => {
            let thumbnail = world.thumbnail_image_url.trim();
            if thumbnail.is_empty() {
                world.image_url.trim().to_string()
            } else {
                thumbnail.to_string()
            }
        }
        Ok(None) => String::new(),
        Err(error) => {
            tracing::warn!(world_id = %world_id, "world thumbnail lookup failed: {error}");
            String::new()
        }
    }
}
