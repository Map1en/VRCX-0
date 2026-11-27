mod auth;
mod avatars;
mod economy;
mod favorites;
mod instances;
mod media;
mod notifications;
mod search;
mod tools;
mod users;

use std::sync::Arc;

use vrcx_0_application_core::{Result, RuntimeAuthScope};
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_contracts::vrchat_api::{VrchatRequest, VrchatResponse, VrchatScope};

pub use avatars::AvatarListByUserQuery;

use super::VrchatApiRuntime;
use crate::media::MediaUploadPreprocessor;
use crate::social::{PrintFavoritesStore, ProfileBioStore};

#[derive(Clone)]
pub struct VrchatRemoteFacade {
    api: VrchatApiRuntime,
    media_upload: Arc<dyn MediaUploadPreprocessor>,
    prints: Arc<dyn PrintFavoritesStore>,
    profile_bio: Arc<dyn ProfileBioStore>,
    realtime: Arc<RealtimeHostRuntime>,
    auth_scope: RuntimeAuthScope,
}

impl VrchatRemoteFacade {
    pub fn new(
        api: VrchatApiRuntime,
        media_upload: Arc<dyn MediaUploadPreprocessor>,
        prints: Arc<dyn PrintFavoritesStore>,
        profile_bio: Arc<dyn ProfileBioStore>,
        realtime: Arc<RealtimeHostRuntime>,
        auth_scope: RuntimeAuthScope,
    ) -> Self {
        Self {
            api,
            media_upload,
            prints,
            profile_bio,
            realtime,
            auth_scope,
        }
    }

    async fn execute(
        &self,
        command: &str,
        detail: impl Into<String>,
        request: VrchatRequest,
        scope: VrchatScope,
    ) -> Result<VrchatResponse> {
        self.api.execute(command, detail, request, scope).await
    }
}
