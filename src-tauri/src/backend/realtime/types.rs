use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RealtimeSessionContext {
    pub user_id: String,
    pub endpoint: String,
    pub websocket: String,
}

impl RealtimeSessionContext {
    pub fn new(user_id: String, endpoint: String, websocket: String) -> Self {
        Self {
            user_id: user_id.trim().to_string(),
            endpoint: endpoint.trim().to_string(),
            websocket: websocket.trim().to_string(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeWsMessagePayload {
    pub json: Value,
    pub raw: String,
    pub received_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RealtimeWsStatusPayload {
    pub status: String,
    pub websocket_domain: String,
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status_code: Option<i32>,
}
