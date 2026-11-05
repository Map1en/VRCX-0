use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application::game::{
    BackgroundGroupProfileFuture, BackgroundGroupRemote, BackgroundGroupRemoteFuture,
};
use vrcx_0_application_core::{Error, WebClient};
use vrcx_0_contracts::vrchat_api::VrchatScope;
use vrcx_0_core::vrchat_endpoints::normalize_vrchat_api_endpoint;

#[derive(Clone)]
pub struct VrchatBackgroundGroupRemote {
    web: Arc<WebClient>,
}

impl VrchatBackgroundGroupRemote {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self { web }
    }
}

impl BackgroundGroupRemote for VrchatBackgroundGroupRemote {
    fn group_instances<'a>(
        &'a self,
        endpoint: &'a str,
        current_user_id: &'a str,
    ) -> BackgroundGroupRemoteFuture<'a, Vec<Value>> {
        Box::pin(async move {
            let request = vrcx_0_vrchat_protocol::groups::current_user_group_instances_get_input(
                normalize_vrchat_api_endpoint(Some(endpoint)),
                current_user_id.to_string(),
            )?
            .1;
            let response = self.web.execute_api(request, VrchatScope::Vrchat).await?;
            if !(200..=299).contains(&response.status) {
                return Err(Error::Custom(format!(
                    "group instance refresh returned HTTP {}",
                    response.status
                )));
            }
            Ok(parse_group_instance_rows_or_empty(&response.data))
        })
    }

    fn group_instances_for_group<'a>(
        &'a self,
        endpoint: &'a str,
        current_user_id: &'a str,
        group_id: &'a str,
    ) -> BackgroundGroupRemoteFuture<'a, Vec<Value>> {
        Box::pin(async move {
            let request =
                vrcx_0_vrchat_protocol::groups::user_group_instances_get_input_for_endpoint(
                    normalize_vrchat_api_endpoint(Some(endpoint)),
                    group_id.to_string(),
                    current_user_id.to_string(),
                )?
                .2;
            let response = self.web.execute_api(request, VrchatScope::Vrchat).await?;
            if !(200..=299).contains(&response.status) {
                return Err(Error::Custom(format!(
                    "saved group instance refresh returned HTTP {}",
                    response.status
                )));
            }
            parse_group_instance_rows(&response.data)
        })
    }

    fn group_profile<'a>(
        &'a self,
        endpoint: &'a str,
        group_id: &'a str,
    ) -> BackgroundGroupProfileFuture<'a> {
        Box::pin(async move {
            let endpoint = normalize_vrchat_api_endpoint(Some(endpoint));
            let Ok((_, request)) = vrcx_0_vrchat_protocol::groups::profile_get_input(
                endpoint,
                group_id.to_string(),
                false,
            ) else {
                return None;
            };
            match self.web.execute_api(request, VrchatScope::Vrchat).await {
                Ok(response) if (200..=299).contains(&response.status) => {
                    serde_json::from_str(&response.data).ok()
                }
                Ok(response) => {
                    tracing::warn!(
                        group_id,
                        status = response.status,
                        "background group instance profile hydration failed"
                    );
                    None
                }
                Err(error) => {
                    tracing::warn!(
                        group_id,
                        error = %error,
                        "background group instance profile hydration failed"
                    );
                    None
                }
            }
        })
    }
}

fn parse_group_instance_rows_or_empty(data: &str) -> Vec<Value> {
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        return Vec::new();
    };
    value
        .as_array()
        .cloned()
        .or_else(|| value.get("instances").and_then(Value::as_array).cloned())
        .unwrap_or_default()
}

fn parse_group_instance_rows(data: &str) -> crate::Result<Vec<Value>> {
    let value = serde_json::from_str::<Value>(data)
        .map_err(|_| Error::Custom("group instance refresh returned invalid JSON".into()))?;
    if let Some(instances) = value.as_array() {
        return Ok(instances.clone());
    }
    value
        .get("instances")
        .and_then(Value::as_array)
        .cloned()
        .ok_or_else(|| Error::Custom("group instance refresh returned unexpected JSON".into()))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn notification_scan_parser_rejects_invalid_json_and_accepts_empty_rows() {
        assert!(parse_group_instance_rows("not-json").is_err());
        assert_eq!(
            parse_group_instance_rows("[]").unwrap(),
            Vec::<Value>::new()
        );
        assert_eq!(
            parse_group_instance_rows(r#"{"instances": []}"#).unwrap(),
            Vec::<Value>::new()
        );
        assert!(parse_group_instance_rows(r#"{"error": "temporary"}"#).is_err());
    }

    #[test]
    fn full_refresh_parser_keeps_invalid_and_unexpected_payloads_as_empty() {
        assert_eq!(
            parse_group_instance_rows_or_empty("not-json"),
            Vec::<Value>::new()
        );
        assert_eq!(
            parse_group_instance_rows_or_empty(r#"{"error": "temporary"}"#),
            Vec::<Value>::new()
        );
        assert_eq!(
            parse_group_instance_rows_or_empty(r#"{"instances": [{"id": "instance-a"}]}"#),
            vec![json!({ "id": "instance-a" })]
        );
    }

    #[test]
    fn notification_scan_parser_preserves_full_locations_for_comparison() {
        let rows = parse_group_instance_rows(
            r#"{
                "instances": [
                    {
                        "location": "wrld_alpha:instance-a~group(grp_saved)~groupAccessType(plus)",
                        "group": { "id": "grp_saved", "name": "Saved Group" },
                        "world": { "name": "Alpha World" }
                    },
                    {
                        "instance": {
                            "location": "wrld_beta:instance-b~group(grp_saved)~groupAccessType(members)"
                        }
                    }
                ]
            }"#,
        )
        .unwrap();

        assert_eq!(
            rows[0]["location"],
            json!("wrld_alpha:instance-a~group(grp_saved)~groupAccessType(plus)")
        );
        assert_eq!(
            rows[1]["instance"]["location"],
            json!("wrld_beta:instance-b~group(grp_saved)~groupAccessType(members)")
        );
    }
}
