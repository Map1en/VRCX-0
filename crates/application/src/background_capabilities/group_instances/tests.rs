use super::*;

#[test]
fn group_id_uses_nested_group_before_top_level_owner_and_location() {
    let instance = json!({
        "group": { "groupId": " grp_nested " },
        "instance": {
            "group": { "id": "grp_instance_nested" },
            "groupId": "grp_instance_top",
            "ownerId": "grp_instance_owner"
        },
        "groupId": "grp_top",
        "ownerId": "grp_owner",
        "location": "wrld_test:1~group(grp_location)~groupAccessType(plus)"
    });

    assert_eq!(normalize_group_instance_group_id(&instance), "grp_nested");
}

#[test]
fn group_id_falls_through_sources_in_priority_order() {
    let cases = [
        (
            json!({
                "group": { "groupId": "usr_not_group" },
                "instance": { "group": { "id": "grp_nested" } },
                "groupId": "grp_top",
                "ownerId": "grp_owner",
                "location": "wrld_test:1~group(grp_location)"
            }),
            "grp_nested",
        ),
        (
            json!({
                "groupId": " grp_top ",
                "ownerId": "grp_owner",
                "location": "wrld_test:1~group(grp_location)"
            }),
            "grp_top",
        ),
        (
            json!({
                "groupId": "usr_not_group",
                "ownerId": " grp_owner ",
                "location": "wrld_test:1~group(grp_location)"
            }),
            "grp_owner",
        ),
        (
            json!({
                "ownerId": "usr_owner",
                "location": "wrld_test:1~group(grp_location)~groupAccessType(plus)"
            }),
            "grp_location",
        ),
    ];

    for (instance, expected) in cases {
        assert_eq!(normalize_group_instance_group_id(&instance), expected);
    }
}

#[test]
fn complete_group_requires_id_name_and_supported_icon() {
    for icon_key in ["iconUrl", "icon", "thumbnailUrl", "imageUrl"] {
        let mut group = Map::from_iter([
            ("groupId".into(), json!("grp_complete")),
            ("name".into(), json!("Complete Group")),
        ]);
        group.insert(icon_key.into(), json!("https://example.test/icon.png"));

        assert!(has_complete_group_instance_group(&json!({
            "instance": { "group": Value::Object(group) }
        })));
    }

    for group in [
        json!({ "name": "Group", "iconUrl": "icon" }),
        json!({ "id": "grp_group", "iconUrl": "icon" }),
        json!({ "id": "grp_group", "name": "Group" }),
        json!({ "id": " ", "name": "Group", "iconUrl": "icon" }),
        json!({ "id": "grp_group", "name": " ", "iconUrl": "icon" }),
        json!({ "id": "grp_group", "name": "Group", "iconUrl": " " }),
    ] {
        assert!(!has_complete_group_instance_group(
            &json!({ "group": group })
        ));
    }
}

#[test]
fn merge_prefers_existing_fields_and_fills_missing_fields_from_fetched_group() {
    let merged = merge_group_instance_group(
        Some(json!({
            "groupId": "grp_group",
            "name": "Existing Name",
            "description": "Existing Description",
            "memberCount": 12
        })),
        Some(json!({
            "id": "grp_group",
            "name": "Fetched Name",
            "description": "Fetched Description",
            "memberCount": 99,
            "iconUrl": "https://example.test/icon.png",
            "bannerUrl": "https://example.test/banner.png"
        })),
        "grp_group",
    )
    .unwrap();

    assert_eq!(merged["id"], json!("grp_group"));
    assert_eq!(merged["groupId"], json!("grp_group"));
    assert_eq!(merged["name"], json!("Existing Name"));
    assert_eq!(merged["description"], json!("Existing Description"));
    assert_eq!(merged["memberCount"], json!(12));
    assert_eq!(merged["iconUrl"], json!("https://example.test/icon.png"));
    assert_eq!(
        merged["bannerUrl"],
        json!("https://example.test/banner.png")
    );
}

#[test]
fn merge_replaces_fallback_name_with_fetched_profile_name() {
    let merged = merge_group_instance_group(
        group_fallback("grp_group"),
        Some(json!({
            "id": "grp_group",
            "name": "Fetched Name",
            "iconUrl": "https://example.test/icon.png"
        })),
        "grp_group",
    )
    .unwrap();

    assert_eq!(merged["name"], json!("Fetched Name"));
    assert_eq!(merged["iconUrl"], json!("https://example.test/icon.png"));
}

#[test]
fn hydration_adds_minimal_fallback_when_profile_is_unavailable() {
    let instance = json!({
        "groupId": "grp_missing",
        "location": "wrld_test:1"
    });

    let hydrated = hydrate_group_instance(instance, &HashMap::new());

    assert_eq!(
        hydrated["group"],
        json!({
            "id": "grp_missing",
            "groupId": "grp_missing",
            "name": "grp_missing"
        })
    );
}

#[test]
fn hydration_leaves_instance_unchanged_without_group_id() {
    let instance = json!({
        "ownerId": "usr_owner",
        "location": "wrld_test:1"
    });

    assert_eq!(
        hydrate_group_instance(instance.clone(), &HashMap::new()),
        instance
    );
}
