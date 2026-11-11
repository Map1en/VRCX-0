use std::collections::HashMap;

use serde_json::{json, Value};

use crate::http_api::{api_input, encode_path_segment, get_input, require_text, HttpApiError};
use crate::query::{QueryOrder, ReleaseStatusFilter, WorldSearchSort};
use vrcx_0_contracts::vrchat_api::VrchatRequest;

pub use vrcx_0_contracts::vrchat_requests::{WorldRatingValue, WorldUpdateRequest};

pub fn world_get_input(
    endpoint: String,
    world_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let world_id = require_text(world_id, "VrchatWorldGet requires worldId.")?;
    Ok((
        world_id.clone(),
        get_input(
            endpoint,
            format!("worlds/{}", encode_path_segment(&world_id)),
            HashMap::new(),
        ),
    ))
}

pub fn world_list_by_user_get_input(
    endpoint: String,
    user_id: String,
    n: i32,
    offset: i32,
    sort: WorldSearchSort,
    order: QueryOrder,
    release_status: ReleaseStatusFilter,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let user_id = require_text(user_id, "VrchatWorldListByUserGet requires userId.")?;
    Ok((
        user_id.clone(),
        get_input(
            endpoint,
            "worlds",
            HashMap::from([
                ("n".to_string(), json!(n)),
                ("offset".to_string(), json!(offset)),
                ("sort".to_string(), Value::String(sort.as_str().into())),
                ("order".to_string(), Value::String(order.as_str().into())),
                ("userId".to_string(), Value::String(user_id)),
                (
                    "releaseStatus".to_string(),
                    Value::String(release_status.as_str().into()),
                ),
            ]),
        ),
    ))
}

pub fn world_persistent_data_exists_input(
    endpoint: String,
    user_id: String,
    world_id: String,
) -> Result<(String, String, VrchatRequest), HttpApiError> {
    let user_id = require_text(user_id, "VrchatWorldPersistentDataExists requires userId.")?;
    let world_id = require_text(
        world_id,
        "VrchatWorldPersistentDataExists requires worldId.",
    )?;
    Ok((
        user_id.clone(),
        world_id.clone(),
        get_input(
            endpoint,
            format!(
                "users/{}/{}/persist/exists",
                encode_path_segment(&user_id),
                encode_path_segment(&world_id)
            ),
            HashMap::new(),
        ),
    ))
}

pub fn world_save_input(
    endpoint: String,
    world_id: String,
    params: WorldUpdateRequest,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let world_id = require_text(world_id, "VrchatWorldSave requires worldId.")?;
    if params.id != world_id {
        return Err(HttpApiError::Custom(
            "VrchatWorldSave params.id must match worldId.".into(),
        ));
    }
    Ok((
        world_id.clone(),
        api_input(
            endpoint,
            "PUT",
            format!("worlds/{}", encode_path_segment(&world_id)),
            Some(json!(params)),
        ),
    ))
}

pub fn world_delete_input(
    endpoint: String,
    world_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let world_id = require_text(world_id, "VrchatWorldDelete requires worldId.")?;
    Ok((
        world_id.clone(),
        api_input(
            endpoint,
            "DELETE",
            format!("worlds/{}", encode_path_segment(&world_id)),
            None,
        ),
    ))
}

pub fn world_publish_input(
    endpoint: String,
    world_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let world_id = require_text(world_id, "VrchatWorldPublish requires worldId.")?;
    Ok((
        world_id.clone(),
        api_input(
            endpoint,
            "PUT",
            format!("worlds/{}/publish", encode_path_segment(&world_id)),
            Some(json!({ "worldId": world_id })),
        ),
    ))
}

pub fn world_unpublish_input(
    endpoint: String,
    world_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let world_id = require_text(world_id, "VrchatWorldUnpublish requires worldId.")?;
    Ok((
        world_id.clone(),
        api_input(
            endpoint,
            "DELETE",
            format!("worlds/{}/publish", encode_path_segment(&world_id)),
            None,
        ),
    ))
}

pub fn world_rating_get_input(
    endpoint: String,
    world_id: String,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let world_id = require_text(world_id, "VrchatWorldRatingGet requires worldId.")?;
    Ok((
        world_id.clone(),
        get_input(
            endpoint,
            format!("worlds/{}/rating", encode_path_segment(&world_id)),
            HashMap::new(),
        ),
    ))
}

pub fn world_rating_set_input(
    endpoint: String,
    world_id: String,
    value: Option<WorldRatingValue>,
) -> Result<(String, VrchatRequest), HttpApiError> {
    let world_id = require_text(world_id, "VrchatWorldRatingSet requires worldId.")?;
    let path = format!("worlds/{}/rating", encode_path_segment(&world_id));
    let request = match value {
        Some(value) => api_input(endpoint, "PUT", path, Some(json!({ "value": value }))),
        None => api_input(endpoint, "DELETE", path, None),
    };
    Ok((world_id, request))
}

pub fn world_persistent_data_delete_input(
    endpoint: String,
    user_id: String,
    world_id: String,
) -> Result<(String, String, VrchatRequest), HttpApiError> {
    let user_id = require_text(user_id, "VrchatWorldPersistentDataDelete requires userId.")?;
    let world_id = require_text(
        world_id,
        "VrchatWorldPersistentDataDelete requires worldId.",
    )?;
    Ok((
        user_id.clone(),
        world_id.clone(),
        api_input(
            endpoint,
            "DELETE",
            format!(
                "users/{}/{}/persist",
                encode_path_segment(&user_id),
                encode_path_segment(&world_id)
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
    fn world_reads_trim_ids_and_preserve_list_filters() {
        let (world_id, world) = world_get_input("endpoint".into(), " wrld/雪 ".into()).unwrap();
        assert_eq!(world_id, "wrld/雪");
        assert_eq!(world.method.as_deref(), Some("GET"));
        assert_eq!(world.path.as_deref(), Some("worlds/wrld%2F%E9%9B%AA"));

        let (user_id, list) = world_list_by_user_get_input(
            "endpoint".into(),
            " usr/1 ".into(),
            50,
            100,
            WorldSearchSort::Updated,
            QueryOrder::Descending,
            ReleaseStatusFilter::All,
        )
        .unwrap();
        assert_eq!(user_id, "usr/1");
        assert_eq!(list.path.as_deref(), Some("worlds"));
        assert_eq!(
            list.query_params,
            Some(HashMap::from([
                ("n".into(), json!(50)),
                ("offset".into(), json!(100)),
                ("sort".into(), json!("updated")),
                ("order".into(), json!("descending")),
                ("userId".into(), json!("usr/1")),
                ("releaseStatus".into(), json!("all")),
            ]))
        );

        let (user_id, world_id, exists) = world_persistent_data_exists_input(
            "endpoint".into(),
            " usr/1 ".into(),
            " wrld/雪 ".into(),
        )
        .unwrap();
        assert_eq!((user_id.as_str(), world_id.as_str()), ("usr/1", "wrld/雪"));
        assert_eq!(exists.method.as_deref(), Some("GET"));
        assert_eq!(
            exists.path.as_deref(),
            Some("users/usr%2F1/wrld%2F%E9%9B%AA/persist/exists")
        );
    }

    #[test]
    fn world_mutations_match_the_vrcx_0_repository_contract() {
        let (_, save) = world_save_input(
            "endpoint".into(),
            " wrld/1 ".into(),
            WorldUpdateRequest {
                id: "wrld/1".into(),
                name: Some("World".into()),
                description: None,
                capacity: None,
                recommended_capacity: None,
                preview_youtube_id: None,
                tags: None,
                url_list: None,
                disabled_prop_abilities: Some(vec![
                    "player_movement".into(),
                    "future_ability".into(),
                ]),
            },
        )
        .unwrap();
        assert_eq!(save.method.as_deref(), Some("PUT"));
        assert_eq!(save.path.as_deref(), Some("worlds/wrld%2F1"));
        assert_eq!(
            json_body(&save),
            &json!({
                "id": "wrld/1",
                "name": "World",
                "disabledPropAbilities": ["player_movement", "future_ability"],
            })
        );

        let (_, delete) = world_delete_input("endpoint".into(), " wrld/1 ".into()).unwrap();
        assert_eq!(delete.method.as_deref(), Some("DELETE"));
        assert_eq!(delete.path.as_deref(), Some("worlds/wrld%2F1"));
        assert_eq!(delete.body, VrchatRequestBody::Empty);

        let (_, publish) = world_publish_input("endpoint".into(), " wrld/1 ".into()).unwrap();
        assert_eq!(publish.method.as_deref(), Some("PUT"));
        assert_eq!(publish.path.as_deref(), Some("worlds/wrld%2F1/publish"));
        assert_eq!(json_body(&publish), &json!({ "worldId": "wrld/1" }));

        let (_, unpublish) = world_unpublish_input("endpoint".into(), " wrld/1 ".into()).unwrap();
        assert_eq!(unpublish.method.as_deref(), Some("DELETE"));
        assert_eq!(unpublish.path.as_deref(), Some("worlds/wrld%2F1/publish"));
        assert_eq!(unpublish.body, VrchatRequestBody::Empty);

        let (user_id, world_id, delete_data) = world_persistent_data_delete_input(
            "endpoint".into(),
            " usr/1 ".into(),
            " wrld/雪 ".into(),
        )
        .unwrap();
        assert_eq!((user_id.as_str(), world_id.as_str()), ("usr/1", "wrld/雪"));
        assert_eq!(delete_data.method.as_deref(), Some("DELETE"));
        assert_eq!(
            delete_data.path.as_deref(),
            Some("users/usr%2F1/wrld%2F%E9%9B%AA/persist")
        );
        assert_eq!(delete_data.body, VrchatRequestBody::Empty);
    }

    #[test]
    fn world_rating_reads_puts_a_value_and_deletes_when_cleared() {
        let (world_id, get) = world_rating_get_input("endpoint".into(), " wrld/1 ".into()).unwrap();
        assert_eq!(world_id, "wrld/1");
        assert_eq!(get.method.as_deref(), Some("GET"));
        assert_eq!(get.path.as_deref(), Some("worlds/wrld%2F1/rating"));

        let (_, like) = world_rating_set_input(
            "endpoint".into(),
            "wrld/1".into(),
            Some(WorldRatingValue::Like),
        )
        .unwrap();
        assert_eq!(like.method.as_deref(), Some("PUT"));
        assert_eq!(like.path.as_deref(), Some("worlds/wrld%2F1/rating"));
        assert_eq!(json_body(&like), &json!({ "value": "like" }));

        let (_, dislike) = world_rating_set_input(
            "endpoint".into(),
            "wrld/1".into(),
            Some(WorldRatingValue::Dislike),
        )
        .unwrap();
        assert_eq!(json_body(&dislike), &json!({ "value": "dislike" }));

        let (_, clear) = world_rating_set_input("endpoint".into(), "wrld/1".into(), None).unwrap();
        assert_eq!(clear.method.as_deref(), Some("DELETE"));
        assert_eq!(clear.path.as_deref(), Some("worlds/wrld%2F1/rating"));
        assert_eq!(clear.body, VrchatRequestBody::Empty);
    }

    #[test]
    fn world_requests_reject_blank_required_ids() {
        assert!(world_get_input("".into(), " ".into()).is_err());
        assert!(world_list_by_user_get_input(
            "".into(),
            " ".into(),
            1,
            0,
            WorldSearchSort::Updated,
            QueryOrder::Descending,
            ReleaseStatusFilter::All,
        )
        .is_err());
        assert!(world_persistent_data_exists_input("".into(), "user".into(), " ".into()).is_err());
        assert!(world_save_input(
            "".into(),
            " ".into(),
            WorldUpdateRequest {
                id: String::new(),
                name: None,
                description: None,
                capacity: None,
                recommended_capacity: None,
                preview_youtube_id: None,
                tags: None,
                url_list: None,
                disabled_prop_abilities: None,
            },
        )
        .is_err());
        assert!(world_delete_input("".into(), " ".into()).is_err());
        assert!(world_publish_input("".into(), " ".into()).is_err());
        assert!(world_unpublish_input("".into(), " ".into()).is_err());
        assert!(world_rating_get_input("".into(), " ".into()).is_err());
        assert!(world_rating_set_input("".into(), " ".into(), None).is_err());
        assert!(world_persistent_data_delete_input("".into(), " ".into(), "world".into()).is_err());
    }

    #[test]
    fn world_update_request_rejects_unknown_fields() {
        assert!(serde_json::from_value::<WorldUpdateRequest>(json!({
            "id": "wrld_test",
            "releaseStatus": "public",
        }))
        .is_err());
    }
}
