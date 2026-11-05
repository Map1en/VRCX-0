use std::sync::Arc;

use serde_json::Value;
use vrcx_0_application::social::{
    GroupCalendarPage, GroupCalendarPageKind, GroupCalendarProfileFuture, GroupCalendarRemote,
    GroupCalendarRemoteFuture,
};
use vrcx_0_application_core::{Error, Result, WebClient};
use vrcx_0_contracts::vrchat_api::VrchatScope;
use vrcx_0_contracts::VrchatJsonResponse;
use vrcx_0_core::json::RawJson;
use vrcx_0_vrchat_protocol::{
    groups::profile_get_input,
    tools::{
        calendars_get_input, featured_calendars_get_input, following_calendars_get_input,
        CalendarListParams,
    },
};

pub struct VrchatGroupCalendarRemote {
    web: Arc<WebClient>,
}

impl VrchatGroupCalendarRemote {
    pub fn new(web: Arc<WebClient>) -> Self {
        Self { web }
    }
}

impl GroupCalendarRemote for VrchatGroupCalendarRemote {
    fn page<'a>(
        &'a self,
        endpoint: &'a str,
        kind: GroupCalendarPageKind,
        date: &'a str,
        n: i32,
        offset: i32,
    ) -> GroupCalendarRemoteFuture<'a, GroupCalendarPage> {
        Box::pin(async move {
            let params = CalendarListParams {
                n: Some(n),
                offset: Some(offset),
                date: Some(date.to_string()),
            };
            let request = match kind {
                GroupCalendarPageKind::All => calendars_get_input(endpoint.to_string(), params),
                GroupCalendarPageKind::Following => {
                    following_calendars_get_input(endpoint.to_string(), params)
                }
                GroupCalendarPageKind::Featured => {
                    featured_calendars_get_input(endpoint.to_string(), params)
                }
            };
            let response = self.web.execute_api(request, VrchatScope::Vrchat).await?;
            parse_page_response(response.status, &response.data)
        })
    }

    fn group_profile<'a>(
        &'a self,
        endpoint: &'a str,
        group_id: &'a str,
    ) -> GroupCalendarProfileFuture<'a> {
        Box::pin(async move {
            let request = profile_get_input(endpoint.to_string(), group_id.to_string(), false)
                .ok()?
                .1;
            let response = self
                .web
                .execute_api(request, VrchatScope::Vrchat)
                .await
                .ok()?;
            parse_group_profile_response(response.status, &response.data)
        })
    }
}

fn parse_page_response(status: i32, data: &str) -> Result<GroupCalendarPage> {
    let response = VrchatJsonResponse {
        status,
        json: serde_json::from_str(data)?,
    };
    if !(200..300).contains(&response.status) || response.has_error_field() {
        return Err(Error::Custom(format!(
            "Group calendar request failed: {}",
            response.error_message_or("VRChat API request failed")
        )));
    }
    Ok(page_from_payload(&response.json))
}

fn page_from_payload(payload: &Value) -> GroupCalendarPage {
    if let Some(rows) = payload.as_array() {
        return GroupCalendarPage {
            rows: rows.iter().cloned().map(RawJson::from).collect(),
            has_next: None,
        };
    }
    let wrapped = payload.get("json");
    let rows = payload
        .get("results")
        .and_then(Value::as_array)
        .or_else(|| wrapped.and_then(Value::as_array))
        .or_else(|| wrapped?.get("results")?.as_array())
        .map(|rows| rows.iter().cloned().map(RawJson::from).collect())
        .unwrap_or_default();
    let has_next = payload
        .get("hasNext")
        .or_else(|| wrapped.and_then(|value| value.get("hasNext")))
        .and_then(Value::as_bool);
    GroupCalendarPage { rows, has_next }
}

fn parse_group_profile_response(status: i32, data: &str) -> Option<RawJson> {
    let response = VrchatJsonResponse {
        status,
        json: serde_json::from_str(data).ok()?,
    };
    if !(200..300).contains(&response.status)
        || response.has_error_field()
        || !response.json.is_object()
    {
        return None;
    }
    Some(RawJson::from(response.json))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn calendar_page_response_maps_supported_vrchat_shapes() {
        let array = parse_page_response(200, r#"[{"id":"evt_array"}]"#).unwrap();
        assert_eq!(array.rows, vec![RawJson::from(json!({"id": "evt_array"}))]);
        assert_eq!(array.has_next, None);

        let results = parse_page_response(200, r#"{"results":[{"id":"evt_results"}]}"#).unwrap();
        assert_eq!(
            results.rows,
            vec![RawJson::from(json!({"id": "evt_results"}))]
        );

        let wrapped = parse_page_response(
            200,
            r#"{"json":{"results":[{"id":"evt_wrapped"}],"hasNext":false}}"#,
        )
        .unwrap();
        assert_eq!(
            wrapped.rows,
            vec![RawJson::from(json!({"id": "evt_wrapped"}))]
        );
        assert_eq!(wrapped.has_next, Some(false));

        let wrapped_array =
            parse_page_response(200, r#"{"json":[{"id":"evt_wrapped_array"}]}"#).unwrap();
        assert_eq!(
            wrapped_array.rows,
            vec![RawJson::from(json!({"id": "evt_wrapped_array"}))]
        );
        assert!(parse_page_response(200, r#"{"results":null}"#)
            .unwrap()
            .rows
            .is_empty());
    }

    #[test]
    fn calendar_page_response_preserves_vrchat_errors() {
        assert_eq!(
            parse_page_response(429, r#"{"error":{"message":"rate limited"}}"#)
                .unwrap_err()
                .to_string(),
            "Group calendar request failed: rate limited"
        );
        assert!(parse_page_response(200, "not-json").is_err());
    }

    #[test]
    fn group_profile_response_accepts_only_successful_objects() {
        assert_eq!(
            parse_group_profile_response(200, r#"{"id":"grp_test"}"#),
            Some(RawJson::from(json!({"id": "grp_test"})))
        );
        assert_eq!(
            parse_group_profile_response(503, r#"{"id":"grp_test"}"#),
            None
        );
        assert_eq!(parse_group_profile_response(200, "[]"), None);
        assert_eq!(parse_group_profile_response(200, "not-json"), None);
    }
}
