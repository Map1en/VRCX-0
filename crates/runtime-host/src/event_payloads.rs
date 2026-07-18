use serde::Serialize;
use serde_json::Value;
use vrcx_0_application_core::RuntimeEventPayload;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeGroupInstancesProjection {
    pub status: String,
    pub user_id: String,
    pub endpoint: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instances: Option<Vec<Value>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub group_order: Option<Vec<String>>,
}

impl RuntimeEventPayload for RuntimeGroupInstancesProjection {
    const EVENT_NAME: &'static str = "runtimeGroupInstancesProjection";
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::RuntimeGroupInstancesProjection;

    #[test]
    fn running_projection_omits_unavailable_fields() {
        let payload = RuntimeGroupInstancesProjection {
            status: "running".into(),
            user_id: "usr_test".into(),
            endpoint: "https://api.vrchat.cloud".into(),
            fetched_at: None,
            error: None,
            instances: None,
            group_order: None,
        };

        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            json!({
                "status": "running",
                "userId": "usr_test",
                "endpoint": "https://api.vrchat.cloud",
            })
        );
    }

    #[test]
    fn cleared_projection_preserves_empty_error_and_arrays() {
        let payload = RuntimeGroupInstancesProjection {
            status: "idle".into(),
            user_id: "usr_test".into(),
            endpoint: "https://api.vrchat.cloud".into(),
            fetched_at: None,
            error: Some(String::new()),
            instances: Some(Vec::new()),
            group_order: Some(Vec::new()),
        };

        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            json!({
                "status": "idle",
                "userId": "usr_test",
                "endpoint": "https://api.vrchat.cloud",
                "error": "",
                "instances": [],
                "groupOrder": [],
            })
        );
    }
}
