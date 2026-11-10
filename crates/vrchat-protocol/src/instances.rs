use std::collections::HashMap;

use serde_json::{json, Value};

use crate::http_api::{
    api_input_skip_empty_query_string as api_input, get_input_skip_empty_query_string as get_input,
    query_input, require_text, HttpApiError,
};
use vrcx_0_contracts::vrchat_api::{
    VrchatFailure, VrchatJsonResponse, VrchatRequest, VrchatResponse,
};

mod request;

pub use request::{
    InstanceCreateGroupAccessType, InstanceCreateMinimumAvatarPerformance, InstanceCreateRegion,
    InstanceCreateRequest, InstanceCreateType,
};
pub use vrcx_0_contracts::vrchat_requests::{InstanceCreateOption, InstanceCreateOptions};

pub fn instance_get_input(
    endpoint: String,
    world_id: String,
    instance_id: String,
) -> Result<(String, String, VrchatRequest), HttpApiError> {
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
) -> Result<(String, String, VrchatRequest), HttpApiError> {
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
) -> Result<VrchatRequest, HttpApiError> {
    let params = request::validated_instance_create_request(params)?;
    Ok(api_input(endpoint, "POST", "instances", json!(params)))
}

pub fn instance_self_invite_input(
    endpoint: String,
    world_id: String,
    instance_id: String,
    short_name: String,
) -> Result<(String, String, VrchatRequest), HttpApiError> {
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
) -> Result<(String, VrchatRequest), HttpApiError> {
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
) -> Result<(String, VrchatRequest), HttpApiError> {
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
) -> Result<(String, VrchatRequest), HttpApiError> {
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
) -> Result<(String, VrchatRequest), HttpApiError> {
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

pub fn instance_count_get_input(endpoint: String) -> VrchatRequest {
    get_input(endpoint, "instances/count", HashMap::new())
}

pub fn instance_categories_get_input(endpoint: String) -> VrchatRequest {
    get_input(endpoint, "instanceCategories", HashMap::new())
}

pub fn instance_vibes_get_input(endpoint: String) -> VrchatRequest {
    get_input(endpoint, "instanceVibes", HashMap::new())
}

pub fn instance_category_options(
    response: &VrchatResponse,
) -> Result<Vec<InstanceCreateOption>, VrchatFailure> {
    let mut rows = live_option_rows(response, "name", "Getting instance categories failed.")?;
    rows.sort_by_key(|(order, _)| *order);
    Ok(rows.into_iter().map(|(_, option)| option).collect())
}

pub fn instance_vibe_options(
    response: &VrchatResponse,
) -> Result<Vec<InstanceCreateOption>, VrchatFailure> {
    let rows = live_option_rows(response, "title", "Getting instance vibes failed.")?;
    Ok(rows.into_iter().map(|(_, option)| option).collect())
}

fn live_option_rows(
    response: &VrchatResponse,
    name_field: &str,
    fallback: &str,
) -> Result<Vec<(i64, InstanceCreateOption)>, VrchatFailure> {
    let response = VrchatJsonResponse::from(response);
    if let Some(failure) = response.failure_or(fallback) {
        return Err(failure);
    }
    let Value::Array(rows) = response.json else {
        return Ok(Vec::new());
    };
    Ok(rows
        .iter()
        .filter(|row| row.get("deleted").and_then(Value::as_bool) != Some(true))
        .filter_map(|row| {
            let text = |field: &str| {
                row.get(field)
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string)
            };
            let option = InstanceCreateOption {
                id: text("id")?,
                name: text(name_field)?,
            };
            let order = row.get("order").and_then(Value::as_i64).unwrap_or(i64::MAX);
            Some((order, option))
        })
        .collect())
}

pub fn active_instances_get_input(endpoint: String, n: i32, offset: i32) -> VrchatRequest {
    get_input(
        endpoint,
        "instances/active",
        HashMap::from([
            ("n".to_string(), json!(n)),
            ("offset".to_string(), json!(offset)),
        ]),
    )
}

pub fn discover_instances_get_input(endpoint: String, n: i32) -> VrchatRequest {
    get_input(
        endpoint,
        "instances/discover",
        HashMap::from([("n".to_string(), json!(n))]),
    )
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
    fn instance_lists_send_their_page_params() {
        let active = active_instances_get_input("endpoint".into(), 100, 200);
        assert_eq!(active.method.as_deref(), Some("GET"));
        assert_eq!(active.path.as_deref(), Some("instances/active"));
        assert_eq!(
            active.query_params,
            Some(HashMap::from([
                ("n".into(), json!(100)),
                ("offset".into(), json!(200)),
            ]))
        );

        let discover = discover_instances_get_input("endpoint".into(), 60);
        assert_eq!(discover.path.as_deref(), Some("instances/discover"));
        assert_eq!(
            discover.query_params,
            Some(HashMap::from([("n".into(), json!(60))]))
        );
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
            description: None,
            category_id: None,
            vibe_ids: None,
            languages: None,
            minimum_avatar_performance: None,
        }
    }

    #[test]
    fn create_instance_sends_trimmed_discovery_details() {
        let mut request = public_instance();
        request.display_name = Some(" Movie night ".into());
        request.description = Some(" Bring snacks ".into());
        request.category_id = Some("icat_watch".into());
        request.vibe_ids = Some(vec!["ivib_chill".into(), "ivib_cozy".into()]);
        request.languages = Some(vec![" jpn ".into(), "eng".into(), "ase".into()]);

        let request = instance_create_input("endpoint".into(), request).unwrap();

        assert_eq!(
            request.body.as_json(),
            Some(&json!({
                "type": "public",
                "canRequestInvite": false,
                "worldId": "wrld_123",
                "region": "us",
                "displayName": "Movie night",
                "description": "Bring snacks",
                "categoryId": "icat_watch",
                "vibeIds": ["ivib_chill", "ivib_cozy"],
                "languages": ["jpn", "eng", "ase"],
            }))
        );
    }

    #[test]
    fn create_instance_omits_blank_discovery_details() {
        let mut request = public_instance();
        request.display_name = Some("   ".into());
        request.description = Some(" ".into());
        request.category_id = Some("".into());
        request.vibe_ids = Some(Vec::new());
        request.languages = Some(Vec::new());

        let request = instance_create_input("endpoint".into(), request).unwrap();

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
    fn create_instance_rejects_invalid_discovery_details() {
        let mut request = public_instance();
        request.vibe_ids = Some(vec![
            "ivib_1".into(),
            "ivib_2".into(),
            "ivib_3".into(),
            "ivib_4".into(),
        ]);
        assert!(instance_create_input("endpoint".into(), request).is_err());

        let mut request = public_instance();
        request.vibe_ids = Some(vec!["chill".into()]);
        assert!(instance_create_input("endpoint".into(), request).is_err());

        let mut request = public_instance();
        request.category_id = Some("hangout".into());
        assert!(instance_create_input("endpoint".into(), request).is_err());

        let mut request = public_instance();
        request.languages = Some(vec!["eng".into(), "jpn".into(), "kor".into(), "deu".into()]);
        assert!(instance_create_input("endpoint".into(), request).is_err());

        let mut request = public_instance();
        request.languages = Some(vec!["eng".into(), " ".into()]);
        assert!(instance_create_input("endpoint".into(), request).is_err());
    }

    fn response(status: i32, data: Value) -> VrchatResponse {
        VrchatResponse {
            status,
            data: data.to_string(),
        }
    }

    fn option(id: &str, name: &str) -> InstanceCreateOption {
        InstanceCreateOption {
            id: id.into(),
            name: name.into(),
        }
    }

    #[test]
    fn create_option_lists_request_their_endpoints() {
        let categories = instance_categories_get_input("endpoint".into());
        assert_eq!(categories.method.as_deref(), Some("GET"));
        assert_eq!(categories.path.as_deref(), Some("instanceCategories"));

        let vibes = instance_vibes_get_input("endpoint".into());
        assert_eq!(vibes.method.as_deref(), Some("GET"));
        assert_eq!(vibes.path.as_deref(), Some("instanceVibes"));
    }

    #[test]
    fn category_options_follow_server_order_and_skip_deleted_rows() {
        let categories = instance_category_options(&response(
            200,
            json!([
                { "id": "icat_games", "name": "Games", "order": 2, "deleted": false },
                { "id": "icat_old", "name": "Old", "order": 0, "deleted": true },
                { "id": "icat_hangout", "name": "Hangout", "order": 0, "deleted": false },
                { "name": "Broken", "order": 1 },
                { "id": "icat_music", "name": "Music & Shows", "order": 1 },
            ]),
        ))
        .unwrap();

        assert_eq!(
            categories,
            vec![
                option("icat_hangout", "Hangout"),
                option("icat_music", "Music & Shows"),
                option("icat_games", "Games"),
            ]
        );
    }

    #[test]
    fn vibe_options_keep_server_order_and_skip_deleted_rows() {
        let vibes = instance_vibe_options(&response(
            200,
            json!([
                { "id": "ivib_adventure", "title": "Adventure", "deleted": false },
                { "id": "ivib_coffee", "title": "Coffee", "deleted": true },
                { "id": "ivib_chill", "title": "Chill" },
                { "id": "ivib_untitled" },
            ]),
        ))
        .unwrap();

        assert_eq!(
            vibes,
            vec![
                option("ivib_adventure", "Adventure"),
                option("ivib_chill", "Chill"),
            ]
        );
    }

    #[test]
    fn create_option_lists_surface_api_failures() {
        let failure = instance_vibe_options(&response(
            401,
            json!({ "error": { "message": "Missing Credentials", "status_code": 401 } }),
        ))
        .unwrap_err();
        assert_eq!(failure.status_code, 401);
        assert_eq!(failure.message, "Missing Credentials");

        assert_eq!(
            instance_category_options(&response(200, json!({}))).unwrap(),
            Vec::new()
        );
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
        assert_eq!(
            request.body,
            vrcx_0_contracts::vrchat_api::VrchatRequestBody::Empty
        );
        assert_eq!(
            request
                .query_params
                .as_ref()
                .and_then(|params| params.get("shortName")),
            Some(&Value::String("abc123".into()))
        );
    }
}
