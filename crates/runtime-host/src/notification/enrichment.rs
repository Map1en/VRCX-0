use std::sync::{Arc, Mutex};

use vrcx_0_application_activity::OverlayActivityDelivery;
use vrcx_0_application_core::{WebClient, WorldCache};
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_core::location::{format_display_location, is_meaningful_world_name, parse_location};
use vrcx_0_persistence::DatabaseService;

use super::{normalize_avatar_image_url_128, UserImageCache};

#[derive(Clone, Default)]
pub struct RealtimeUserImageResolverSlot {
    inner: Arc<Mutex<Option<Arc<RealtimeHostRuntime>>>>,
}

impl RealtimeUserImageResolverSlot {
    pub fn set(&self, runtime: Arc<RealtimeHostRuntime>) {
        match self.inner.lock() {
            Ok(mut slot) => {
                *slot = Some(runtime);
            }
            Err(error) => {
                tracing::warn!("failed to set realtime user image resolver bridge: {error}");
            }
        }
    }

    pub fn cached_url(
        &self,
        endpoint: &str,
        user_id: &str,
        allow_user_icon: bool,
    ) -> Option<String> {
        let runtime = self.inner.lock().ok()?.clone()?;
        runtime.cached_user_notification_image_url(endpoint, user_id, allow_user_icon)
    }
}

pub async fn resolve_delivery_world_name(
    world_cache: &WorldCache,
    web: &WebClient,
    endpoint: &str,
    delivery: &OverlayActivityDelivery,
) -> Option<(String, String)> {
    if is_meaningful_world_name(&delivery.entry.content.world_name) {
        return None;
    }
    let world_id = {
        let content = &delivery.entry.content;
        let explicit = content.world_id.trim();
        if explicit.is_empty() {
            parse_location(&content.location).world_id
        } else {
            explicit.to_string()
        }
    };
    if world_id.is_empty() {
        return None;
    }
    let name = world_cache.resolve_name(web, endpoint, &world_id).await?;
    let parsed = parse_location(&delivery.entry.content.location);
    let display_location =
        format_display_location(&parsed, &name, &delivery.entry.content.group_name);
    Some((name, display_location))
}

#[allow(clippy::too_many_arguments)]
pub async fn resolve_delivery_actor_image(
    user_image_cache: &UserImageCache,
    web: &WebClient,
    db: &DatabaseService,
    endpoint: &str,
    allow_user_icon: bool,
    current_user_id: &str,
    realtime_user_image_resolver: &RealtimeUserImageResolverSlot,
    delivery: &OverlayActivityDelivery,
) -> Option<String> {
    let actor_user_id = delivery_actor_image_user_id(delivery, current_user_id)?;
    if let Some(image_url) = realtime_user_image_resolver
        .cached_url(endpoint, actor_user_id, allow_user_icon)
        .map(|url| normalize_avatar_image_url_128(&url, endpoint))
    {
        return Some(image_url);
    }
    user_image_cache
        .resolve(web, db, endpoint, actor_user_id, allow_user_icon)
        .await
}

pub fn delivery_actor_image_user_id<'a>(
    delivery: &'a OverlayActivityDelivery,
    current_user_id: &str,
) -> Option<&'a str> {
    if !delivery.entry.content.image_url.trim().is_empty() {
        return None;
    }
    let actor_user_id = delivery.entry.actor_user_id.trim();
    if !actor_user_id.starts_with("usr_") {
        return None;
    }
    let current_user_id = current_user_id.trim();
    if !current_user_id.is_empty() && actor_user_id == current_user_id {
        return None;
    }
    Some(actor_user_id)
}
