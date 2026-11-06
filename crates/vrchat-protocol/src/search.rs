use std::collections::HashMap;

use crate::http_api::{encode_path_segment, get_input, normalize_text, require_text, HttpApiError};
use crate::query::serialize_query;
use vrcx_0_contracts::vrchat_api::VrchatRequest;

pub use vrcx_0_contracts::vrchat_requests::{
    GroupSearchParams, UserSearchParams, WorldSearchParams,
};

pub fn search_worlds_get_input(
    endpoint: String,
    params: WorldSearchParams,
    option: Option<String>,
) -> VrchatRequest {
    let option = option.map(normalize_text).filter(|value| !value.is_empty());
    let path = match option {
        Some(value) => format!("worlds/{}", encode_path_segment(&value)),
        None => "worlds".into(),
    };
    get_input(endpoint, path, serialize_query(&params))
}

pub fn search_users_get_input(endpoint: String, params: UserSearchParams) -> VrchatRequest {
    get_input(endpoint, "users", serialize_query(&params))
}

pub fn search_groups_get_input(endpoint: String, params: GroupSearchParams) -> VrchatRequest {
    get_input(endpoint, "groups", serialize_query(&params))
}

pub fn search_groups_strict_get_input(
    endpoint: String,
    params: GroupSearchParams,
) -> VrchatRequest {
    get_input(endpoint, "groups/strictsearch", serialize_query(&params))
}

pub fn search_instance_short_name_get_input(
    endpoint: String,
    short_name: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let short_name = require_text(
        short_name,
        "VrchatSearchInstanceShortNameGet requires shortName.",
    )?;
    Ok((
        short_name.clone(),
        get_input(
            endpoint,
            format!("instances/s/{}", encode_path_segment(&short_name)),
            HashMap::new(),
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ENDPOINT: &str = "https://api.vrchat.cloud/api/1";

    #[test]
    fn search_routes_keep_original_paths_and_query_params() {
        let cases = [
            (
                search_worlds_get_input(
                    ENDPOINT.into(),
                    WorldSearchParams {
                        search: Some("query".into()),
                        ..Default::default()
                    },
                    None,
                ),
                "worlds",
                "search",
            ),
            (
                search_users_get_input(
                    ENDPOINT.into(),
                    UserSearchParams {
                        search: Some("query".into()),
                        ..Default::default()
                    },
                ),
                "users",
                "search",
            ),
            (
                search_groups_get_input(
                    ENDPOINT.into(),
                    GroupSearchParams {
                        query: Some("query".into()),
                        ..Default::default()
                    },
                ),
                "groups",
                "query",
            ),
            (
                search_groups_strict_get_input(
                    ENDPOINT.into(),
                    GroupSearchParams {
                        query: Some("query".into()),
                        ..Default::default()
                    },
                ),
                "groups/strictsearch",
                "query",
            ),
        ];

        for (request, path, key) in cases {
            assert_eq!(request.method.as_deref(), Some("GET"));
            assert_eq!(request.path.as_deref(), Some(path));
            assert_eq!(
                request.query_params,
                Some(HashMap::from([(key.into(), json!("query"))]))
            );
        }
    }

    #[test]
    fn typed_search_params_keep_supported_extensions_and_reject_unknown_fields() {
        let params: UserSearchParams = serde_json::from_value(json!({
            "search": "profile text",
            "customFields": "displayName",
            "sort": "last_login",
            "order": "descending"
        }))
        .unwrap();
        assert_eq!(
            serialize_query(&params),
            HashMap::from([
                ("search".into(), json!("profile text")),
                ("customFields".into(), json!("displayName")),
                ("sort".into(), json!("last_login")),
                ("order".into(), json!("descending")),
            ])
        );

        assert!(serde_json::from_value::<GroupSearchParams>(json!({
            "query": "group",
            "unexpected": true
        }))
        .is_err());
    }

    #[test]
    fn world_option_and_instance_short_name_are_trimmed_and_encoded() {
        let world = search_worlds_get_input(
            ENDPOINT.into(),
            WorldSearchParams::default(),
            Some(" wrld_1/unsafe ".into()),
        );
        assert_eq!(world.path.as_deref(), Some("worlds/wrld%5F1%2Funsafe"));

        let (short_name, instance) =
            search_instance_short_name_get_input(ENDPOINT.into(), " abc/雪 ".into()).unwrap();
        assert_eq!(short_name, "abc/雪");
        assert_eq!(
            instance.path.as_deref(),
            Some("instances/s/abc%2F%E9%9B%AA")
        );
    }

    #[test]
    fn blank_optional_world_route_falls_back_and_blank_short_name_is_rejected() {
        let world = search_worlds_get_input(
            ENDPOINT.into(),
            WorldSearchParams::default(),
            Some(" ".into()),
        );
        assert_eq!(world.path.as_deref(), Some("worlds"));
        assert!(search_instance_short_name_get_input(ENDPOINT.into(), " ".into()).is_err());
    }
}
