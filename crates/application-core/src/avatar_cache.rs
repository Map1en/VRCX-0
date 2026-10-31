use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use vrcx_0_contracts::{AvatarCacheOutput, CacheEntityInput};

use crate::{Result, WebClient};

#[async_trait]
pub trait AvatarCachePort: Send + Sync {
    fn invalidate(&self, user_id: &str, endpoint: &str, avatar_id: &str);
    fn get_summary(
        &self,
        user_id: &str,
        endpoint: &str,
        avatar_id: &str,
    ) -> Result<Option<AvatarCacheOutput>>;
    fn find_by_image_url(
        &self,
        user_id: &str,
        endpoint: &str,
        image_url: &str,
    ) -> Result<Option<Arc<Value>>>;
    fn hydrate_from_payload(
        &self,
        user_id: &str,
        endpoint: &str,
        avatar: Value,
    ) -> Option<Arc<Value>>;
    fn existing_summary_ids(&self, avatar_ids: &[String]) -> Result<Vec<String>>;
    fn store_summaries(
        &self,
        user_id: &str,
        endpoint: &str,
        entries: Vec<CacheEntityInput>,
    ) -> Result<u32>;
    async fn resolve(
        &self,
        web: &WebClient,
        user_id: &str,
        endpoint: &str,
        avatar_id: &str,
        full: bool,
        fresh: bool,
    ) -> Result<Option<Arc<Value>>>;
}

pub struct AvatarCache {
    inner: Arc<dyn AvatarCachePort>,
}

impl AvatarCache {
    pub fn new(inner: impl AvatarCachePort + 'static) -> Self {
        Self {
            inner: Arc::new(inner),
        }
    }

    pub fn invalidate(&self, user_id: &str, endpoint: &str, avatar_id: &str) {
        self.inner.invalidate(user_id, endpoint, avatar_id);
    }

    pub fn get_summary(
        &self,
        user_id: &str,
        endpoint: &str,
        avatar_id: &str,
    ) -> Result<Option<AvatarCacheOutput>> {
        self.inner.get_summary(user_id, endpoint, avatar_id)
    }

    pub fn find_by_image_url(
        &self,
        user_id: &str,
        endpoint: &str,
        image_url: &str,
    ) -> Result<Option<Arc<Value>>> {
        self.inner.find_by_image_url(user_id, endpoint, image_url)
    }

    pub fn hydrate_from_payload(
        &self,
        user_id: &str,
        endpoint: &str,
        avatar: Value,
    ) -> Option<Arc<Value>> {
        self.inner.hydrate_from_payload(user_id, endpoint, avatar)
    }

    pub fn existing_summary_ids(&self, avatar_ids: &[String]) -> Result<Vec<String>> {
        self.inner.existing_summary_ids(avatar_ids)
    }

    pub fn store_summaries(
        &self,
        user_id: &str,
        endpoint: &str,
        entries: Vec<CacheEntityInput>,
    ) -> Result<u32> {
        self.inner.store_summaries(user_id, endpoint, entries)
    }

    pub async fn resolve(
        &self,
        web: &WebClient,
        user_id: &str,
        endpoint: &str,
        avatar_id: &str,
        full: bool,
        fresh: bool,
    ) -> Result<Option<Arc<Value>>> {
        self.inner
            .resolve(web, user_id, endpoint, avatar_id, full, fresh)
            .await
    }
}
