use vrcx_0_application::social::{
    ban_member, GroupApiDeps, GroupBanImportActions, GroupBanImportFuture, VrchatGroupUserInput,
};
use vrcx_0_application_core::Error;
use vrcx_0_contracts::vrchat_api::VrchatJsonResponse;

pub struct LocalGroupBanImportActions {
    pub deps: GroupApiDeps,
}

impl GroupBanImportActions for LocalGroupBanImportActions {
    fn ban_user<'a>(&'a self, group_id: &'a str, user_id: &'a str) -> GroupBanImportFuture<'a> {
        Box::pin(async move {
            let response = ban_member(
                self.deps.clone(),
                VrchatGroupUserInput {
                    group_id: group_id.to_string(),
                    user_id: user_id.to_string(),
                },
            )
            .await?;
            let response = VrchatJsonResponse::parse(response.status, &response.data);
            if response.is_failure() {
                return Err(Error::Custom(
                    response.error_message_or("VRChat group request failed"),
                ));
            }
            Ok(())
        })
    }
}
