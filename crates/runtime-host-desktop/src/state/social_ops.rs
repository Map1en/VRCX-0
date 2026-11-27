use vrcx_0_application_core::RuntimeOperationStatus;

use vrcx_0_application::social::{GroupBanImportStartInput, GroupBanImportStatus};
use vrcx_0_composition::Result;

use super::DesktopRuntimeHostState;

impl DesktopRuntimeHostState {
    pub async fn get_user_via_cache(
        &self,
        user_id: String,
        force: bool,
        dialog: bool,
        is_friend: Option<bool>,
    ) -> Result<vrcx_0_contracts::vrchat_api::VrchatResponse> {
        let command = "app__vrchat_user_get";
        let diagnostics = self.runtime.desktop_assembly().diagnostics();
        diagnostics.record_command(
            command,
            RuntimeOperationStatus::Running,
            format!("Getting user {user_id}."),
        );
        let result = self
            .runtime
            .realtime_runtime()
            .get_user_via_cache(
                vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT.into(),
                user_id,
                force,
                dialog,
                is_friend,
            )
            .await;
        match &result {
            Ok(response) => diagnostics.record_command(
                command,
                RuntimeOperationStatus::Ok,
                format!("status={}", response.status),
            ),
            Err(error) => diagnostics.record_command(
                command,
                RuntimeOperationStatus::Error,
                error.to_string(),
            ),
        }
        Ok(result?)
    }

    pub fn group_ban_import_start(
        &self,
        input: GroupBanImportStartInput,
    ) -> Result<GroupBanImportStatus> {
        Ok(self.runtime.group_ban_import().start(input)?)
    }

    pub fn group_ban_import_status(&self) -> GroupBanImportStatus {
        self.runtime.group_ban_import().status()
    }

    pub fn group_ban_import_cancel(&self) -> GroupBanImportStatus {
        self.runtime.group_ban_import().cancel()
    }

    pub async fn quick_search(
        &self,
        input: vrcx_0_application::social::QuickSearchQueryInput,
    ) -> Result<vrcx_0_application::social::QuickSearchQueryOutput> {
        Ok(self
            .quick_search
            .query(input, self.friend_snapshot())
            .await?)
    }

    pub fn invalidate_quick_search_working_set(&self) {
        self.quick_search.invalidate_remote_working_set();
    }

    pub async fn resolve_friend_log_names(
        &self,
        input: vrcx_0_application::social::FriendLogNameResolutionInput,
    ) -> Result<Vec<vrcx_0_application::social::ResolvedFriendLogName>> {
        Ok(vrcx_0_application::social::resolve_friend_log_names(
            &self.friend_log_name_resolutions,
            vrcx_0_application::social::FriendLogNameResolutionDeps::new(
                &self.friend_log_name_store,
                self.runtime.desktop_assembly().auth_scope(),
                self.runtime.realtime_runtime(),
            ),
            input,
        )
        .await?)
    }

    pub fn cancel_friend_log_name_resolution(&self, request_id: &str) -> bool {
        self.friend_log_name_resolutions.cancel(request_id)
    }

    pub async fn run_avatar_content_tags_batch(
        &self,
        input: vrcx_0_application::social::AvatarContentTagsBatchInput,
    ) -> Result<vrcx_0_application::social::BatchMutationResult> {
        let mutation = vrcx_0_application_core::AuthenticatedMutationContext::capture(
            self.runtime.desktop_assembly().auth_scope(),
            self.runtime.desktop_assembly().remote_mutations(),
            "Batch mutation",
        )?;
        Ok(vrcx_0_application::social::run_avatar_content_tags_batch(
            &vrcx_0_application::social::VrchatBatchMutationActions::new(
                &self.vrchat_requests,
                mutation,
            ),
            input,
        )
        .await?)
    }

    pub async fn run_group_membership_batch(
        &self,
        input: vrcx_0_application::social::GroupMembershipBatchInput,
    ) -> Result<vrcx_0_application::social::GroupMembershipBatchResult> {
        let mutation = vrcx_0_application_core::AuthenticatedMutationContext::capture(
            self.runtime.desktop_assembly().auth_scope(),
            self.runtime.desktop_assembly().remote_mutations(),
            "Group membership batch",
        )?;
        Ok(vrcx_0_application::social::run_group_membership_batch(
            &self.group_membership_batches,
            &vrcx_0_application::social::VrchatGroupMembershipBatchActions::new(
                &self.vrchat_requests,
                mutation,
                self.runtime.desktop_assembly().event_bus().clone(),
            ),
            input,
        )
        .await?)
    }

    pub async fn run_group_moderation_batch(
        &self,
        input: vrcx_0_application::social::GroupModerationBatchInput,
    ) -> Result<vrcx_0_application::social::GroupModerationBatchResult> {
        let mutation = vrcx_0_application_core::AuthenticatedMutationContext::capture(
            self.runtime.desktop_assembly().auth_scope(),
            self.runtime.desktop_assembly().remote_mutations(),
            "Group moderation batch",
        )?;
        Ok(vrcx_0_application::social::run_group_moderation_batch(
            &self.group_moderation_batches,
            &vrcx_0_application::social::VrchatGroupModerationBatchActions::new(
                &self.vrchat_requests,
                mutation,
                self.runtime.desktop_assembly().event_bus().clone(),
            ),
            input,
        )
        .await?)
    }

    pub async fn send_instance_invites_batch(
        &self,
        input: vrcx_0_application::social::InstanceInviteBatchInput,
    ) -> Result<vrcx_0_application::social::InstanceInviteBatchResult> {
        let mutation = vrcx_0_application_core::AuthenticatedMutationContext::capture(
            self.runtime.desktop_assembly().auth_scope(),
            self.runtime.desktop_assembly().remote_mutations(),
            "Batch action",
        )?;
        Ok(vrcx_0_application::social::send_instance_invites_batch(
            &vrcx_0_application::social::VrchatInstanceInviteBatchActions::new(
                &self.vrchat_requests,
                mutation,
                &self.world_names,
            ),
            input,
        )
        .await?)
    }

    pub async fn user_dialog_tab_counts(
        &self,
        input: vrcx_0_application::social::UserDialogTabCountsInput,
    ) -> Result<vrcx_0_application::social::UserDialogTabCountsOutput> {
        Ok(vrcx_0_application::social::get_user_dialog_tab_counts(
            &self.user_dialog_tab_counts,
            vrcx_0_application::social::UserDialogTabCountsDeps::new(
                self.user_dialog_tab_counts_source.clone(),
                self.runtime.desktop_assembly().auth_scope().clone(),
            ),
            input,
        )
        .await?)
    }

    pub async fn translate_dispatch(
        &self,
        input: vrcx_0_application::discovery::TranslationTranslateInput,
    ) -> Result<vrcx_0_application::discovery::TranslationDispatch> {
        let config = self.runtime.desktop_assembly().config_store();
        Ok(vrcx_0_application::discovery::translate_text(
            vrcx_0_application::discovery::TranslationDeps {
                config: config.as_ref(),
                standard_translation: &self.translation,
            },
            input,
        )
        .await?)
    }

    pub(crate) fn mutual_graph_fetch_status(
        &self,
    ) -> vrcx_0_application::social::MutualGraphFetchStatus {
        self.runtime
            .desktop_assembly()
            .mutual_graph_fetch()
            .status()
    }
}
