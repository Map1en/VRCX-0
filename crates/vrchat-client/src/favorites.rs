use std::collections::HashMap;

use serde_json::{json, Value};

use crate::http_api::{
    api_input, encode_path_segment, get_input, normalize_text, require_text, HttpApiError,
};
use vrcx_0_contracts::vrchat_api::VrchatRequest;
use vrcx_0_core::FavoriteGroupVisibility;

mod request;

pub use request::VrchatFavoriteType;

pub fn favorite_limits_get_input(endpoint: String) -> VrchatRequest {
    get_input(endpoint, "auth/user/favoritelimits", HashMap::new())
}

pub fn favorites_get_input(endpoint: String, n: i32, offset: i32) -> VrchatRequest {
    get_input(
        endpoint,
        "favorites",
        HashMap::from([
            ("n".to_string(), json!(n)),
            ("offset".to_string(), json!(offset)),
        ]),
    )
}

pub fn favorite_worlds_get_input(
    endpoint: String,
    n: i32,
    offset: i32,
    owner_id: String,
    user_id: String,
    tag: String,
) -> VrchatRequest {
    let owner_id = normalize_text(owner_id);
    let user_id = normalize_text(user_id);
    let tag = normalize_text(tag);
    let mut params = HashMap::from([
        ("n".to_string(), json!(n)),
        ("offset".to_string(), json!(offset)),
    ]);
    if !owner_id.is_empty() {
        params.insert("ownerId".to_string(), Value::String(owner_id));
    }
    if !user_id.is_empty() {
        params.insert("userId".to_string(), Value::String(user_id));
    }
    if !tag.is_empty() {
        params.insert("tag".to_string(), Value::String(tag));
    }
    get_input(endpoint, "worlds/favorites", params)
}

pub fn favorite_avatars_get_input(
    endpoint: String,
    n: i32,
    offset: i32,
    tag: String,
) -> VrchatRequest {
    let tag = normalize_text(tag);
    let mut params = HashMap::from([
        ("n".to_string(), json!(n)),
        ("offset".to_string(), json!(offset)),
    ]);
    if !tag.is_empty() {
        params.insert("tag".to_string(), Value::String(tag));
    }
    get_input(endpoint, "avatars/favorites", params)
}

pub fn favorite_groups_get_input(
    endpoint: String,
    n: i32,
    offset: i32,
    owner_id: String,
) -> VrchatRequest {
    let owner_id = normalize_text(owner_id);
    let mut params = HashMap::from([
        ("n".to_string(), json!(n)),
        ("offset".to_string(), json!(offset)),
    ]);
    if !owner_id.is_empty() {
        params.insert("ownerId".to_string(), Value::String(owner_id));
    }
    get_input(endpoint, "favorite/groups", params)
}

pub fn favorite_add_input(
    endpoint: String,
    favorite_type: VrchatFavoriteType,
    favorite_id: String,
    tags: String,
) -> Result<(String, String, VrchatRequest), HttpApiError> {
    let favorite_id = require_text(favorite_id, "VrchatFavoriteAdd requires favoriteId.")?;
    let tags = require_text(tags, "VrchatFavoriteAdd requires tags.")?;
    let type_name = favorite_type.as_str().to_string();
    Ok((
        type_name.clone(),
        favorite_id.clone(),
        api_input(
            endpoint,
            "POST",
            "favorites",
            Some(json!({
                "type": type_name,
                "favoriteId": favorite_id,
                "tags": tags,
            })),
        ),
    ))
}

pub fn favorite_delete_input(
    endpoint: String,
    object_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let object_id = require_text(object_id, "VrchatFavoriteDelete requires objectId.")?;
    Ok((
        object_id.clone(),
        api_input(
            endpoint,
            "DELETE",
            format!("favorites/{}", encode_path_segment(&object_id)),
            None,
        ),
    ))
}

pub fn favorite_group_save_input(
    endpoint: String,
    owner_id: String,
    favorite_type: VrchatFavoriteType,
    group: String,
    display_name: Option<String>,
    visibility: Option<FavoriteGroupVisibility>,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let owner_id = require_text(owner_id, "VrchatFavoriteGroupSave requires ownerId.")?;
    let group = require_text(group, "VrchatFavoriteGroupSave requires group.")?;
    let type_name = favorite_type.as_str();
    let mut body = json!({
        "type": type_name,
        "group": group,
    });
    if let Some(display_name) = display_name {
        body["displayName"] = Value::String(display_name);
    }
    if let Some(visibility) = visibility {
        body["visibility"] = Value::String(visibility.as_str().to_string());
    }
    Ok((
        group.clone(),
        api_input(
            endpoint,
            "PUT",
            format!(
                "favorite/group/{}/{}/{}",
                encode_path_segment(type_name),
                encode_path_segment(&group),
                encode_path_segment(&owner_id)
            ),
            Some(body),
        ),
    ))
}

pub fn favorite_group_clear_input(
    endpoint: String,
    owner_id: String,
    favorite_type: VrchatFavoriteType,
    group: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let owner_id = require_text(owner_id, "VrchatFavoriteGroupClear requires ownerId.")?;
    let group = require_text(group, "VrchatFavoriteGroupClear requires group.")?;
    let type_name = favorite_type.as_str();
    Ok((
        group.clone(),
        api_input(
            endpoint,
            "DELETE",
            format!(
                "favorite/group/{}/{}/{}",
                encode_path_segment(type_name),
                encode_path_segment(&group),
                encode_path_segment(&owner_id)
            ),
            None,
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use vrcx_0_contracts::vrchat_api::VrchatRequestBody;

    fn json_body(request: &VrchatRequest) -> &Value {
        request.body.as_json().expect("expected JSON request body")
    }

    #[test]
    fn favorite_reads_keep_paging_and_only_non_empty_filters() {
        let limits = favorite_limits_get_input("endpoint".into());
        assert_eq!(limits.path.as_deref(), Some("auth/user/favoritelimits"));
        assert_eq!(limits.method.as_deref(), Some("GET"));

        let favorites = favorites_get_input("endpoint".into(), 50, 100);
        assert_eq!(favorites.path.as_deref(), Some("favorites"));
        assert_eq!(
            favorites.query_params,
            Some(HashMap::from([
                ("n".into(), json!(50)),
                ("offset".into(), json!(100)),
            ]))
        );

        let worlds = favorite_worlds_get_input(
            "endpoint".into(),
            25,
            75,
            " usr_owner ".into(),
            "   ".into(),
            " tag/name ".into(),
        );
        assert_eq!(worlds.path.as_deref(), Some("worlds/favorites"));
        assert_eq!(
            worlds.query_params,
            Some(HashMap::from([
                ("n".into(), json!(25)),
                ("offset".into(), json!(75)),
                ("ownerId".into(), json!("usr_owner")),
                ("tag".into(), json!("tag/name")),
            ]))
        );

        let avatars = favorite_avatars_get_input("endpoint".into(), 10, 20, "  avatar1  ".into());
        assert_eq!(avatars.path.as_deref(), Some("avatars/favorites"));
        assert_eq!(
            avatars.query_params,
            Some(HashMap::from([
                ("n".into(), json!(10)),
                ("offset".into(), json!(20)),
                ("tag".into(), json!("avatar1")),
            ]))
        );

        let groups = favorite_groups_get_input("endpoint".into(), 40, 80, "   ".into());
        assert_eq!(groups.path.as_deref(), Some("favorite/groups"));
        assert_eq!(
            groups.query_params,
            Some(HashMap::from([
                ("n".into(), json!(40)),
                ("offset".into(), json!(80)),
            ]))
        );
    }

    #[test]
    fn favorite_mutations_trim_required_values_and_build_legacy_contracts() {
        let (type_name, favorite_id, add) = favorite_add_input(
            "endpoint".into(),
            VrchatFavoriteType::World,
            " wrld_1 ".into(),
            " worlds1 ".into(),
        )
        .unwrap();
        assert_eq!(
            (type_name.as_str(), favorite_id.as_str()),
            ("world", "wrld_1")
        );
        assert_eq!(add.method.as_deref(), Some("POST"));
        assert_eq!(add.path.as_deref(), Some("favorites"));
        assert_eq!(
            json_body(&add),
            &json!({ "type": "world", "favoriteId": "wrld_1", "tags": "worlds1" })
        );

        let (object_id, delete) =
            favorite_delete_input("endpoint".into(), " fav/id 雪 ".into()).unwrap();
        assert_eq!(object_id, "fav/id 雪");
        assert_eq!(delete.method.as_deref(), Some("DELETE"));
        assert_eq!(
            delete.path.as_deref(),
            Some("favorites/fav%2Fid%20%E9%9B%AA")
        );
        assert_eq!(delete.body, VrchatRequestBody::Empty);

        let (group, save) = favorite_group_save_input(
            "endpoint".into(),
            " usr/owner ".into(),
            VrchatFavoriteType::World,
            " group 雪 ".into(),
            Some("Display name".into()),
            Some(FavoriteGroupVisibility::Friends),
        )
        .unwrap();
        assert_eq!(group, "group 雪");
        assert_eq!(save.method.as_deref(), Some("PUT"));
        assert_eq!(
            save.path.as_deref(),
            Some("favorite/group/world/group%20%E9%9B%AA/usr%2Fowner")
        );
        assert_eq!(
            json_body(&save),
            &json!({
                "type": "world",
                "group": "group 雪",
                "displayName": "Display name",
                "visibility": "friends",
            })
        );

        let (group, clear) = favorite_group_clear_input(
            "endpoint".into(),
            " usr/owner ".into(),
            VrchatFavoriteType::World,
            " group 雪 ".into(),
        )
        .unwrap();
        assert_eq!(group, "group 雪");
        assert_eq!(clear.method.as_deref(), Some("DELETE"));
        assert_eq!(
            clear.path.as_deref(),
            Some("favorite/group/world/group%20%E9%9B%AA/usr%2Fowner")
        );
        assert_eq!(clear.body, VrchatRequestBody::Empty);
    }

    #[test]
    fn favorite_mutations_reject_blank_required_values() {
        assert!(favorite_add_input(
            "".into(),
            VrchatFavoriteType::World,
            " ".into(),
            "tag".into(),
        )
        .is_err());
        assert!(favorite_add_input(
            "".into(),
            VrchatFavoriteType::World,
            "id".into(),
            " ".into(),
        )
        .is_err());
        assert!(serde_json::from_str::<VrchatFavoriteType>(r#""unsupported""#).is_err());
        assert!(favorite_delete_input("".into(), " ".into()).is_err());
        assert!(favorite_group_save_input(
            "".into(),
            " ".into(),
            VrchatFavoriteType::World,
            "group".into(),
            None,
            None,
        )
        .is_err());
        assert!(favorite_group_save_input(
            "".into(),
            "owner".into(),
            VrchatFavoriteType::World,
            " ".into(),
            None,
            None,
        )
        .is_err());
        assert!(favorite_group_clear_input(
            "".into(),
            "owner".into(),
            VrchatFavoriteType::World,
            " ".into(),
        )
        .is_err());
    }
}
