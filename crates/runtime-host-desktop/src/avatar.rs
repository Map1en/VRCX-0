use std::sync::Arc;

use crate::Result;
use serde_json::Value;
use vrcx_0_application::avatars::{
    self as application, AvatarModerationDeps, AvatarModerationRuntime, AvatarRemote,
    AvatarRemoteMutation, AvatarRemoteMutationDeps, AvatarSelectionMutationOutcome,
    MyAvatarByIdInput, MyAvatarsDeps, MyAvatarsInput,
};
use vrcx_0_application::remote::AvatarUpdateRequest;
use vrcx_0_application_core::vrchat_api::VrchatApiResponse;
use vrcx_0_application_core::{
    AuthenticatedMutationContext, AvatarCache, RemoteMutationGate, RuntimeAuthScope,
    RuntimeDiagnostics, RuntimeSyncEngine, WebClient,
};
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_persistence::DatabaseService;

#[derive(Clone)]
pub struct DesktopAvatarRuntime {
    application_adapter: vrcx_0_outbound_adapters::LocalAvatarApplicationAdapter,
    remote: Arc<dyn AvatarRemote>,
    realtime: Arc<RealtimeHostRuntime>,
    avatar_cache: Arc<AvatarCache>,
    avatar_moderation: AvatarModerationRuntime,
    auth_scope: RuntimeAuthScope,
    remote_mutations: Arc<RemoteMutationGate>,
}

impl DesktopAvatarRuntime {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        db: Arc<DatabaseService>,
        web: Arc<WebClient>,
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
        realtime: Arc<RealtimeHostRuntime>,
        avatar_cache: Arc<AvatarCache>,
        avatar_moderation: AvatarModerationRuntime,
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
    ) -> Self {
        let application_adapter =
            vrcx_0_outbound_adapters::LocalAvatarApplicationAdapter::new(Arc::clone(&db));
        let remote = Arc::new(vrcx_0_outbound_adapters::VrchatAvatarRemote::new(
            web,
            diagnostics,
            sync,
        ));
        Self {
            application_adapter,
            remote,
            realtime,
            avatar_cache,
            avatar_moderation,
            auth_scope,
            remote_mutations,
        }
    }

    fn mutation_deps(&self) -> Result<AvatarRemoteMutationDeps<'_>> {
        Ok(AvatarRemoteMutationDeps::new(
            &self.application_adapter,
            self.remote.as_ref(),
            &self.realtime,
            &self.avatar_cache,
            &self.avatar_moderation,
            AuthenticatedMutationContext::capture(
                &self.auth_scope,
                &self.remote_mutations,
                "Avatar mutation",
            )?,
        ))
    }

    pub async fn moderations(&self) -> Result<VrchatApiResponse> {
        Ok(application::get_avatar_moderations(
            &self.avatar_moderation,
            AvatarModerationDeps::new(self.remote.as_ref(), &self.auth_scope),
            "app__vrchat_avatar_moderations_get",
            "Getting avatar moderations.",
        )
        .await?)
    }

    pub async fn select(&self, avatar_id: String) -> Result<AvatarSelectionMutationOutcome> {
        let deps = self.mutation_deps()?;
        let avatar_id = avatar_id.trim().to_string();
        Ok(application::select_avatar(
            &deps,
            "app__vrchat_avatar_select",
            format!("Selecting avatar {avatar_id}."),
            AvatarRemoteMutation::Select {
                avatar_id,
                fallback: false,
            },
        )
        .await?)
    }

    pub async fn select_fallback(
        &self,
        avatar_id: String,
    ) -> Result<AvatarSelectionMutationOutcome> {
        let deps = self.mutation_deps()?;
        let avatar_id = avatar_id.trim().to_string();
        Ok(application::select_avatar(
            &deps,
            "app__vrchat_avatar_select_fallback",
            format!("Selecting fallback avatar {avatar_id}."),
            AvatarRemoteMutation::Select {
                avatar_id,
                fallback: true,
            },
        )
        .await?)
    }

    pub async fn save(
        &self,
        avatar_id: String,
        params: AvatarUpdateRequest,
    ) -> Result<VrchatApiResponse> {
        let deps = self.mutation_deps()?;
        let avatar_id = avatar_id.trim().to_string();
        Ok(application::save_avatar(
            &deps,
            "app__vrchat_avatar_save",
            format!("Saving avatar {avatar_id}."),
            AvatarRemoteMutation::Save { avatar_id, params },
        )
        .await?)
    }

    pub async fn delete(&self, avatar_id: String) -> Result<VrchatApiResponse> {
        let deps = self.mutation_deps()?;
        let avatar_id = avatar_id.trim().to_string();
        Ok(application::delete_avatar(
            &deps,
            avatar_id.clone(),
            "app__vrchat_avatar_delete",
            format!("Deleting avatar {avatar_id}."),
            AvatarRemoteMutation::Delete {
                avatar_id: avatar_id.clone(),
            },
        )
        .await?)
    }

    pub async fn create_impostor(&self, avatar_id: String) -> Result<VrchatApiResponse> {
        let deps = self.mutation_deps()?;
        let avatar_id = avatar_id.trim().to_string();
        Ok(application::execute_avatar_remote_mutation(
            &deps,
            "app__vrchat_avatar_impostor_create",
            format!("Creating avatar impostor for {avatar_id}."),
            AvatarRemoteMutation::CreateImpostor { avatar_id },
        )
        .await?)
    }

    pub async fn delete_impostor(&self, avatar_id: String) -> Result<VrchatApiResponse> {
        let deps = self.mutation_deps()?;
        let avatar_id = avatar_id.trim().to_string();
        Ok(application::execute_avatar_remote_mutation(
            &deps,
            "app__vrchat_avatar_impostor_delete",
            format!("Deleting avatar impostor for {avatar_id}."),
            AvatarRemoteMutation::DeleteImpostor { avatar_id },
        )
        .await?)
    }

    pub async fn send_moderation(&self, avatar_id: String) -> Result<VrchatApiResponse> {
        let deps = self.mutation_deps()?;
        let avatar_id = avatar_id.trim().to_string();
        Ok(application::execute_avatar_moderation_mutation(
            &deps,
            "app__vrchat_avatar_moderation_send",
            format!("Sending avatar moderation block for {avatar_id}."),
            AvatarRemoteMutation::SendModeration { avatar_id },
        )
        .await?)
    }

    pub async fn delete_moderation(&self, avatar_id: String) -> Result<VrchatApiResponse> {
        let deps = self.mutation_deps()?;
        let avatar_id = avatar_id.trim().to_string();
        Ok(application::execute_avatar_moderation_mutation(
            &deps,
            "app__vrchat_avatar_moderation_delete",
            format!("Deleting avatar moderation block for {avatar_id}."),
            AvatarRemoteMutation::DeleteModeration { avatar_id },
        )
        .await?)
    }

    fn my_avatars_deps(&self) -> Result<MyAvatarsDeps<'_>> {
        let expected_scope = self.auth_scope.snapshot();
        if !expected_scope.active || expected_scope.current_user_id.trim().is_empty() {
            return Err(vrcx_0_application_core::Error::Custom(
                "My avatars query requires an authenticated session.".into(),
            )
            .into());
        }
        Ok(MyAvatarsDeps::new(
            &self.application_adapter,
            self.remote.as_ref(),
            &self.auth_scope,
            expected_scope,
        ))
    }

    pub async fn my_avatars(&self, input: MyAvatarsInput) -> Result<Vec<Value>> {
        Ok(application::get_my_avatars(&self.my_avatars_deps()?, input).await?)
    }

    pub async fn my_avatar_by_id(&self, input: MyAvatarByIdInput) -> Result<Option<Value>> {
        Ok(application::get_my_avatar_by_id(&self.my_avatars_deps()?, input).await?)
    }
}
