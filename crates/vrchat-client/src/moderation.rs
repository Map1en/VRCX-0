use serde_json::json;

use crate::http_api::{api_input, HttpApiRequestInput};

pub fn player_moderations_get_input(endpoint: String) -> HttpApiRequestInput {
    api_input(endpoint, "GET", "auth/user/playermoderations", None)
}

pub fn player_moderation_update_input(
    endpoint: String,
    enabled: bool,
    target_user_id: String,
    type_name: String,
) -> HttpApiRequestInput {
    let path = if enabled {
        "auth/user/playermoderations"
    } else {
        "auth/user/unplayermoderate"
    };
    let method = if enabled { "POST" } else { "PUT" };
    api_input(
        endpoint,
        method,
        path,
        Some(json!({
            "moderated": target_user_id,
            "type": type_name,
        })),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_player_moderation_requests() {
        let get = player_moderations_get_input("https://api.example.test/api/1".into());
        assert_eq!(get.method.as_deref(), Some("GET"));
        assert_eq!(get.path.as_deref(), Some("auth/user/playermoderations"));
        assert_eq!(get.body, crate::http_api::HttpApiRequestBody::Empty);

        let post = player_moderation_update_input(
            "https://api.example.test/api/1".into(),
            true,
            "usr_target".into(),
            "block".into(),
        );
        assert_eq!(post.method.as_deref(), Some("POST"));
        assert_eq!(post.path.as_deref(), Some("auth/user/playermoderations"));
        assert_eq!(
            post.body.as_json().and_then(|body| body.get("moderated")),
            Some(&json!("usr_target"))
        );

        let delete = player_moderation_update_input(
            "https://api.example.test/api/1".into(),
            false,
            "usr_target".into(),
            "mute".into(),
        );
        assert_eq!(delete.method.as_deref(), Some("PUT"));
        assert_eq!(delete.path.as_deref(), Some("auth/user/unplayermoderate"));
        assert_eq!(
            delete.body.as_json().and_then(|body| body.get("type")),
            Some(&json!("mute"))
        );
    }
}
