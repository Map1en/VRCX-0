use rmcp::handler::server::wrapper::Parameters;
use rmcp::model::CallToolResult;
use rmcp::{schemars, tool, tool_router};
use serde::Deserialize;
use serde_json::Value;

use crate::server::VrcxMcpServer;

use super::common::structured_result;

#[tool_router(router = chatbox_tool_router, vis = "pub(crate)")]
impl VrcxMcpServer {
    #[tool(
        description = "[L1·query] Read the VRChat in-game Chatbox: current status (activity, pauseReason, and preview: the text it would show), status pages with their line templates and value formats, AFK and message settings, the template values you can use, and limits. Line templates insert values with {time} {track} {title} {artist} {album} {progress} {position} {duration} {cpu} {memory} {gpu} {vram} {gputemp} {session}; a line whose value is unavailable right now is hidden. Status pages show only while statusEnabled is true, and only enabled pages rotate."
    )]
    async fn get_chatbox(&self) -> Result<CallToolResult, String> {
        chatbox_result(self.runtime.chatbox.state())
    }

    #[tool(
        description = "[action] Send text to the VRChat in-game Chatbox now; it shows for a few seconds, then the Chatbox goes back to AFK or the status pages, or clears if neither is on. Max 144 characters and 9 lines, longer text is cut. Everyone in the instance can read it, so never include other people's locations or private details. Returns sent, empty, or paused (game not running or game isolation on)."
    )]
    async fn send_chatbox_message(
        &self,
        Parameters(input): Parameters<SendChatboxMessageParams>,
    ) -> Result<CallToolResult, String> {
        chatbox_result(self.runtime.chatbox.send(input.text))
    }

    #[tool(
        description = "[action] Turn the Chatbox AFK status on or off. While on, the Chatbox shows the AFK text instead of the status pages."
    )]
    async fn set_chatbox_afk(
        &self,
        Parameters(input): Parameters<SetChatboxAfkParams>,
    ) -> Result<CallToolResult, String> {
        chatbox_result(self.runtime.chatbox.set_afk(input.afk))
    }

    #[tool(
        description = "[write·local] Replace the whole Chatbox configuration with `config`, in the same shape get_chatbox returns under `config`: read it first, change what you need (statusEnabled, status pages, line templates, value formats, AFK text, quick phrases), and send the whole object back. New pages and lines need a unique id. Out-of-range values are clamped. Returns the saved configuration."
    )]
    async fn update_chatbox(
        &self,
        Parameters(input): Parameters<UpdateChatboxParams>,
    ) -> Result<CallToolResult, String> {
        chatbox_result(self.runtime.chatbox.update_config(input.config))
    }
}

fn chatbox_result(
    result: vrcx_0_application_core::Result<Value>,
) -> Result<CallToolResult, String> {
    structured_result(result.map_err(|error| error.to_string())?)
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SendChatboxMessageParams {
    text: String,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct SetChatboxAfkParams {
    afk: bool,
}

#[derive(Clone, Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct UpdateChatboxParams {
    config: Value,
}
