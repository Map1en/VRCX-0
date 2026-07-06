use super::*;

#[test]
fn avatar_search_contract_sets_expected_headers() {
    let input = avatar_search_get_input("https://avatars.example.test/search?q=robot", "abc");

    assert_eq!(
        input.url.as_deref(),
        Some("https://avatars.example.test/search?q=robot")
    );
    assert_eq!(input.method.as_deref(), Some("GET"));
    let headers = input.headers.unwrap();
    assert_eq!(
        headers.get("Referer").map(String::as_str),
        Some("https://vrcx.app")
    );
    assert_eq!(headers.get("VRCX-ID").map(String::as_str), Some("abc"));
}

#[test]
fn translation_contract_preserves_raw_body_mode() {
    let input = translation_request_input(
        "https://translate.example.test/v1/chat",
        "POST",
        HashMap::from([("Content-Type".into(), "application/json".into())]),
        json!({ "messages": [{ "content": "hello" }] }),
    )
    .unwrap();

    assert_eq!(input.method.as_deref(), Some("POST"));
    assert_eq!(input.json_body, Some(false));
    assert_eq!(
        input.body,
        Some(json!({ "messages": [{ "content": "hello" }] }))
    );
}

#[test]
fn translation_contract_rejects_unexpected_methods() {
    let result = translation_request_input(
        "https://translate.example.test/v1/chat",
        "PUT",
        HashMap::new(),
        Value::Null,
    );

    assert!(result.is_err());
}

#[test]
fn youtube_contract_builds_fixed_endpoint_and_query() {
    let input = youtube_video_metadata_get_input("video id", "key/1");
    let request =
        build_web_execute_request(input, ExternalApiScope::Youtube).expect("youtube request");
    let url = Url::parse(&request.url).unwrap();
    let query = url.query_pairs().into_owned().collect::<HashMap<_, _>>();

    assert_eq!(
        url.origin().unicode_serialization(),
        "https://www.googleapis.com"
    );
    assert_eq!(url.path(), "/youtube/v3/videos");
    assert_eq!(query.get("id").map(String::as_str), Some("video id"));
    assert_eq!(
        query.get("part").map(String::as_str),
        Some("snippet,contentDetails")
    );
    assert_eq!(query.get("key").map(String::as_str), Some("key/1"));
}

#[test]
fn status_contract_uses_status_origin_and_referer() {
    let input = vrc_status_json_get_input("/status.json");

    assert_eq!(
        input.url.as_deref(),
        Some("https://status.vrchat.com/api/v2/status.json")
    );
    assert_eq!(
        input.headers.unwrap().get("Referer").map(String::as_str),
        Some("https://vrcx.app")
    );
}

#[test]
fn configured_request_origins_allow_http_and_https() {
    assert_eq!(
        request_origin("https://example.com/api"),
        Some("https://example.com".into())
    );
    assert_eq!(
        request_origin("http://example.com/api"),
        Some("http://example.com".into())
    );
    assert_eq!(
        request_origin("http://localhost:8123/api"),
        Some("http://localhost:8123".into())
    );
    assert_eq!(
        request_origin("https://10.0.0.5/api"),
        Some("https://10.0.0.5".into())
    );
    assert_eq!(request_origin("ftp://example.com/api"), None);
}

#[test]
fn external_scopes_allow_any_http_and_https_url() {
    let policy = ExternalApiPolicy;
    let request = ExternalHttpRequestInput {
        url: Some("http://localhost:8123/search".into()),
        ..Default::default()
    };
    assert!(build_web_execute_request_with_policy(
        request,
        ExternalApiScope::AvatarSearch,
        &policy
    )
    .is_ok());

    let request = ExternalHttpRequestInput {
        url: Some("http://example.com/v1/chat/completions".into()),
        ..Default::default()
    };
    assert!(
        build_web_execute_request_with_policy(request, ExternalApiScope::Translation, &policy)
            .is_ok()
    );

    let request = ExternalHttpRequestInput {
        url: Some("http://10.0.0.5/image.png".into()),
        ..Default::default()
    };
    assert!(
        build_web_execute_request_with_policy(request, ExternalApiScope::Image, &policy).is_ok()
    );

    let request = ExternalHttpRequestInput {
        url: Some("ftp://example.com/search".into()),
        ..Default::default()
    };
    assert!(build_web_execute_request_with_policy(
        request,
        ExternalApiScope::AvatarSearch,
        &policy
    )
    .is_err());
}

#[test]
fn fixed_external_scopes_keep_origin_and_path_restrictions() {
    let policy = ExternalApiPolicy;

    assert!(build_web_execute_request_with_policy(
        ExternalHttpRequestInput {
            url: Some("https://www.googleapis.com/youtube/v3/videos?id=video".into()),
            ..Default::default()
        },
        ExternalApiScope::Youtube,
        &policy,
    )
    .is_ok());
    assert!(build_web_execute_request_with_policy(
        ExternalHttpRequestInput {
            url: Some("https://www.googleapis.com/custom/v3/videos?id=video".into()),
            ..Default::default()
        },
        ExternalApiScope::Youtube,
        &policy,
    )
    .is_err());

    assert!(build_web_execute_request_with_policy(
        ExternalHttpRequestInput {
            url: Some("https://status.vrchat.com/api/v2/status.json".into()),
            ..Default::default()
        },
        ExternalApiScope::VrcStatus,
        &policy,
    )
    .is_ok());
    assert!(build_web_execute_request_with_policy(
        ExternalHttpRequestInput {
            url: Some("https://status.vrchat.com/api/v2/../status.json".into()),
            ..Default::default()
        },
        ExternalApiScope::VrcStatus,
        &policy,
    )
    .is_err());
    assert!(build_web_execute_request_with_policy(
        ExternalHttpRequestInput {
            url: Some("http://status.vrchat.com/api/v2/status.json".into()),
            ..Default::default()
        },
        ExternalApiScope::VrcStatus,
        &policy,
    )
    .is_err());

    assert!(build_web_execute_request_with_policy(
        ExternalHttpRequestInput {
            url: Some("https://api.github.com/repos/vrcx-team/VRCX/releases".into()),
            ..Default::default()
        },
        ExternalApiScope::UpdateRelease,
        &policy,
    )
    .is_ok());
    assert!(build_web_execute_request_with_policy(
        ExternalHttpRequestInput {
            url: Some("https://github.com/repos/vrcx-team/VRCX/releases".into()),
            ..Default::default()
        },
        ExternalApiScope::UpdateRelease,
        &policy,
    )
    .is_err());

    assert!(build_web_execute_request_with_policy(
        ExternalHttpRequestInput {
            url: Some("https://api.github.com/repos/Map1en/VRCX-0/contributors".into()),
            ..Default::default()
        },
        ExternalApiScope::GithubContributors,
        &policy,
    )
    .is_ok());
    assert!(build_web_execute_request_with_policy(
        ExternalHttpRequestInput {
            url: Some("https://api.github.com/repos/Map1en/VRCX-0/releases".into()),
            ..Default::default()
        },
        ExternalApiScope::GithubContributors,
        &policy,
    )
    .is_err());
    assert!(build_web_execute_request_with_policy(
        ExternalHttpRequestInput {
            url: Some("https://github.com/repos/Map1en/VRCX-0/contributors".into()),
            ..Default::default()
        },
        ExternalApiScope::GithubContributors,
        &policy,
    )
    .is_err());
}

#[test]
fn translation_scope_allows_bearer_authorization_header() {
    let policy = ExternalApiPolicy::with_allowed_origins(["https://api.openai.com"]);
    let request = ExternalHttpRequestInput {
        url: Some("https://api.openai.com/v1/chat/completions".into()),
        method: Some("POST".into()),
        headers: Some(HashMap::from([(
            "Authorization".to_string(),
            "Bearer test-token".to_string(),
        )])),
        body: Some(json!({ "messages": [] })),
        ..Default::default()
    };

    let request =
        build_web_execute_request_with_policy(request, ExternalApiScope::Translation, &policy)
            .expect("translation authorization header");

    assert!(request
        .headers
        .iter()
        .any(|(name, value)| name == "Authorization" && value == "Bearer test-token"));
}

#[test]
fn translation_scope_allows_deepl_authorization_header() {
    let policy = ExternalApiPolicy::with_allowed_origins(["https://api-free.deepl.com"]);
    let request = ExternalHttpRequestInput {
        url: Some("https://api-free.deepl.com/v2/translate".into()),
        method: Some("POST".into()),
        headers: Some(HashMap::from([(
            "Authorization".to_string(),
            "DeepL-Auth-Key test-token".to_string(),
        )])),
        body: Some(json!({ "text": ["hello"], "target_lang": "JA" })),
        ..Default::default()
    };

    let request =
        build_web_execute_request_with_policy(request, ExternalApiScope::Translation, &policy)
            .expect("translation DeepL authorization header");

    assert!(request
        .headers
        .iter()
        .any(|(name, value)| name == "Authorization" && value == "DeepL-Auth-Key test-token"));
}

#[test]
fn non_translation_scopes_reject_authorization_header() {
    let policy = ExternalApiPolicy::with_allowed_origins(["https://example.com"]);
    let request = ExternalHttpRequestInput {
        url: Some("https://example.com/search".into()),
        headers: Some(HashMap::from([(
            "Authorization".to_string(),
            "Bearer test-token".to_string(),
        )])),
        ..Default::default()
    };

    assert!(build_web_execute_request_with_policy(
        request,
        ExternalApiScope::AvatarSearch,
        &policy,
    )
    .is_err());
}
