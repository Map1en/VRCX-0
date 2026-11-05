use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use vrcx_0_contracts::{VrchatResponse, WorldSummaryOutput};

use crate::Result;

#[async_trait]
pub trait WorldCachePort: Send + Sync {
    fn clear_working(&self);
    fn get_name(&self, world_id: &str) -> Option<String>;
    fn get_summary(&self, world_id: &str) -> Result<Option<WorldSummaryOutput>>;
    fn get_cached_card_payload(&self, world_id: &str) -> Option<Value>;
    fn search_summaries(&self, query: &str, limit: i64) -> Result<Vec<WorldSummaryOutput>>;
    fn hydrate_from_payload(&self, world_value: &Value) -> Option<String>;
    fn hydrate_summary_from_payload(&self, world_value: &Value) -> Option<WorldSummaryOutput>;
    fn store_from_payload(&self, world_value: &Value) -> Result<Option<String>>;
    fn hydrate_favorite_payloads(&self, world_values: &[Value]) -> Vec<Option<Value>>;
    async fn resolve_name(&self, endpoint: &str, world_id: &str) -> Option<String>;
    async fn resolve_summary(&self, endpoint: &str, world_id: &str) -> Option<WorldSummaryOutput>;
    async fn resolve_image_url(&self, endpoint: &str, world_id: &str) -> Option<String>;
    async fn get(
        &self,
        endpoint: &str,
        world_id: &str,
        force: bool,
        full: bool,
    ) -> Result<VrchatResponse>;
    fn hydrate_response(&self, response: &VrchatResponse);
}

pub struct WorldCache {
    inner: Arc<dyn WorldCachePort>,
}

impl WorldCache {
    pub fn new(inner: impl WorldCachePort + 'static) -> Self {
        Self {
            inner: Arc::new(inner),
        }
    }

    pub fn clear_working(&self) {
        self.inner.clear_working();
    }

    pub fn get_name(&self, world_id: &str) -> Option<String> {
        self.inner.get_name(world_id)
    }

    pub fn get_summary(&self, world_id: &str) -> Result<Option<WorldSummaryOutput>> {
        self.inner.get_summary(world_id)
    }

    pub fn get_cached_card_payload(&self, world_id: &str) -> Option<Value> {
        self.inner.get_cached_card_payload(world_id)
    }

    pub fn search_summaries(&self, query: &str, limit: i64) -> Result<Vec<WorldSummaryOutput>> {
        self.inner.search_summaries(query, limit)
    }

    pub fn hydrate_from_payload(&self, world_value: &Value) -> Option<String> {
        self.inner.hydrate_from_payload(world_value)
    }

    pub fn hydrate_summary_from_payload(&self, world_value: &Value) -> Option<WorldSummaryOutput> {
        self.inner.hydrate_summary_from_payload(world_value)
    }

    pub fn store_from_payload(&self, world_value: &Value) -> Result<Option<String>> {
        self.inner.store_from_payload(world_value)
    }

    pub fn hydrate_favorite_payloads<'a>(
        &self,
        world_values: impl IntoIterator<Item = &'a Value>,
    ) -> Vec<Option<Value>> {
        let world_values = world_values.into_iter().cloned().collect::<Vec<_>>();
        self.inner.hydrate_favorite_payloads(&world_values)
    }

    pub async fn resolve_name(&self, endpoint: &str, world_id: &str) -> Option<String> {
        self.inner.resolve_name(endpoint, world_id).await
    }

    pub async fn resolve_summary(
        &self,
        endpoint: &str,
        world_id: &str,
    ) -> Option<WorldSummaryOutput> {
        self.inner.resolve_summary(endpoint, world_id).await
    }

    pub async fn resolve_image_url(&self, endpoint: &str, world_id: &str) -> Option<String> {
        self.inner.resolve_image_url(endpoint, world_id).await
    }

    pub async fn get(
        &self,
        endpoint: &str,
        world_id: &str,
        force: bool,
        full: bool,
    ) -> Result<VrchatResponse> {
        self.inner.get(endpoint, world_id, force, full).await
    }

    pub fn hydrate_response(&self, response: &VrchatResponse) {
        self.inner.hydrate_response(response);
    }
}
