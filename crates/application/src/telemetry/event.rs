use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TelemetryClientEvent {
    PageVisit {
        route: String,
        landing: bool,
    },
    ToolOpen {
        tool: String,
    },
    DialogTabView {
        dialog: String,
        tab: String,
        landing: bool,
    },
    LongFrame {
        route: String,
        dialog: Option<String>,
        duration_ms: u32,
    },
    SlowCommand {
        command: String,
        duration_ms: u32,
    },
    RouteError {
        error_class: String,
        name: Option<String>,
        summary: Option<String>,
    },
    AssistantToolError {
        source: Option<String>,
        summary: Option<String>,
    },
    AssistantTurnError {
        code: String,
        summary: Option<String>,
    },
}
