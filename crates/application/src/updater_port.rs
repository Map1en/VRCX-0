use std::any::Any;
use std::fmt;
use std::sync::Arc;

use async_trait::async_trait;
use serde::Serialize;

use crate::{Error, Result};

#[derive(Clone, Debug, Default)]
pub struct UpdaterCheckRequest {
    pub manifest_url: String,
    pub target: String,
    pub allow_downgrades: bool,
    pub proxy: Option<String>,
}

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdaterMetadata {
    pub current_version: String,
    pub version: String,
    pub date: Option<String>,
    pub body: Option<String>,
}

pub struct UpdaterInstallHandle(pub Box<dyn Any + Send + Sync>);

impl fmt::Debug for UpdaterInstallHandle {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("UpdaterInstallHandle(..)")
    }
}

pub struct UpdaterDownloadOutcome {
    pub metadata: UpdaterMetadata,
    pub handle: UpdaterInstallHandle,
}

#[derive(Clone, Copy, Debug)]
pub enum UpdaterDownloadProgress {
    Started { content_length: Option<u64> },
    Progress { chunk_length: usize },
    Finished,
}

pub type UpdaterProgressCallback = Arc<dyn Fn(UpdaterDownloadProgress) + Send + Sync>;

#[async_trait]
pub trait UpdaterPort: Send + Sync {
    async fn check(&self, request: UpdaterCheckRequest) -> Result<Option<UpdaterMetadata>>;
    async fn download(
        &self,
        request: UpdaterCheckRequest,
        on_progress: UpdaterProgressCallback,
    ) -> Result<UpdaterDownloadOutcome>;
    async fn install(&self, handle: UpdaterInstallHandle) -> Result<()>;
}

pub struct NoopUpdaterPort;

#[async_trait]
impl UpdaterPort for NoopUpdaterPort {
    async fn check(&self, _request: UpdaterCheckRequest) -> Result<Option<UpdaterMetadata>> {
        Ok(None)
    }

    async fn download(
        &self,
        _request: UpdaterCheckRequest,
        _on_progress: UpdaterProgressCallback,
    ) -> Result<UpdaterDownloadOutcome> {
        Err(Error::Custom(
            "Update downloads are not supported in this runtime.".into(),
        ))
    }

    async fn install(&self, _handle: UpdaterInstallHandle) -> Result<()> {
        Err(Error::Custom(
            "Update installs are not supported in this runtime.".into(),
        ))
    }
}
