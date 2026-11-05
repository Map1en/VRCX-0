use futures_util::future::BoxFuture;

use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::VrchatRequest;
use vrcx_0_core::json::RawJson;

pub trait MediaUploadPreprocessor: Send + Sync {
    fn prepare(&self, input: VrchatRequest) -> Result<VrchatRequest>;
}

#[derive(Clone, Debug)]
pub struct LegacyMediaUploadRequest {
    pub endpoint: String,
    pub entity_id: String,
    pub source_file_id: String,
    pub base64_file: String,
    pub file_size_in_bytes: Option<i64>,
    pub kind: LegacyEntityImageKind,
}

#[derive(Clone, Debug)]
pub struct LegacyMediaUploadResult {
    pub entity: RawJson,
    pub image_url: String,
    pub file_id: String,
    pub file_version: i64,
}

pub type LegacyMediaUploadFuture<'a> = BoxFuture<'a, Result<LegacyMediaUploadResult>>;

pub type LegacyMediaUploadGateFuture<'a> = BoxFuture<'a, Result<()>>;

pub trait LegacyMediaUploadGate: Send + Sync {
    fn before_request(&self) -> LegacyMediaUploadGateFuture<'_>;
    fn after_request(&self) -> Result<()>;
}

pub trait LegacyMediaUploadPort: Send + Sync {
    fn upload<'a>(
        &'a self,
        request: LegacyMediaUploadRequest,
        gate: &'a dyn LegacyMediaUploadGate,
    ) -> LegacyMediaUploadFuture<'a>;
}

pub struct LegacyMediaUploadDeps<'a> {
    pub(crate) port: &'a dyn LegacyMediaUploadPort,
    pub mutation: vrcx_0_application_core::AuthenticatedMutationContext<'a>,
}

impl<'a> LegacyMediaUploadDeps<'a> {
    pub fn new(
        port: &'a dyn LegacyMediaUploadPort,
        mutation: vrcx_0_application_core::AuthenticatedMutationContext<'a>,
    ) -> Self {
        Self { port, mutation }
    }
}

pub struct LegacyEntityImageUploadInput {
    pub entity_id: String,
    pub image_url: String,
    pub base64_file: String,
    pub file_size_in_bytes: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LegacyEntityImageKind {
    Avatar,
    World,
}

impl LegacyEntityImageKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Avatar => "Avatar",
            Self::World => "World",
        }
    }
}
