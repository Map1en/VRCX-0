use std::future::{self, Future};

use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::model::{
    Implementation, ListResourcesResult, PaginatedRequestParams, ReadResourceRequestParams,
    ReadResourceResult, Resource, ResourceContents, ServerCapabilities, ServerInfo,
};
use rmcp::service::{MaybeSendFuture, RequestContext, RoleServer};
use rmcp::{tool_handler, ErrorData as RmcpError, ServerHandler};
use vrcx_0_persistence::social_aggregates;

use crate::runtime::McpRuntime;

const DATA_CAVEATS_URI: &str = "vrcx://data-caveats";

const SERVER_INSTRUCTIONS: &str = "\
VRCX-0 exposes observer-centered VRChat social facts from the signed-in user's local history and live session. \
Tools return aggregated facts centered on the signed-in user (\"me\"); you interpret them.

This app is VRCX-0 (the Tauri/React rewrite), NOT the original VRCX. Always refer to it as VRCX-0 in any user-facing reply.

Read before answering:
- Many user-targeting tools accept either a usr_ id or display name; when they resolve a name, read `resolvedUser` and make sure it is the intended person. If a tool returns `needsDisambiguation`, ask the user to choose instead of guessing.
- Tool outputs with a `summary` field are ready-to-read fact bundles; use that summary as the narration seed, then add only the caveats and details needed for the user's question.
- Missing data means unobserved, not false.
- Facts about ME are reliable even inside private instances; facts about a THIRD PARTY (who someone else is with) are blind in private instances. Say so.
- Each result carries a `caveats` array; reflect the relevant ones instead of presenting figures as exact.
- For top/most/ranked asks, the tools already rank and limit the rows; read the top rows and answer from the aggregate instead of looping to enumerate everyone. Pass a small `limit` only to widen or narrow the ranking.

Tool tiers — pick the right altitude:
- [L1·query/resolve] leaf lookups: one source, a list of rows. Building blocks.
- [L2·analyze] server-side aggregates: ranked/bucketed facts with a summary. Prefer these for who/when/most questions; they already did the counting, so read the top rows and don't loop.
- [L2·advanced] large/raw output for custom analysis; a higher-tier tool usually answers the common question.
- [L3·bundle] one call composing several L2 analyses into a ready narrative; do NOT re-call the parts it already includes.
- [write]/[action] side effects; dry_run defaults true, confirm first.
Pick the highest tier that answers the question; drill to L1 only for detail the aggregate did not include.

Map fuzzy requests to tools, then read each tool's own description for details (compose freely):
- Turn a name into candidate userIds when you need manual disambiguation -> find_user
- Closest to / who I play with most -> get_copresence_summary
- Drifting from / losing touch with -> get_fading_friends
- My playtime by month/year/week, trends, or when I log on -> get_activity_timeline
- My longest break, play streak, or active days -> get_activity_streaks
- When to log on to catch people -> get_best_time_to_play (one friend: get_friend_activity_pattern)
- Who was that person, by name fragment, time, world, or who they were with -> recall_encounter
- Recap a week or month -> summarize_social_period
- Who someone else hangs out with -> get_companions_of
- A single friend, or who is online now -> get_friend_profile, get_online_friends
- Which of my friends know each other / friend groups -> get_friend_circles
- History, mutuals, invites, status changes -> get_friend_log, get_social_graph (refresh_mutual_graph if stale), get_invite_history, get_friend_changes

For vague asks, start with summarize_social_period or get_online_friends, then drill in and cross-reference. Time windows are RFC3339; omit to search all history. \
Writes (favorite_local, favorite_vrchat, set_friend_note) default to dry_run=true and never message other users; confirm before a real write.";

pub(crate) struct VrcxMcpServer {
    pub(crate) runtime: McpRuntime,
    pub(crate) tool_router: ToolRouter<Self>,
}

#[tool_handler(router = self.tool_router)]
impl ServerHandler for VrcxMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(
            ServerCapabilities::builder()
                .enable_tools()
                .enable_resources()
                .build(),
        )
        .with_server_info(Implementation::new("vrcx-0", env!("CARGO_PKG_VERSION")))
        .with_instructions(SERVER_INSTRUCTIONS)
    }

    fn list_resources(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListResourcesResult, RmcpError>> + MaybeSendFuture + '_ {
        let resource = Resource::new(DATA_CAVEATS_URI, "data_caveats")
            .with_title("VRCX-0 Data Caveats")
            .with_description("Observer-centered data caveats for all VRCX-0 MCP tools.")
            .with_mime_type("text/plain");
        future::ready(Ok(ListResourcesResult::with_all_items(vec![resource])))
    }

    fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ReadResourceResult, RmcpError>> + MaybeSendFuture + '_ {
        if request.uri != DATA_CAVEATS_URI {
            return future::ready(Err(RmcpError::invalid_params(
                "Unknown VRCX-0 MCP resource",
                None,
            )));
        }
        future::ready(Ok(ReadResourceResult::new(vec![ResourceContents::text(
            social_aggregates::data_caveats_resource(),
            DATA_CAVEATS_URI,
        )
        .with_mime_type("text/plain")])))
    }
}
