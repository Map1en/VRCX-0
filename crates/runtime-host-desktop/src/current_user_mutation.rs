use std::sync::Arc;

use vrcx_0_application::social::{
    ContentFilter as ApplicationContentFilter, CurrentUserMutationFuture, CurrentUserMutationPort,
    CurrentUserMutationRequest, CurrentUserMutationRuntime,
    CurrentUserProfileUpdateRequest as ApplicationProfileUpdateRequest,
    CurrentUserQueryInvalidationFuture, CurrentUserUpdateRequest as ApplicationUserUpdateRequest,
    ProfileBackgroundType as ApplicationBackgroundType, ProfileBannerType as ApplicationBannerType,
};
use vrcx_0_application_core::vrchat_api::{execute_api_command, VrchatScope};
use vrcx_0_application_core::{
    RemoteMutationGate, RuntimeAuthScope, RuntimeAuthScopeSnapshot, RuntimeDiagnostics,
    RuntimeSyncEngine, WebClient,
};
use vrcx_0_application_realtime::RealtimeHostRuntime;
use vrcx_0_vrchat_client::users::{
    current_user_badge_update_input, current_user_tags_add_input, current_user_tags_remove_input,
    current_user_update_input, profile_update_input, ContentFilter as ProtocolContentFilter,
    CurrentUserProfileUpdateRequest as ProtocolProfileUpdateRequest,
    CurrentUserUpdateRequest as ProtocolUserUpdateRequest,
    ProfileBackgroundType as ProtocolBackgroundType, ProfileBannerType as ProtocolBannerType,
};

pub(crate) struct CurrentUserMutationRuntimeDeps {
    pub auth_scope: RuntimeAuthScope,
    pub remote_mutations: Arc<RemoteMutationGate>,
    pub web: Arc<WebClient>,
    pub diagnostics: RuntimeDiagnostics,
    pub sync: RuntimeSyncEngine,
    pub realtime_runtime: Arc<RealtimeHostRuntime>,
}

pub(crate) fn build_current_user_mutation_runtime(
    deps: CurrentUserMutationRuntimeDeps,
) -> CurrentUserMutationRuntime {
    CurrentUserMutationRuntime::new(
        deps.auth_scope,
        deps.remote_mutations,
        Arc::new(DesktopCurrentUserMutationPort {
            web: deps.web,
            diagnostics: deps.diagnostics,
            sync: deps.sync,
            realtime_runtime: deps.realtime_runtime,
        }),
    )
}

struct DesktopCurrentUserMutationPort {
    web: Arc<WebClient>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
    realtime_runtime: Arc<RealtimeHostRuntime>,
}

impl CurrentUserMutationPort for DesktopCurrentUserMutationPort {
    fn execute<'a>(
        &'a self,
        scope: RuntimeAuthScopeSnapshot,
        request: CurrentUserMutationRequest,
    ) -> CurrentUserMutationFuture<'a> {
        Box::pin(async move {
            let (command, detail, request) = match request {
                CurrentUserMutationRequest::Profile(params) => {
                    let (user_id, request) = profile_update_input(
                        scope.endpoint,
                        scope.current_user_id,
                        profile_update_request(params),
                    )?;
                    (
                        "app__vrchat_current_user_profile_update",
                        format!("Updating profile for current user {user_id}."),
                        request,
                    )
                }
                CurrentUserMutationRequest::User(params) => {
                    let (user_id, request) = current_user_update_input(
                        scope.endpoint,
                        scope.current_user_id,
                        user_update_request(params),
                    )?;
                    (
                        "app__vrchat_current_user_update",
                        format!("Updating current user {user_id}."),
                        request,
                    )
                }
                CurrentUserMutationRequest::Badge {
                    badge_id,
                    hidden,
                    showcased,
                } => {
                    let (user_id, badge_id, request) = current_user_badge_update_input(
                        scope.endpoint,
                        scope.current_user_id,
                        badge_id,
                        hidden,
                        showcased,
                    )?;
                    (
                        "app__vrchat_current_user_badge_update",
                        format!("Updating badge {badge_id} for current user {user_id}."),
                        request,
                    )
                }
                CurrentUserMutationRequest::AddTags(tags) => {
                    let (user_id, request) =
                        current_user_tags_add_input(scope.endpoint, scope.current_user_id, tags)?;
                    (
                        "app__vrchat_current_user_tags_add",
                        format!("Adding tags to current user {user_id}."),
                        request,
                    )
                }
                CurrentUserMutationRequest::RemoveTags(tags) => {
                    let (user_id, request) = current_user_tags_remove_input(
                        scope.endpoint,
                        scope.current_user_id,
                        tags,
                    )?;
                    (
                        "app__vrchat_current_user_tags_remove",
                        format!("Removing tags from current user {user_id}."),
                        request,
                    )
                }
            };
            execute_api_command(
                &self.web,
                &self.diagnostics,
                &self.sync,
                (command, detail),
                request,
                VrchatScope::Vrchat,
            )
            .await
        })
    }

    fn invalidate_user_query<'a>(
        &'a self,
        scope: RuntimeAuthScopeSnapshot,
    ) -> CurrentUserQueryInvalidationFuture<'a> {
        Box::pin(async move {
            self.realtime_runtime
                .invalidate_user_query_cache(&scope.endpoint, &scope.current_user_id)
                .await;
        })
    }
}

fn profile_update_request(
    request: ApplicationProfileUpdateRequest,
) -> ProtocolProfileUpdateRequest {
    ProtocolProfileUpdateRequest {
        bio: request.bio,
        bio_links: request.bio_links,
        user_icon: request.user_icon,
        banner_type: request.banner_type.map(banner_type),
        banner_custom_url: request.banner_custom_url,
        background_type: request.background_type.map(background_type),
        background_gradient_bottom: request.background_gradient_bottom,
        background_gradient_top: request.background_gradient_top,
        background_texture_id: request.background_texture_id,
    }
}

fn user_update_request(request: ApplicationUserUpdateRequest) -> ProtocolUserUpdateRequest {
    ProtocolUserUpdateRequest {
        home_location: request.home_location,
        status: request.status,
        status_description: request.status_description,
        pronouns: request.pronouns,
        allow_avatar_copying: request.allow_avatar_copying,
        is_booping_enabled: request.is_booping_enabled,
        has_shared_connections_opt_out: request.has_shared_connections_opt_out,
        has_discord_friends_opt_out: request.has_discord_friends_opt_out,
        content_filters: request
            .content_filters
            .map(|filters| filters.into_iter().map(content_filter).collect()),
    }
}

fn banner_type(banner_type: ApplicationBannerType) -> ProtocolBannerType {
    match banner_type {
        ApplicationBannerType::AvatarBanner => ProtocolBannerType::AvatarBanner,
        ApplicationBannerType::CustomImage => ProtocolBannerType::CustomImage,
    }
}

fn background_type(background_type: ApplicationBackgroundType) -> ProtocolBackgroundType {
    match background_type {
        ApplicationBackgroundType::Default => ProtocolBackgroundType::Default,
        ApplicationBackgroundType::Gradient => ProtocolBackgroundType::Gradient,
        ApplicationBackgroundType::Texture => ProtocolBackgroundType::Texture,
    }
}

fn content_filter(filter: ApplicationContentFilter) -> ProtocolContentFilter {
    match filter {
        ApplicationContentFilter::Adult => ProtocolContentFilter::Adult,
        ApplicationContentFilter::Gore => ProtocolContentFilter::Gore,
        ApplicationContentFilter::Horror => ProtocolContentFilter::Horror,
        ApplicationContentFilter::Sex => ProtocolContentFilter::Sex,
        ApplicationContentFilter::Violence => ProtocolContentFilter::Violence,
    }
}
