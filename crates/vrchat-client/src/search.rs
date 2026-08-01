use std::collections::HashMap;

use serde_json::Value;

use crate::http_api::{
    encode_path_segment, get_input, normalize_text, require_text, HttpApiError, HttpApiRequestInput,
};

pub fn search_config_get_input(
    endpoint: String,
    params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    get_input(endpoint, "config", params)
}

pub fn search_worlds_get_input(
    endpoint: String,
    params: HashMap<String, Value>,
    option: Option<String>,
) -> HttpApiRequestInput {
    let option = option.map(normalize_text).filter(|value| !value.is_empty());
    let path = match option {
        Some(value) => format!("worlds/{}", encode_path_segment(&value)),
        None => "worlds".into(),
    };
    get_input(endpoint, path, params)
}

pub fn search_users_get_input(
    endpoint: String,
    params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    get_input(endpoint, "users", params)
}

pub fn search_groups_get_input(
    endpoint: String,
    params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    get_input(endpoint, "groups", params)
}

pub fn search_groups_strict_get_input(
    endpoint: String,
    params: HashMap<String, Value>,
) -> HttpApiRequestInput {
    get_input(endpoint, "groups/strictsearch", params)
}

pub fn search_instance_short_name_get_input(
    endpoint: String,
    short_name: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
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
        let params = HashMap::from([("search".to_string(), json!("query"))]);
        let cases = [
            (
                search_config_get_input(ENDPOINT.into(), params.clone()),
                "config",
            ),
            (
                search_worlds_get_input(ENDPOINT.into(), params.clone(), None),
                "worlds",
            ),
            (
                search_users_get_input(ENDPOINT.into(), params.clone()),
                "users",
            ),
            (
                search_groups_get_input(ENDPOINT.into(), params.clone()),
                "groups",
            ),
            (
                search_groups_strict_get_input(ENDPOINT.into(), params.clone()),
                "groups/strictsearch",
            ),
        ];

        for (request, path) in cases {
            assert_eq!(request.method.as_deref(), Some("GET"));
            assert_eq!(request.path.as_deref(), Some(path));
            assert_eq!(request.query_params.as_ref(), Some(&params));
        }
    }

    #[test]
    fn world_option_and_instance_short_name_are_trimmed_and_encoded() {
        let world = search_worlds_get_input(
            ENDPOINT.into(),
            HashMap::new(),
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
        let world = search_worlds_get_input(ENDPOINT.into(), HashMap::new(), Some(" ".into()));
        assert_eq!(world.path.as_deref(), Some("worlds"));
        assert!(search_instance_short_name_get_input(ENDPOINT.into(), " ".into()).is_err());
    }
}
