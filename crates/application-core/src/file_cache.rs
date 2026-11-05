use std::sync::Arc;

use async_trait::async_trait;
use vrcx_0_contracts::FileMetadataOutput;

#[async_trait]
pub trait FileCachePort: Send + Sync {
    async fn resolve(&self, endpoint: &str, file_id: &str) -> Option<FileMetadataOutput>;
}

#[derive(Clone)]
pub struct FileCache {
    inner: Arc<dyn FileCachePort>,
}

impl FileCache {
    pub fn new(inner: impl FileCachePort + 'static) -> Self {
        Self {
            inner: Arc::new(inner),
        }
    }

    pub async fn resolve(&self, endpoint: &str, file_id: &str) -> Option<FileMetadataOutput> {
        self.inner.resolve(endpoint, file_id).await
    }
}
