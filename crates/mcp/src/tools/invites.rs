use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::Deserialize;
use vrcx_0_persistence::social_aggregates;

use crate::server::VrcxMcpServer;

use super::common::{require_current_user_id, social_aggregates_result, TimeWindowParams};

#[tool_router(router = invites_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(description = "Return invite and request-invite notification aggregates.")]
    async fn get_invite_history(
        &self,
        Parameters(input): Parameters<InviteHistoryParams>,
    ) -> Result<CallToolResult, String> {
        let owner_user_id = require_current_user_id(&self.runtime)?;
        social_aggregates_result(social_aggregates::get_invite_history(
            self.runtime.db.as_ref(),
            social_aggregates::InviteHistoryInput {
                owner_user_id,
                time_window: input.time_window.into(),
                direction: input.direction.into(),
                limit: input.limit,
            },
        ))
    }
}
#[derive(Clone, Debug, Default, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "snake_case")]
enum InviteDirectionParam {
    Received,
    Sent,
    #[default]
    Both,
}

impl From<InviteDirectionParam> for social_aggregates::InviteDirection {
    fn from(value: InviteDirectionParam) -> Self {
        match value {
            InviteDirectionParam::Received => Self::Received,
            InviteDirectionParam::Sent => Self::Sent,
            InviteDirectionParam::Both => Self::Both,
        }
    }
}
#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct InviteHistoryParams {
    #[serde(default)]
    time_window: TimeWindowParams,
    #[serde(default)]
    direction: InviteDirectionParam,
    limit: Option<i64>,
}
