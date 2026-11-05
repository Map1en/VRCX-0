use super::*;
use crate::http_api::build_web_execute_request;
use url::Url;
use vrcx_0_contracts::vrchat_api::VrchatScope;

const ENDPOINT: &str = "https://api.vrchat.cloud/api/1";

fn query_pairs(url: &str) -> HashMap<String, String> {
    Url::parse(url)
        .unwrap()
        .query_pairs()
        .map(|(key, value)| (key.to_string(), value.to_string()))
        .collect()
}

fn list_by_user_input(user_id: &str, user: &str) -> AvatarListByUserGetInput {
    AvatarListByUserGetInput {
        endpoint: ENDPOINT.into(),
        user_id: user_id.into(),
        user: user.into(),
        n: 60,
        offset: 0,
        sort: AvatarListSort::Updated,
        order: QueryOrder::Descending,
        release_status: ReleaseStatusFilter::All,
    }
}

#[test]
fn avatar_get_rejects_blank_avatar_id() {
    let error = avatar_get_input(ENDPOINT.into(), "  ".into()).unwrap_err();

    assert!(
        matches!(error, HttpApiError::Custom(message) if message == "VrchatAvatarGet requires avatarId.")
    );
}

#[test]
fn avatar_list_by_user_prefers_user_over_user_id() {
    let (display, input) =
        avatar_list_by_user_get_input(list_by_user_input("usr_id_value", " display_name "))
            .unwrap();

    assert_eq!(display, "display_name");
    let request = build_web_execute_request(input, VrchatScope::Vrchat).unwrap();
    let params = query_pairs(&request.url);
    assert_eq!(params.get("user"), Some(&"display_name".to_string()));
    assert_eq!(params.get("userId"), None);
}

#[test]
fn avatar_list_by_user_falls_back_to_user_id_when_user_blank() {
    let (display, input) =
        avatar_list_by_user_get_input(list_by_user_input(" usr_id_value ", "  ")).unwrap();

    assert_eq!(display, "usr_id_value");
    let request = build_web_execute_request(input, VrchatScope::Vrchat).unwrap();
    let params = query_pairs(&request.url);
    assert_eq!(params.get("userId"), Some(&"usr_id_value".to_string()));
    assert_eq!(params.get("user"), None);
}

#[test]
fn avatar_list_by_user_requires_user_or_user_id() {
    let error = avatar_list_by_user_get_input(list_by_user_input("  ", "  ")).unwrap_err();

    assert!(matches!(
        error,
        HttpApiError::Custom(message)
            if message == "VrchatAvatarListByUserGet requires user or userId."
    ));
}

#[test]
fn avatar_moderation_send_uses_block_type() {
    let (avatar_id, input) =
        avatar_moderation_send_input(ENDPOINT.into(), " avtr_test ".into()).unwrap();

    assert_eq!(avatar_id, "avtr_test");
    let request = build_web_execute_request(input, VrchatScope::Vrchat).unwrap();
    assert_eq!(
        request.body.as_deref(),
        Some(r#"{"avatarModerationType":"block","targetAvatarId":"avtr_test"}"#)
    );
}

#[test]
fn avatar_moderation_delete_uses_block_type_and_query_params() {
    let (avatar_id, input) =
        avatar_moderation_delete_input(ENDPOINT.into(), " avtr_test ".into()).unwrap();

    assert_eq!(avatar_id, "avtr_test");
    let request = build_web_execute_request(input, VrchatScope::Vrchat).unwrap();
    assert_eq!(request.method, "DELETE");
    let params = query_pairs(&request.url);
    assert_eq!(
        params.get("avatarModerationType"),
        Some(&"block".to_string())
    );
    assert_eq!(params.get("targetAvatarId"), Some(&"avtr_test".to_string()));
    assert!(request.body.is_none());
}

#[test]
fn avatar_save_uses_typed_params_as_body() {
    let input = avatar_save_input(
        ENDPOINT.into(),
        "avtr_test".into(),
        AvatarUpdateRequest {
            id: "avtr_test".into(),
            name: Some("New Name".into()),
            description: None,
            primary_style: None,
            secondary_style: None,
            tags: None,
            release_status: None,
        },
    )
    .unwrap()
    .1;

    let request = build_web_execute_request(input, VrchatScope::Vrchat).unwrap();
    assert_eq!(
        request.body.as_deref(),
        Some(r#"{"id":"avtr_test","name":"New Name"}"#)
    );
}

#[test]
fn avatar_save_rejects_a_body_id_that_does_not_match_the_path() {
    assert!(avatar_save_input(
        ENDPOINT.into(),
        "avtr_test".into(),
        AvatarUpdateRequest {
            id: "avtr_other".into(),
            name: None,
            description: None,
            primary_style: None,
            secondary_style: None,
            tags: None,
            release_status: None,
        },
    )
    .is_err());
}

#[test]
fn avatar_update_request_rejects_unknown_fields_and_release_statuses() {
    assert!(serde_json::from_value::<AvatarUpdateRequest>(json!({
        "id": "avtr_test",
        "futureField": true,
    }))
    .is_err());
    assert!(serde_json::from_value::<AvatarUpdateRequest>(json!({
        "id": "avtr_test",
        "releaseStatus": "hidden",
    }))
    .is_err());
}

#[test]
fn avatar_selection_sends_avatar_id_as_json() {
    let cases = [
        (
            "select",
            avatar_select_input(ENDPOINT.into(), " avtr_test ".into())
                .unwrap()
                .1,
        ),
        (
            "selectfallback",
            avatar_select_fallback_input(ENDPOINT.into(), " avtr_test ".into())
                .unwrap()
                .1,
        ),
    ];

    for (path, input) in cases {
        let request = build_web_execute_request(input, VrchatScope::Vrchat).unwrap();

        assert_eq!(request.method, "PUT");
        assert_eq!(
            request.url,
            format!("{ENDPOINT}/avatars/avtr%5Ftest/{path}")
        );
        assert_eq!(request.body.as_deref(), Some(r#"{"avatarId":"avtr_test"}"#));
        assert!(request.headers.contains(&(
            "Content-Type".into(),
            "application/json;charset=utf-8".into()
        )));
    }
}

#[test]
fn avatar_impostor_enqueue_sends_the_legacy_empty_json_body() {
    let input = avatar_impostor_create_input(ENDPOINT.into(), " avtr_test ".into())
        .unwrap()
        .1;

    let request = build_web_execute_request(input, VrchatScope::Vrchat).unwrap();

    assert_eq!(request.method, "POST");
    assert_eq!(
        request.url,
        format!("{ENDPOINT}/avatars/avtr%5Ftest/impostor/enqueue")
    );
    assert_eq!(request.body.as_deref(), Some("{}"));
    assert!(request.headers.contains(&(
        "Content-Type".into(),
        "application/json;charset=utf-8".into()
    )));
}
