use std::sync::Arc;

use vrcx_0_application::social::{
    self as application, GroupApiDeps, GroupCalendarDeps, GroupCalendarInput,
    GroupCalendarSnapshot, GroupQuickModerationActionInput, GroupQuickModerationActionOutput,
    GroupQuickModerationDeps, GroupQuickModerationInput, GroupQuickModerationOutput,
    UserGroupsOverviewDeps, UserGroupsOverviewInput, UserGroupsOverviewOutput,
    VrchatGroupGalleryCreateInput, VrchatGroupGalleryDeleteInput, VrchatGroupGalleryEditInput,
    VrchatGroupGalleryImageAddInput, VrchatGroupGalleryImageDeleteInput, VrchatGroupGalleryInput,
    VrchatGroupIdInput, VrchatGroupJoinRequestRespondInput, VrchatGroupJoinRequestsInput,
    VrchatGroupLogsInput, VrchatGroupMemberPropsInput, VrchatGroupMemberRoleInput,
    VrchatGroupMembersInput, VrchatGroupMembersSearchInput, VrchatGroupMembershipListInput,
    VrchatGroupPagedInput, VrchatGroupPostCreateInput, VrchatGroupPostDeleteInput,
    VrchatGroupPostEditInput, VrchatGroupProfileInput, VrchatGroupRepresentationInput,
    VrchatGroupRoleCreateInput, VrchatGroupRoleInput, VrchatGroupRoleUpdateInput,
    VrchatGroupUpdateInput, VrchatGroupUserGroupsInput, VrchatGroupUserInput,
};
use vrcx_0_application_core::vrchat_api::VrchatApiResponse;
use vrcx_0_application_core::{
    RemoteMutationGate, RuntimeAuthScope, RuntimeDiagnostics, RuntimeSyncEngine, WebClient,
};

use crate::Result;

#[derive(Clone)]
pub struct DesktopGroupRuntime {
    web: Arc<WebClient>,
    diagnostics: RuntimeDiagnostics,
    sync: RuntimeSyncEngine,
    auth_scope: RuntimeAuthScope,
    remote_mutations: Arc<RemoteMutationGate>,
}

impl DesktopGroupRuntime {
    pub fn new(
        web: Arc<WebClient>,
        diagnostics: RuntimeDiagnostics,
        sync: RuntimeSyncEngine,
        auth_scope: RuntimeAuthScope,
        remote_mutations: Arc<RemoteMutationGate>,
    ) -> Self {
        Self {
            web,
            diagnostics,
            sync,
            auth_scope,
            remote_mutations,
        }
    }

    fn api_deps(&self) -> GroupApiDeps {
        GroupApiDeps::new(
            Arc::new(vrcx_0_outbound_adapters::VrchatRequestAdapter::new(
                Arc::clone(&self.web),
            )),
            Arc::new(vrcx_0_outbound_adapters::VrchatGroupRemoteRequests),
            self.diagnostics.clone(),
            self.sync.clone(),
            self.auth_scope.clone(),
            Arc::clone(&self.remote_mutations),
        )
    }

    fn moderation_deps(&self) -> GroupQuickModerationDeps {
        GroupQuickModerationDeps {
            groups: self.api_deps(),
            auth_scope: self.auth_scope.clone(),
            remote_requests: Arc::new(
                vrcx_0_outbound_adapters::VrchatGroupMembershipRemoteRequests,
            ),
        }
    }

    pub async fn calendar(&self, input: GroupCalendarInput) -> Result<GroupCalendarSnapshot> {
        Ok(application::load_group_calendar(
            GroupCalendarDeps::new(
                Arc::new(vrcx_0_outbound_adapters::VrchatGroupCalendarRemote::new(
                    Arc::clone(&self.web),
                )),
                self.auth_scope.clone(),
                self.diagnostics.clone(),
                self.sync.clone(),
            ),
            input,
        )
        .await?)
    }

    pub async fn quick_moderation(
        &self,
        input: GroupQuickModerationInput,
    ) -> Result<GroupQuickModerationOutput> {
        Ok(application::get_group_quick_moderation(self.moderation_deps(), input).await?)
    }

    pub async fn run_quick_moderation_action(
        &self,
        input: GroupQuickModerationActionInput,
    ) -> Result<GroupQuickModerationActionOutput> {
        Ok(application::run_group_quick_moderation_action(self.moderation_deps(), input).await?)
    }

    pub async fn user_groups_overview(
        &self,
        input: UserGroupsOverviewInput,
    ) -> Result<UserGroupsOverviewOutput> {
        Ok(application::get_user_groups_overview(
            UserGroupsOverviewDeps {
                groups: self.api_deps(),
                auth_scope: self.auth_scope.clone(),
                remote_requests: Arc::new(
                    vrcx_0_outbound_adapters::VrchatGroupMembershipRemoteRequests,
                ),
            },
            input,
        )
        .await?)
    }

    pub async fn get(&self, input: VrchatGroupProfileInput) -> Result<VrchatApiResponse> {
        Ok(application::get_group(self.api_deps(), input).await?)
    }

    pub async fn user_groups(
        &self,
        input: VrchatGroupUserGroupsInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::get_user_groups(self.api_deps(), input).await?)
    }

    pub async fn posts(&self, input: VrchatGroupPagedInput) -> Result<VrchatApiResponse> {
        Ok(application::get_posts(self.api_deps(), input).await?)
    }

    pub async fn member_role_ids(
        &self,
        input: VrchatGroupUserInput,
    ) -> Result<Option<Vec<String>>> {
        Ok(application::get_member_role_ids(self.api_deps(), input).await?)
    }

    pub async fn members(&self, input: VrchatGroupMembersInput) -> Result<VrchatApiResponse> {
        Ok(application::get_members(self.api_deps(), input).await?)
    }

    pub async fn search_members(
        &self,
        input: VrchatGroupMembersSearchInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::search_members(self.api_deps(), input).await?)
    }

    pub async fn gallery(&self, input: VrchatGroupGalleryInput) -> Result<VrchatApiResponse> {
        Ok(application::get_gallery(self.api_deps(), input).await?)
    }

    pub async fn bans(&self, input: VrchatGroupPagedInput) -> Result<VrchatApiResponse> {
        Ok(application::get_bans(self.api_deps(), input).await?)
    }

    pub async fn invites(&self, input: VrchatGroupPagedInput) -> Result<VrchatApiResponse> {
        Ok(application::get_invites(self.api_deps(), input).await?)
    }

    pub async fn join_requests(
        &self,
        input: VrchatGroupJoinRequestsInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::get_join_requests(self.api_deps(), input).await?)
    }

    pub async fn audit_log_types(&self, input: VrchatGroupIdInput) -> Result<VrchatApiResponse> {
        Ok(application::get_audit_log_types(self.api_deps(), input).await?)
    }

    pub async fn logs(&self, input: VrchatGroupLogsInput) -> Result<VrchatApiResponse> {
        Ok(application::get_logs(self.api_deps(), input).await?)
    }

    pub async fn user_instances(
        &self,
        input: VrchatGroupUserGroupsInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::get_user_instances(self.api_deps(), input).await?)
    }

    pub async fn update(&self, input: VrchatGroupUpdateInput) -> Result<VrchatApiResponse> {
        Ok(application::update_group(self.api_deps(), input).await?)
    }

    pub async fn delete(&self, input: VrchatGroupIdInput) -> Result<VrchatApiResponse> {
        Ok(application::delete_group(self.api_deps(), input).await?)
    }

    pub async fn create_gallery(
        &self,
        input: VrchatGroupGalleryCreateInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::create_gallery(self.api_deps(), input).await?)
    }

    pub async fn edit_gallery(
        &self,
        input: VrchatGroupGalleryEditInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::edit_gallery(self.api_deps(), input).await?)
    }

    pub async fn delete_gallery(
        &self,
        input: VrchatGroupGalleryDeleteInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::delete_gallery(self.api_deps(), input).await?)
    }

    pub async fn add_gallery_image(
        &self,
        input: VrchatGroupGalleryImageAddInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::add_gallery_image(self.api_deps(), input).await?)
    }

    pub async fn delete_gallery_image(
        &self,
        input: VrchatGroupGalleryImageDeleteInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::delete_gallery_image(self.api_deps(), input).await?)
    }

    pub async fn create_post(
        &self,
        input: VrchatGroupPostCreateInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::create_post(self.api_deps(), input).await?)
    }

    pub async fn edit_post(&self, input: VrchatGroupPostEditInput) -> Result<VrchatApiResponse> {
        Ok(application::edit_post(self.api_deps(), input).await?)
    }

    pub async fn delete_post(
        &self,
        input: VrchatGroupPostDeleteInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::delete_post(self.api_deps(), input).await?)
    }

    pub async fn join(&self, input: VrchatGroupIdInput) -> Result<VrchatApiResponse> {
        Ok(application::join_group(self.api_deps(), input).await?)
    }

    pub async fn leave(&self, input: VrchatGroupIdInput) -> Result<VrchatApiResponse> {
        Ok(application::leave_group(self.api_deps(), input).await?)
    }

    pub async fn cancel_request(&self, input: VrchatGroupIdInput) -> Result<VrchatApiResponse> {
        Ok(application::cancel_request(self.api_deps(), input).await?)
    }

    pub async fn send_invite(&self, input: VrchatGroupUserInput) -> Result<VrchatApiResponse> {
        Ok(application::send_invite(self.api_deps(), input).await?)
    }

    pub async fn kick_member(&self, input: VrchatGroupUserInput) -> Result<VrchatApiResponse> {
        Ok(application::kick_member(self.api_deps(), input).await?)
    }

    pub async fn ban_member(&self, input: VrchatGroupUserInput) -> Result<VrchatApiResponse> {
        Ok(application::ban_member(self.api_deps(), input).await?)
    }

    pub async fn unban_member(&self, input: VrchatGroupUserInput) -> Result<VrchatApiResponse> {
        Ok(application::unban_member(self.api_deps(), input).await?)
    }

    pub async fn add_member_role(
        &self,
        input: VrchatGroupMemberRoleInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::add_member_role(self.api_deps(), input).await?)
    }

    pub async fn remove_member_role(
        &self,
        input: VrchatGroupMemberRoleInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::remove_member_role(self.api_deps(), input).await?)
    }

    pub async fn delete_invite(&self, input: VrchatGroupUserInput) -> Result<VrchatApiResponse> {
        Ok(application::delete_invite(self.api_deps(), input).await?)
    }

    pub async fn respond_join_request(
        &self,
        input: VrchatGroupJoinRequestRespondInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::respond_join_request(self.api_deps(), input).await?)
    }

    pub async fn set_representation(
        &self,
        input: VrchatGroupRepresentationInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::set_representation(self.api_deps(), input).await?)
    }

    pub async fn set_member_props(
        &self,
        input: VrchatGroupMemberPropsInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::set_member_props(self.api_deps(), input).await?)
    }

    pub async fn block(&self, input: VrchatGroupIdInput) -> Result<VrchatApiResponse> {
        Ok(application::block_group(self.api_deps(), input).await?)
    }

    pub async fn unblock(&self, input: VrchatGroupUserInput) -> Result<VrchatApiResponse> {
        Ok(application::unblock_group(self.api_deps(), input).await?)
    }

    pub async fn membership_list(
        &self,
        input: VrchatGroupMembershipListInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::get_membership_list(self.api_deps(), input).await?)
    }

    pub async fn decline_invite(&self, input: VrchatGroupUserInput) -> Result<VrchatApiResponse> {
        Ok(application::decline_invite(self.api_deps(), input).await?)
    }

    pub async fn roles(&self, input: VrchatGroupIdInput) -> Result<VrchatApiResponse> {
        Ok(application::get_roles(self.api_deps(), input).await?)
    }

    pub async fn permissions(&self, input: VrchatGroupIdInput) -> Result<VrchatApiResponse> {
        Ok(application::get_permissions(self.api_deps(), input).await?)
    }

    pub async fn create_role(
        &self,
        input: VrchatGroupRoleCreateInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::create_role(self.api_deps(), input).await?)
    }

    pub async fn update_role(
        &self,
        input: VrchatGroupRoleUpdateInput,
    ) -> Result<VrchatApiResponse> {
        Ok(application::update_role(self.api_deps(), input).await?)
    }

    pub async fn delete_role(&self, input: VrchatGroupRoleInput) -> Result<VrchatApiResponse> {
        Ok(application::delete_role(self.api_deps(), input).await?)
    }
}
