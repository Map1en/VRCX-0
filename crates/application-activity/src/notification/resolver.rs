use std::sync::{Arc, Mutex, Weak};
use std::time::Duration;

use crate::{ActivityContent, ActivityDelivery};
use vrcx_0_core::location::{format_display_location, is_meaningful_world_name, parse_location};

use super::lookup_cache::{LookupCache, LookupCacheLimits};
use super::user_image::{normalize_avatar_image_url_128, UserImageCache};
use super::{CachedNotificationUserImageResolver, NotificationRemote};

const GROUP_NAME_FETCH_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Clone, Default)]
pub(crate) struct RealtimeUserImageResolverSlot {
    inner: Arc<Mutex<Option<Weak<dyn CachedNotificationUserImageResolver>>>>,
}

impl RealtimeUserImageResolverSlot {
    pub(crate) fn set(&self, resolver: &Arc<dyn CachedNotificationUserImageResolver>) {
        match self.inner.lock() {
            Ok(mut slot) => {
                *slot = Some(Arc::downgrade(resolver));
            }
            Err(error) => {
                tracing::warn!("failed to set realtime user image resolver bridge: {error}");
            }
        }
    }

    pub(crate) fn cached_url(&self, endpoint: &str, user_id: &str) -> Option<String> {
        self.resolver()?.cached_url(endpoint, user_id)
    }

    fn cached_friend_url(&self, endpoint: &str, user_id: &str) -> Option<String> {
        self.resolver()?.cached_friend_url(endpoint, user_id)
    }

    fn resolver(&self) -> Option<Arc<dyn CachedNotificationUserImageResolver>> {
        self.inner.lock().ok()?.as_ref()?.upgrade()
    }
}

pub struct NotificationResolver {
    realtime: RealtimeUserImageResolverSlot,
    user_images: UserImageCache,
    group_names: LookupCache,
    remote: Arc<dyn NotificationRemote>,
}

impl NotificationResolver {
    pub fn new(remote: Arc<dyn NotificationRemote>) -> Self {
        Self {
            realtime: RealtimeUserImageResolverSlot::default(),
            user_images: UserImageCache::new(),
            group_names: LookupCache::new(LookupCacheLimits {
                success_capacity: 256,
                success_ttl: Duration::from_secs(60 * 60),
                failure_capacity: 32,
                failure_ttl: Duration::from_secs(10 * 60),
            }),
            remote,
        }
    }

    pub fn attach_realtime(&self, resolver: &Arc<dyn CachedNotificationUserImageResolver>) {
        self.realtime.set(resolver);
    }

    pub fn friend_image(&self, endpoint: &str, user_id: &str) -> Option<String> {
        let image_url = self.realtime.cached_friend_url(endpoint, user_id)?;
        Some(normalize_avatar_image_url_128(&image_url, endpoint))
    }

    pub async fn user_image(&self, endpoint: &str, user_id: &str) -> Option<String> {
        if let Some(image_url) = self
            .realtime
            .cached_url(endpoint, user_id)
            .or_else(|| self.user_images.cached_url(user_id))
        {
            return Some(normalize_avatar_image_url_128(&image_url, endpoint));
        }
        let image_url = self
            .user_images
            .resolve(self.remote.as_ref(), endpoint, user_id)
            .await?;
        Some(normalize_avatar_image_url_128(&image_url, endpoint))
    }

    pub async fn world_name(
        &self,
        endpoint: &str,
        delivery: &ActivityDelivery,
    ) -> Option<(String, String)> {
        if is_meaningful_world_name(&delivery.entry.content.world_name) {
            return None;
        }
        let world_id = delivery_world_id(delivery);
        if world_id.is_empty() {
            return None;
        }
        let name = self.remote.world_name(endpoint, &world_id).await?;
        let parsed = parse_location(&delivery.entry.content.location);
        let display_location =
            format_display_location(&parsed, &name, &delivery.entry.content.group_name);
        Some((name, display_location))
    }

    pub async fn world_image_url(
        &self,
        endpoint: &str,
        delivery: &ActivityDelivery,
    ) -> Option<String> {
        let world_id = delivery_world_id(delivery);
        if world_id.is_empty() {
            return None;
        }
        self.remote.world_image_url(endpoint, &world_id).await
    }

    pub fn cached_group_name(&self, group_id: &str) -> Option<String> {
        self.group_names.cached(group_id.trim())
    }

    pub async fn group_name(&self, endpoint: &str, group_id: &str) -> Option<String> {
        let group_id = group_id.trim();
        let endpoint = endpoint.trim();
        if !group_id.starts_with("grp_") || endpoint.is_empty() {
            return None;
        }
        let fetch = async {
            tokio::time::timeout(
                GROUP_NAME_FETCH_TIMEOUT,
                self.remote.group_name(endpoint, group_id),
            )
            .await
            .ok()
            .flatten()
            .map(|name| name.trim().to_string())
            .filter(|name| !name.is_empty() && !name.starts_with("grp_"))
        };
        self.group_names.resolve(group_id, fetch).await
    }

    pub async fn avatar_name(&self, endpoint: &str, file_id: &str) -> Option<String> {
        self.remote.avatar_name(endpoint, file_id).await
    }
}

pub fn unresolved_group_id(content: &ActivityContent) -> Option<String> {
    let group_name = content.group_name.trim();
    if !group_name.is_empty() && !group_name.starts_with("grp_") {
        return None;
    }
    let explicit = content.group_id.trim();
    let group_id = if explicit.is_empty() {
        parse_location(&content.location)
            .group_id
            .unwrap_or_default()
    } else {
        explicit.to_string()
    };
    group_id.starts_with("grp_").then_some(group_id)
}

fn delivery_world_id(delivery: &ActivityDelivery) -> String {
    let content = &delivery.entry.content;
    let explicit = content.world_id.trim();
    if explicit.is_empty() {
        parse_location(&content.location).world_id
    } else {
        explicit.to_string()
    }
}
