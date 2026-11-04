use std::{future::Future, pin::Pin};

use serde_json::Value;

pub type NotificationRemoteFuture<'a, T> = Pin<Box<dyn Future<Output = Option<T>> + Send + 'a>>;

pub trait NotificationRemote: Send + Sync {
    fn user<'a>(
        &'a self,
        endpoint: &'a str,
        user_id: &'a str,
    ) -> NotificationRemoteFuture<'a, Value>;
    fn avatar_name<'a>(
        &'a self,
        endpoint: &'a str,
        file_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String>;
    fn world_name<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String>;
    fn world_image_url<'a>(
        &'a self,
        endpoint: &'a str,
        world_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String>;
    fn group_name<'a>(
        &'a self,
        endpoint: &'a str,
        group_id: &'a str,
    ) -> NotificationRemoteFuture<'a, String>;
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NotificationWebhookTransportError {
    Timeout,
    Transport,
}

pub type NotificationWebhookFuture<'a> = Pin<
    Box<
        dyn Future<Output = std::result::Result<(i32, String), NotificationWebhookTransportError>>
            + Send
            + 'a,
    >,
>;

pub trait NotificationWebhookTransport: Send + Sync {
    fn send<'a>(&'a self, url: &'a str, body: &'a str) -> NotificationWebhookFuture<'a>;
}

pub trait CachedNotificationUserImageResolver: Send + Sync {
    fn cached_url(&self, endpoint: &str, user_id: &str) -> Option<String>;
    fn cached_friend_url(&self, endpoint: &str, user_id: &str) -> Option<String>;
}
