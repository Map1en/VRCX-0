use std::collections::HashMap;

use serde_json::{json, Value};

use crate::http_api::{
    api_input_skip_empty_query_string as api_input, get_input_skip_empty_query_string as get_input,
    query_input, require_text, HttpApiError, HttpApiRequestInput,
};

mod request;

pub use request::{
    InstanceCreateGroupAccessType, InstanceCreateMinimumAvatarPerformance, InstanceCreateRegion,
    InstanceCreateRequest, InstanceCreateType,
};

pub fn instance_get_input(
    endpoint: String,
    world_id: String,
    instance_id: String,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let world_id = require_text(world_id, "VrchatInstanceGet requires worldId.")?;
    let instance_id = require_text(instance_id, "VrchatInstanceGet requires instanceId.")?;
    Ok((
        world_id.clone(),
        instance_id.clone(),
        get_input(
            endpoint,
            format!("instances/{world_id}:{instance_id}"),
            HashMap::new(),
        ),
    ))
}

pub fn instance_short_name_get_input(
    endpoint: String,
    world_id: String,
    instance_id: String,
    short_name: String,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let world_id = require_text(world_id, "VrchatInstanceShortNameGet requires worldId.")?;
    let instance_id = require_text(
        instance_id,
        "VrchatInstanceShortNameGet requires instanceId.",
    )?;
    let mut params = HashMap::new();
    if !short_name.is_empty() {
        params.insert("shortName".to_string(), Value::String(short_name));
    }
    Ok((
        world_id.clone(),
        instance_id.clone(),
        get_input(
            endpoint,
            format!("instances/{world_id}:{instance_id}/shortName"),
            params,
        ),
    ))
}

pub fn instance_create_input(
    endpoint: String,
    params: InstanceCreateRequest,
) -> Result<HttpApiRequestInput, HttpApiError> {
    let params = request::validated_instance_create_request(params)?;
    Ok(api_input(endpoint, "POST", "instances", json!(params)))
}

pub fn instance_self_invite_input(
    endpoint: String,
    world_id: String,
    instance_id: String,
    short_name: String,
) -> Result<(String, String, HttpApiRequestInput), HttpApiError> {
    let world_id = require_text(world_id, "VrchatInstanceSelfInvite requires worldId.")?;
    let instance_id = require_text(instance_id, "VrchatInstanceSelfInvite requires instanceId.")?;
    let body = if short_name.is_empty() {
        HashMap::new()
    } else {
        HashMap::from([("shortName".to_string(), Value::String(short_name))])
    };
    Ok((
        world_id.clone(),
        instance_id.clone(),
        query_input(
            endpoint,
            "POST",
            format!("invite/myself/to/{world_id}:{instance_id}"),
            body,
        ),
    ))
}

pub fn instance_close_input(
    endpoint: String,
    location: String,
    hard_close: bool,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let location = require_text(location, "VrchatInstanceClose requires location.")?;
    Ok((
        location.clone(),
        api_input(
            endpoint,
            "DELETE",
            format!("instances/{location}"),
            json!({ "hardClose": hard_close }),
        ),
    ))
}

pub fn instance_calendar_link_input(
    endpoint: String,
    location: String,
    calendar_entry_id: Option<String>,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    instance_field_put_input(
        endpoint,
        location,
        "VrchatInstanceCalendarLink requires location.",
        "calendarEntryId",
        calendar_entry_id,
    )
}

pub fn instance_display_name_input(
    endpoint: String,
    location: String,
    display_name: Option<String>,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    instance_field_put_input(
        endpoint,
        location,
        "VrchatInstanceDisplayName requires location.",
        "displayName",
        display_name,
    )
}

fn instance_field_put_input(
    endpoint: String,
    location: String,
    location_message: &str,
    field: &str,
    value: Option<String>,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let location = require_text(location, location_message)?;
    let value = value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Ok((
        location.clone(),
        api_input(
            endpoint,
            "PUT",
            format!("instances/{location}"),
            json!({ field: value }),
        ),
    ))
}

pub fn instance_count_get_input(endpoint: String) -> HttpApiRequestInput {
    get_input(endpoint, "instances/count", HashMap::new())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn display_name_sets_or_clears_the_instance_name() {
        let (_, rename) = instance_display_name_input(
            "endpoint".into(),
            "wrld_1:123".into(),
            Some(" Movie night ".into()),
        )
        .unwrap();
        assert_eq!(rename.method.as_deref(), Some("PUT"));
        assert_eq!(rename.path.as_deref(), Some("instances/wrld_1:123"));
        assert_eq!(
            rename.body.as_json(),
            Some(&json!({ "displayName": "Movie night" }))
        );

        let (_, clear) =
            instance_display_name_input("endpoint".into(), "wrld_1:123".into(), Some(" ".into()))
                .unwrap();
        assert_eq!(clear.body.as_json(), Some(&json!({ "displayName": null })));

        let count = instance_count_get_input("endpoint".into());
        assert_eq!(count.method.as_deref(), Some("GET"));
        assert_eq!(count.path.as_deref(), Some("instances/count"));
    }

    #[test]
    fn calendar_link_sets_or_clears_the_instance_calendar_entry() {
        let (_, link) = instance_calendar_link_input(
            "endpoint".into(),
            "wrld_1:123~group(grp_1)".into(),
            Some(" gcal_1 ".into()),
        )
        .unwrap();
        assert_eq!(link.method.as_deref(), Some("PUT"));
        assert_eq!(
            link.path.as_deref(),
            Some("instances/wrld_1:123~group(grp_1)")
        );
        assert_eq!(
            link.body.as_json(),
            Some(&json!({ "calendarEntryId": "gcal_1" }))
        );

        let (_, unlink) =
            instance_calendar_link_input("endpoint".into(), "wrld_1:123".into(), None).unwrap();
        assert_eq!(
            unlink.body.as_json(),
            Some(&json!({ "calendarEntryId": null }))
        );
    }

    fn public_instance() -> InstanceCreateRequest {
        InstanceCreateRequest {
            r#type: InstanceCreateType::Public,
            can_request_invite: false,
            world_id: "wrld_123".into(),
            owner_id: None,
            region: InstanceCreateRegion::Us,
            group_access_type: None,
            queue_enabled: None,
            role_ids: None,
            age_gate: None,
            display_name: None,
            minimum_avatar_performance: None,
        }
    }

    #[test]
    fn create_instance_serializes_only_valid_typed_options() {
        let request = instance_create_input("endpoint".into(), public_instance()).unwrap();

        assert_eq!(
            request.body.as_json(),
            Some(&json!({
                "type": "public",
                "canRequestInvite": false,
                "worldId": "wrld_123",
                "region": "us",
            }))
        );
    }

    #[test]
    fn create_instance_rejects_cross_field_mismatches() {
        let mut request = public_instance();
        request.owner_id = Some("usr_owner".into());
        assert!(instance_create_input("endpoint".into(), request).is_err());

        let mut request = public_instance();
        request.r#type = InstanceCreateType::Group;
        request.owner_id = Some("grp_owner".into());
        request.group_access_type = Some(InstanceCreateGroupAccessType::Plus);
        request.role_ids = Some(vec!["grol_role".into()]);
        assert!(instance_create_input("endpoint".into(), request).is_err());

        let mut request = public_instance();
        request.can_request_invite = true;
        assert!(instance_create_input("endpoint".into(), request).is_err());

        let mut request = public_instance();
        request.minimum_avatar_performance = Some(InstanceCreateMinimumAvatarPerformance::Good);
        assert!(instance_create_input("endpoint".into(), request).is_err());
    }

    #[test]
    fn create_group_instance_serializes_minimum_avatar_performance() {
        let mut request = public_instance();
        request.r#type = InstanceCreateType::Group;
        request.owner_id = Some("grp_owner".into());
        request.group_access_type = Some(InstanceCreateGroupAccessType::Plus);
        request.minimum_avatar_performance = Some(InstanceCreateMinimumAvatarPerformance::Medium);

        let request = instance_create_input("endpoint".into(), request).unwrap();

        assert_eq!(
            request.body.as_json(),
            Some(&json!({
                "type": "group",
                "canRequestInvite": false,
                "worldId": "wrld_123",
                "ownerId": "grp_owner",
                "region": "us",
                "groupAccessType": "plus",
                "minimumAvatarPerformance": "Medium",
            }))
        );
    }

    #[test]
    fn create_instance_rejects_none_as_a_minimum_avatar_performance_value() {
        assert!(
            serde_json::from_value::<InstanceCreateMinimumAvatarPerformance>(json!("None"))
                .is_err()
        );
    }

    #[test]
    fn short_name_lookup_keeps_instance_tag_unescaped_like_legacy_api() {
        let (_, _, request) = instance_short_name_get_input(
            "".into(),
            "wrld_123".into(),
            "12345~hidden(usr_owner)".into(),
            "".into(),
        )
        .unwrap();

        assert_eq!(
            request.path.as_deref(),
            Some("instances/wrld_123:12345~hidden(usr_owner)/shortName")
        );
    }

    #[test]
    fn self_invite_uses_short_name_as_query_param_without_json_body() {
        let (_, _, request) = instance_self_invite_input(
            "".into(),
            "wrld_123".into(),
            "12345~hidden(usr_owner)".into(),
            "abc123".into(),
        )
        .unwrap();

        assert_eq!(
            request.path.as_deref(),
            Some("invite/myself/to/wrld_123:12345~hidden(usr_owner)")
        );
        assert_eq!(request.method.as_deref(), Some("POST"));
        assert_eq!(request.body, crate::http_api::HttpApiRequestBody::Empty);
        assert_eq!(
            request
                .query_params
                .as_ref()
                .and_then(|params| params.get("shortName")),
            Some(&Value::String("abc123".into()))
        );
    }
}
