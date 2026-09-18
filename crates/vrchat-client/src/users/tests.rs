use super::*;

fn json_body(request: &HttpApiRequestInput) -> &Value {
    request.body.as_json().expect("expected JSON request body")
}

#[test]
fn user_reads_trim_and_encode_ids() {
    let cases = [
        (
            "profile",
            user_get_input("endpoint".into(), " usr/雪 ".into())
                .unwrap()
                .1,
            "users/usr%2F%E9%9B%AA",
        ),
        (
            "mutual counts",
            user_mutual_counts_get_input("endpoint".into(), " usr/雪 ".into())
                .unwrap()
                .1,
            "users/usr%2F%E9%9B%AA/mutuals",
        ),
        (
            "groups",
            user_groups_get_input("endpoint".into(), " usr/雪 ".into())
                .unwrap()
                .1,
            "users/usr%2F%E9%9B%AA/groups",
        ),
        (
            "represented group",
            user_represented_group_get_input("endpoint".into(), " usr/雪 ".into())
                .unwrap()
                .1,
            "users/usr%2F%E9%9B%AA/groups/represented",
        ),
    ];

    for (name, request, expected_path) in cases {
        assert_eq!(request.method.as_deref(), Some("GET"), "{name}");
        assert_eq!(request.path.as_deref(), Some(expected_path), "{name}");
        assert_eq!(request.query_params, Some(HashMap::new()), "{name}");
    }
}

#[test]
fn profile_reads_encode_ids_and_always_send_the_self_and_expansion_queries() {
    for as_self in [false, true] {
        let (user_id, profile) =
            profile_get_input("endpoint".into(), " usr/雪 ".into(), as_self).unwrap();
        assert_eq!(user_id, "usr/雪");
        assert_eq!(profile.method.as_deref(), Some("GET"));
        assert_eq!(profile.path.as_deref(), Some("profile/usr%2F%E9%9B%AA"));
        assert_eq!(
            profile.query_params,
            Some(HashMap::from([
                ("asSelf".to_string(), json!(as_self)),
                ("withGroupsAndWorlds".to_string(), json!(true)),
            ]))
        );
    }
}

#[test]
fn mutual_friends_sends_the_user_id_query_parameter() {
    let (user_id, request) =
        user_mutual_friends_get_input("endpoint".into(), " usr/test ".into(), 100, 200).unwrap();
    let params = request.query_params.unwrap();

    assert_eq!(user_id, "usr/test");
    assert_eq!(
        request.path.as_deref(),
        Some("users/usr%2Ftest/mutuals/friends")
    );
    assert_eq!(params.get("n"), Some(&json!(100)));
    assert_eq!(params.get("offset"), Some(&json!(200)));
    assert_eq!(
        params.get("userId"),
        Some(&Value::String("usr/test".into()))
    );
}

#[test]
fn current_user_mutations_build_paths_and_json_bodies() {
    let (_, profile) = profile_update_input(
        "endpoint".into(),
        " usr/1 ".into(),
        CurrentUserProfileUpdateRequest {
            background_type: Some(ProfileBackgroundType::Gradient),
            background_gradient_top: Some("5d3f86".into()),
            background_gradient_bottom: Some("21385B".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(profile.method.as_deref(), Some("PUT"));
    assert_eq!(profile.path.as_deref(), Some("profile/usr%2F1"));
    assert_eq!(
        json_body(&profile),
        &json!({
            "backgroundType": "gradient",
            "backgroundGradientTop": "5d3f86",
            "backgroundGradientBottom": "21385B",
        })
    );

    let (_, profile_details) = profile_update_input(
        "endpoint".into(),
        "usr_1".into(),
        CurrentUserProfileUpdateRequest {
            bio: Some("hello".into()),
            bio_links: Some(vec!["https://example.test".into()]),
            user_icon: Some(String::new()),
            banner_type: Some(ProfileBannerType::CustomImage),
            banner_custom_url: Some("https://files/file_banner/1".into()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        json_body(&profile_details),
        &json!({
            "bio": "hello",
            "bioLinks": ["https://example.test"],
            "userIcon": "",
            "bannerType": "customImage",
            "bannerCustomUrl": "https://files/file_banner/1",
        })
    );

    let (_, update_default) = current_user_update_input(
        "endpoint".into(),
        " usr/1 ".into(),
        CurrentUserUpdateRequest::default(),
    )
    .unwrap();
    assert_eq!(update_default.method.as_deref(), Some("PUT"));
    assert_eq!(update_default.path.as_deref(), Some("users/usr%2F1"));
    assert_eq!(json_body(&update_default), &json!({}));

    let (_, update) = current_user_update_input(
        "endpoint".into(),
        " usr/1 ".into(),
        CurrentUserUpdateRequest {
            status: Some(vrcx_0_core::friends::UserStatus::AskMe),
            content_filters: Some(vec![ContentFilter::Horror, ContentFilter::Violence]),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        json_body(&update),
        &json!({
            "status": "ask me",
            "contentFilters": ["content_horror", "content_violence"],
        })
    );

    let (user_id, badge_id, badge) = current_user_badge_update_input(
        "endpoint".into(),
        " usr/1 ".into(),
        " bdg 雪 ".into(),
        true,
        false,
    )
    .unwrap();
    assert_eq!((user_id.as_str(), badge_id.as_str()), ("usr/1", "bdg 雪"));
    assert_eq!(badge.method.as_deref(), Some("PUT"));
    assert_eq!(
        badge.path.as_deref(),
        Some("users/usr%2F1/badges/bdg%20%E9%9B%AA")
    );
    assert_eq!(
        json_body(&badge),
        &json!({
            "userId": "usr/1",
            "badgeId": "bdg 雪",
            "hidden": true,
            "showcased": false,
        })
    );

    for (name, request, suffix) in [
        (
            "add",
            current_user_tags_add_input(
                "endpoint".into(),
                " usr/1 ".into(),
                vec!["system_1".into(), "system_2".into()],
            )
            .unwrap()
            .1,
            "addTags",
        ),
        (
            "remove",
            current_user_tags_remove_input(
                "endpoint".into(),
                " usr/1 ".into(),
                vec!["system_1".into(), "system_2".into()],
            )
            .unwrap()
            .1,
            "removeTags",
        ),
    ] {
        assert_eq!(request.method.as_deref(), Some("POST"), "{name}");
        assert_eq!(
            request.path.as_deref(),
            Some(format!("users/usr%2F1/{suffix}").as_str()),
            "{name}"
        );
        assert_eq!(
            json_body(&request),
            &json!({ "tags": ["system_1", "system_2"] }),
            "{name}"
        );
    }
}

#[test]
fn user_requests_reject_blank_required_ids() {
    assert!(user_get_input("".into(), " ".into()).is_err());
    assert!(profile_get_input("".into(), " ".into(), false).is_err());
    assert!(profile_update_input(
        "".into(),
        " ".into(),
        CurrentUserProfileUpdateRequest::default(),
    )
    .is_err());
    assert!(user_mutual_counts_get_input("".into(), " ".into()).is_err());
    assert!(user_groups_get_input("".into(), " ".into()).is_err());
    assert!(user_represented_group_get_input("".into(), " ".into()).is_err());
    assert!(user_mutual_friends_get_input("".into(), " ".into(), 1, 0).is_err());
    assert!(
        current_user_update_input("".into(), " ".into(), CurrentUserUpdateRequest::default(),)
            .is_err()
    );
    assert!(
        current_user_badge_update_input("".into(), "user".into(), " ".into(), false, false,)
            .is_err()
    );
    assert!(current_user_tags_add_input("".into(), " ".into(), vec![]).is_err());
    assert!(current_user_tags_remove_input("".into(), " ".into(), vec![]).is_err());
}

#[test]
fn current_user_requests_reject_unknown_fields_and_statuses() {
    assert!(serde_json::from_value::<CurrentUserUpdateRequest>(json!({
        "displayName": "unsupported here",
    }))
    .is_err());
    assert!(serde_json::from_value::<CurrentUserUpdateRequest>(json!({
        "bio": "profile-owned now",
    }))
    .is_err());
    assert!(serde_json::from_value::<CurrentUserUpdateRequest>(json!({
        "status": "future",
    }))
    .is_err());
    assert!(serde_json::from_value::<CurrentUserUpdateRequest>(json!({
        "contentFilters": ["content_future"],
    }))
    .is_err());
    assert!(
        serde_json::from_value::<CurrentUserProfileUpdateRequest>(json!({
            "backgroundType": "texture",
            "backgroundTextureId": "file_test",
            "futureField": true,
        }))
        .is_err()
    );
}
