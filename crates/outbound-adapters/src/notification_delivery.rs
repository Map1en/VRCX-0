use std::{
    sync::{Arc, Weak},
    time::Duration,
};

use serde_json::Value;
use vrcx_0_application_activity::notification::{
    CachedNotificationUserImageResolver, NotificationConfig, NotificationRemote,
    NotificationRemoteFuture, NotificationWebhookFuture, NotificationWebhookTransport,
    NotificationWebhookTransportError,
};
use vrcx_0_application_core::{FileCache, WebClient, WebExecuteRequest, WorldCache};
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_core::json::JsonExt;
use vrcx_0_persistence::config::ConfigRepository;
use vrcx_0_vrchat_client::http_api::ApiScope;

const WEBHOOK_TIMEOUT: Duration = Duration::from_secs(10);
const WEBHOOK_RESPONSE_BODY_LIMIT: usize = 64 * 1024;

pub struct LocalNotificationConfig {
    config: ConfigRepository,
}

impl LocalNotificationConfig {
    pub fn new(config: ConfigRepository) -> Self {
        Self { config }
    }
}

impl NotificationConfig for LocalNotificationConfig {
    fn get_raw(&self, key: &str) -> vrcx_0_application_core::Result<Option<String>> {
        Ok(self.config.get_raw(key)?)
    }

    fn get_bool(&self, key: &str, default_value: bool) -> vrcx_0_application_core::Result<bool> {
        Ok(self.config.get_bool(key, default_value)?)
    }

    fn get_string(
        &self,
        key: &str,
        default_value: &str,
    ) -> vrcx_0_application_core::Result<String> {
        Ok(self.config.get_string(key, default_value)?)
    }

    fn set_json(&self, key: &str, value: &Value) -> vrcx_0_application_core::Result<()> {
        Ok(self.config.set_json(key, value)?)
    }
}

pub struct VrchatNotificationRemote {
    web: Arc<WebClient>,
    world_cache: Arc<WorldCache>,
    file_cache: FileCache,
}

impl VrchatNotificationRemote {
    pub fn new(web: Arc<WebClient>, world_cache: Arc<WorldCache>, file_cache: FileCache) -> Self {
        Self {
            web,
            world_cache,
            file_cache,
        }
    }
}

impl NotificationRemote for VrchatNotificationRemote {
    fn user<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
    ) -> NotificationRemoteFuture<'a, Value> {
        Box::pin(async move {
            let (_, request) = vrcx_0_vrchat_client::users::user_get_input(
                endpoint.to_string(),
                user_id.to_string(),
            )
            .ok()?;
            let response = self.web.execute_api(request, ApiScope::Vrchat).await.ok()?;
            if !(200..=299).contains(&response.status) {
                return None;
            }
            serde_json::from_str(&response.data).ok()
        })
    }

    fn avatar_name<'a>(
        &'a self,
        endpoint: &'a str,
        file_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String> {
        Box::pin(async move {
            self.file_cache
                .resolve(self.web.as_ref(), endpoint, file_id)
                .await?
                .avatar_name
        })
    }

    fn world_name<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String> {
        Box::pin(async move {
            self.world_cache
                .resolve_name(self.web.as_ref(), endpoint, world_id)
                .await
        })
    }

    fn world_image_url<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String> {
        Box::pin(async move {
            self.world_cache
                .resolve_image_url(self.web.as_ref(), endpoint, world_id)
                .await
        })
    }

    fn group_name<'a>(
        &'a self,
        endpoint: &'a str,
        group_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String> {
        Box::pin(async move {
            let (_, request) = vrcx_0_vrchat_client::groups::profile_get_input(
                endpoint.to_string(),
                group_id.to_string(),
                false,
            )
            .ok()?;
            let response = self.web.execute_api(request, ApiScope::Vrchat).await.ok()?;
            if !(200..=299).contains(&response.status) {
                return None;
            }
            let group: Value = serde_json::from_str(&response.data).ok()?;
            group.trimmed_field("name").map(str::to_string)
        })
    }
}

pub struct LocalNotificationWebhookTransport {
    web: Arc<WebClient>,
}

impl LocalNotificationWebhookTransport {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self { web }
    }
}

impl NotificationWebhookTransport for LocalNotificationWebhookTransport {
    fn send<'a>(&'a self, url: &'a str, body: &'a str) -> NotificationWebhookFuture<'a> {
        Box::pin(async move {
            let mut request = WebExecuteRequest::new(url.to_string(), "POST".to_string());
            request
                .headers
                .push(("Content-Type".into(), "application/json".into()));
            request.body = Some(body.to_string());
            request.response_body_limit = Some(WEBHOOK_RESPONSE_BODY_LIMIT);
            match tokio::time::timeout(WEBHOOK_TIMEOUT, self.web.execute(request)).await {
                Ok(Ok(response)) => Ok(response),
                Ok(Err(_)) => Err(NotificationWebhookTransportError::Transport),
                Err(_) => Err(NotificationWebhookTransportError::Timeout),
            }
        })
    }
}

pub struct RealtimeNotificationUserImageResolver {
    runtime: Weak<RealtimeHostRuntime>,
}

impl RealtimeNotificationUserImageResolver {
    pub fn new(runtime: &Arc<RealtimeHostRuntime>) -> Self {
        Self {
            runtime: Arc::downgrade(runtime),
        }
    }
}

impl CachedNotificationUserImageResolver for RealtimeNotificationUserImageResolver {
    fn cached_url(&self, endpoint: &str, user_id: &str) -> Option<String> {
        self.runtime
            .upgrade()?
            .cached_user_notification_image_url(endpoint, user_id)
    }

    fn cached_friend_url(&self, endpoint: &str, user_id: &str) -> Option<String> {
        self.runtime
            .upgrade()?
            .cached_friend_notification_image_url(endpoint, user_id)
    }
}
