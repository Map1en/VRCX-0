use serde::Deserialize;

#[derive(Debug, Clone, Deserialize, specta::Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TelemetryClientEvent {
    PageVisit {
        route: String,
    },
    RouteError {
        error_class: String,
        name: Option<String>,
        summary: Option<String>,
    },
    ViewModeSwitch {
        dimension: String,
        value: String,
    },
    AssistantOpen,
    AssistantApiKeyConfigured,
    AssistantToolError {
        source: Option<String>,
        summary: Option<String>,
    },
    AssistantTurnError {
        code: String,
        summary: Option<String>,
    },
}
