use serde::Serialize;
use serde_json::Value;
use vrcx_0_application_core::RuntimeEventPayload;

#[derive(Clone, Debug, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeGroupInstancesProjection {
    pub status: RuntimeGroupInstancesStatus,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeGroupInstancesStatus {
    Idle,
    Running,
    Ready,
    Error,
}

impl RuntimeGroupInstancesProjection {
    pub(crate) fn running(user_id: String, endpoint: String) -> Self {
        Self::for_scope(RuntimeGroupInstancesStatus::Running, user_id, endpoint)
    }

    pub(crate) fn ready(
        user_id: String,
        endpoint: String,
        fetched_at: String,
        instances: Vec<Value>,
        group_order: Vec<String>,
    ) -> Self {
        Self {
            status: RuntimeGroupInstancesStatus::Ready,
            user_id,
            endpoint,
            fetched_at: Some(fetched_at),
            error: None,
            instances: Some(instances),
            group_order: Some(group_order),
        }
    }

    pub(crate) fn failed(user_id: String, endpoint: String, error: String) -> Self {
        Self {
            error: Some(error),
            ..Self::for_scope(RuntimeGroupInstancesStatus::Error, user_id, endpoint)
        }
    }

    pub(crate) fn idle_preserving_entries(user_id: String, endpoint: String) -> Self {
        Self::for_scope(RuntimeGroupInstancesStatus::Idle, user_id, endpoint)
    }

    pub(crate) fn idle_clearing_entries(user_id: String, endpoint: String) -> Self {
        Self {
            instances: Some(Vec::new()),
            group_order: Some(Vec::new()),
            ..Self::idle_preserving_entries(user_id, endpoint)
        }
    }

    pub(crate) fn cleared_session(user_id: String, endpoint: String) -> Self {
        Self {
            error: Some(String::new()),
            ..Self::idle_clearing_entries(user_id, endpoint)
        }
    }

    fn for_scope(status: RuntimeGroupInstancesStatus, user_id: String, endpoint: String) -> Self {
        Self {
            status,
            user_id,
            endpoint,
            fetched_at: None,
            error: None,
            instances: None,
            group_order: None,
        }
    }
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
        let payload = RuntimeGroupInstancesProjection::running(
            "usr_test".into(),
            "https://api.vrchat.cloud".into(),
        );

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
    fn idle_projection_omits_entries_when_existing_arrays_must_be_preserved() {
        let payload = RuntimeGroupInstancesProjection::idle_preserving_entries(
            "usr_test".into(),
            "https://api.vrchat.cloud".into(),
        );

        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            json!({
                "status": "idle",
                "userId": "usr_test",
                "endpoint": "https://api.vrchat.cloud",
            })
        );
    }

    #[test]
    fn cleared_projection_preserves_empty_error_and_arrays() {
        let payload = RuntimeGroupInstancesProjection::cleared_session(
            "usr_test".into(),
            "https://api.vrchat.cloud".into(),
        );

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
