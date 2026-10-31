use super::*;

#[test]
fn matches_frontend_location_parser_parity_cases() {
    let cases: Value = serde_json::from_str(include_str!(
        "../../../../src/shared/utils/locationParserParityCases.json"
    ))
    .expect("location parser parity fixture must be valid JSON");

    for case in cases
        .as_array()
        .expect("location parser parity fixture must contain an array")
    {
        let name = case["name"]
            .as_str()
            .expect("location parser parity case must have a name");
        let tag = case["tag"]
            .as_str()
            .expect("location parser parity case must have a tag");
        let parsed =
            serde_json::to_value(parse_location(tag)).expect("parsed location must serialize");

        assert_eq!(parsed, case["expected"], "{name}");
    }
}

#[test]
fn instance_key_joins_world_and_instance_and_needs_both() {
    assert_eq!(
        parse_location(" wrld_test:12345~private(usr_owner)~region(jp) ").instance_key(),
        "wrld_test:12345~private(usr_owner)~region(jp)"
    );
    assert_eq!(parse_location("wrld_test").instance_key(), "");
    assert_eq!(parse_location("offline").instance_key(), "");
}

#[test]
fn sentinels_short_circuit_without_world() {
    for (tag, is_offline, is_private, is_traveling) in [
        ("offline", true, false, false),
        ("offline:offline", true, false, false),
        ("private", false, true, false),
        ("private:private", false, true, false),
        ("traveling", false, false, true),
        ("traveling:traveling", false, false, true),
    ] {
        let parsed = parse_location(tag);
        assert_eq!(parsed.is_offline, is_offline, "{tag}");
        assert_eq!(parsed.is_private, is_private, "{tag}");
        assert_eq!(parsed.is_traveling, is_traveling, "{tag}");
        assert!(!parsed.is_real_instance, "{tag}");
        assert_eq!(parsed.world_id, "", "{tag}");
        assert_eq!(parsed.instance_id, "", "{tag}");
    }
}

#[test]
fn empty_and_local_are_not_real_instances() {
    for tag in ["", "local", "local:1234"] {
        let parsed = parse_location(tag);
        assert!(!parsed.is_real_instance, "{tag}");
        assert_eq!(parsed.world_id, "", "{tag}");
    }
}

#[test]
fn world_id_from_location_extracts_or_empties() {
    for tag in [
        "offline",
        "offline:offline",
        "private",
        "traveling",
        "local",
        "local:1234",
        "",
    ] {
        assert_eq!(world_id_from_location(tag), "", "{tag}");
    }
    assert_eq!(world_id_from_location("wrld_a:1~region(us)"), "wrld_a");
    assert_eq!(world_id_from_location("wrld_only"), "wrld_only");
    assert_eq!(world_id_from_location("  wrld_a:1  "), "wrld_a");
}

#[test]
fn public_instance_parses_world_instance_region() {
    let parsed = parse_location("wrld_abc:12345~region(use)");
    assert!(parsed.is_real_instance);
    assert_eq!(parsed.world_id, "wrld_abc");
    assert_eq!(parsed.instance_id, "12345~region(use)");
    assert_eq!(parsed.instance_name, "12345");
    assert_eq!(parsed.access_type, "public");
    assert_eq!(parsed.region, InstanceRegion::Use);
}

#[test]
fn access_types_are_derived_from_segments() {
    let invite = parse_location("wrld_a:1~private(usr_x)");
    assert_eq!(invite.access_type, "invite");
    assert_eq!(invite.user_id.as_deref(), Some("usr_x"));

    let invite_plus = parse_location("wrld_a:1~private(usr_x)~canRequestInvite");
    assert_eq!(invite_plus.access_type, "invite+");
    assert!(invite_plus.can_request_invite);

    let friends = parse_location("wrld_a:1~friends(usr_y)");
    assert_eq!(friends.access_type, "friends");
    assert_eq!(friends.user_id.as_deref(), Some("usr_y"));

    let friends_plus = parse_location("wrld_a:1~hidden(usr_z)");
    assert_eq!(friends_plus.access_type, "friends+");
    assert_eq!(friends_plus.user_id.as_deref(), Some("usr_z"));
}

#[test]
fn group_access_type_drives_name_and_normalization() {
    let plus = parse_location("wrld_a:1~group(grp_a)~groupAccessType(plus)");
    assert_eq!(plus.group_id.as_deref(), Some("grp_a"));
    assert_eq!(plus.group_access_type, Some(GroupAccessType::Plus));
    assert_eq!(plus.access_type, "group");
    assert_eq!(plus.access_type_name, "groupPlus");
    assert_eq!(normalize_instance_type(&plus), "groupPlus");

    let public = parse_location("wrld_a:1~group(grp_a)~groupAccessType(public)");
    assert_eq!(public.group_access_type, Some(GroupAccessType::Public));
    assert_eq!(public.access_type_name, "groupPublic");
    assert_eq!(normalize_instance_type(&public), "groupPublic");

    let members = parse_location("wrld_a:1~group(grp_a)~groupAccessType(members)");
    assert_eq!(members.group_access_type, Some(GroupAccessType::Members));
    assert_eq!(members.access_type_name, "group");
    assert_eq!(normalize_instance_type(&members), "groupOnly");
}

#[test]
fn unknown_group_access_type_round_trips_without_changing_behavior() {
    let parsed = parse_location("wrld_a:1~group(grp_a)~groupAccessType(future)");

    assert_eq!(
        parsed.group_access_type,
        Some(GroupAccessType::Unknown("future".into()))
    );
    assert_eq!(parsed.access_type_name, "group");
    assert_eq!(normalize_instance_type(&parsed), "groupPublic");
    assert_eq!(
        serde_json::to_value(parsed.group_access_type).unwrap(),
        json!("future")
    );
}

#[test]
fn serde_maps_known_group_access_types() {
    for (value, expected) in [
        ("members", GroupAccessType::Members),
        ("plus", GroupAccessType::Plus),
        ("public", GroupAccessType::Public),
    ] {
        let access_type: GroupAccessType = serde_json::from_value(json!(value)).unwrap();

        assert_eq!(access_type, expected, "{value}");
        assert_eq!(serde_json::to_value(access_type).unwrap(), json!(value));
    }
}

#[test]
fn serde_maps_known_instance_types() {
    for (value, expected) in [
        ("friends", InstanceType::Friends),
        ("group", InstanceType::Group),
        ("hidden", InstanceType::Hidden),
        ("private", InstanceType::Private),
        ("public", InstanceType::Public),
    ] {
        let instance_type: InstanceType = serde_json::from_value(json!(value)).unwrap();

        assert_eq!(instance_type, expected, "{value}");
        assert_eq!(serde_json::to_value(instance_type).unwrap(), json!(value));
    }
}

#[test]
fn serde_maps_known_instance_regions() {
    for (value, expected) in [
        ("eu", InstanceRegion::Eu),
        ("jp", InstanceRegion::Jp),
        ("unknown", InstanceRegion::ApiUnknown),
        ("us", InstanceRegion::Us),
        ("use", InstanceRegion::Use),
        ("usw", InstanceRegion::Usw),
        ("usx", InstanceRegion::Usx),
    ] {
        let region: InstanceRegion = serde_json::from_value(json!(value)).unwrap();

        assert_eq!(region, expected, "{value}");
        assert_eq!(serde_json::to_value(region).unwrap(), json!(value));
    }
}

#[test]
fn location_region_preserves_unknown_wire_values() {
    let parsed = parse_location("wrld_a:1~region(future)");

    assert_eq!(parsed.region, InstanceRegion::Unknown("future".into()));
    assert_eq!(
        parsed.to_frontend_value("wrld_a:1~region(future)")["region"],
        json!("future")
    );
}

#[test]
fn strict_age_gate_and_short_name() {
    let parsed = parse_location("wrld_a:1~region(eu)~strict~ageGate&shortName=ab12");
    assert!(parsed.strict);
    assert!(parsed.age_gate);
    assert_eq!(parsed.short_name, "ab12");
    assert_eq!(parsed.instance_id, "1~region(eu)~strict~ageGate");
}

#[test]
fn location_names_preserve_long_wire_values() {
    let instance_name = "instance-name-longer-than-inline-capacity";
    let short_name = "short-name-longer-than-inline-capacity";
    let location = format!("wrld_a:{instance_name}~region(eu)&shortName={short_name}");
    let parsed = parse_location(&location);

    assert_eq!(parsed.instance_name, instance_name);
    assert_eq!(parsed.short_name, short_name);
    let serialized = serde_json::to_value(parsed).unwrap();
    assert_eq!(serialized["instanceName"], json!(instance_name));
    assert_eq!(serialized["shortName"], json!(short_name));
}

#[test]
fn bare_world_id_without_instance() {
    let parsed = parse_location("wrld_only");
    assert_eq!(parsed.world_id, "wrld_only");
    assert_eq!(parsed.instance_id, "");
}

#[test]
fn frontend_value_matches_presence_contract() {
    let parsed = parse_location("wrld_a:1~group(grp_a)~groupAccessType(plus)");
    assert_eq!(
        parsed.to_frontend_value("wrld_a:1~group(grp_a)~groupAccessType(plus)"),
        json!({
            "tag": "wrld_a:1~group(grp_a)~groupAccessType(plus)",
            "isOffline": false,
            "isPrivate": false,
            "isTraveling": false,
            "isRealInstance": true,
            "worldId": "wrld_a",
            "instanceId": "1~group(grp_a)~groupAccessType(plus)",
            "instanceName": "1",
            "accessType": "group",
            "accessTypeName": "groupPlus",
            "region": "",
            "shortName": "",
            "userId": null,
            "hiddenId": null,
            "privateId": null,
            "friendsId": null,
            "groupId": "grp_a",
            "groupAccessType": "plus",
            "canRequestInvite": false,
            "strict": false,
            "ageGate": false,
        })
    );

    let public = parse_location("wrld_a:1~region(use)");
    assert_eq!(
        public.to_frontend_value("wrld_a:1~region(use)")["region"],
        json!("use")
    );

    let strict = parse_location("wrld_a:1~region(eu)~strict~ageGate&shortName=ab12");
    assert_eq!(
        strict.to_frontend_value("wrld_a:1~region(eu)~strict~ageGate&shortName=ab12")["shortName"],
        json!("ab12")
    );
    assert_eq!(
        strict.to_frontend_value("wrld_a:1~region(eu)~strict~ageGate&shortName=ab12")["strict"],
        json!(true)
    );
    assert_eq!(
        strict.to_frontend_value("wrld_a:1~region(eu)~strict~ageGate&shortName=ab12")["ageGate"],
        json!(true)
    );

    let offline = parse_location("offline");
    assert_eq!(
        offline.to_frontend_value("  offline  "),
        json!({
            "tag": "  offline  ",
            "isOffline": true,
            "isPrivate": false,
            "isTraveling": false,
            "isRealInstance": false,
            "worldId": "",
            "instanceId": "",
            "instanceName": "",
            "accessType": "",
            "accessTypeName": "",
            "region": "",
            "shortName": "",
            "userId": null,
            "hiddenId": null,
            "privateId": null,
            "friendsId": null,
            "groupId": null,
            "groupAccessType": null,
            "canRequestInvite": false,
            "strict": false,
            "ageGate": false,
        })
    );
}

#[test]
fn display_location_formats_sentinels_and_instance_access() {
    assert_eq!(
        format_display_location(&parse_location("offline"), "Ignored", ""),
        "Offline"
    );
    assert_eq!(
        format_display_location(&parse_location("private"), "Ignored", ""),
        "Private"
    );
    assert_eq!(
        format_display_location(&parse_location("traveling"), "Ignored", ""),
        "Traveling"
    );
    assert_eq!(
        format_display_location(
            &parse_location("wrld_a:1~group(grp_a)~groupAccessType(plus)"),
            "Group World",
            "Group Name",
        ),
        "Group World groupPlus(Group Name)"
    );
    assert_eq!(
        format_display_location(&parse_location("wrld_a:1~region(use)"), "Public World", ""),
        "Public World public"
    );
    assert_eq!(
        format_display_location(&parse_location("wrld_a:1"), "wrld_a", "grp_a"),
        "public"
    );
}

#[test]
fn display_location_can_format_instance_access_with_labels() {
    let labels = DisplayLocationLabels {
        public: "Public",
        invite: "Invite",
        invite_plus: "Invite+",
        friends: "Friends",
        friends_plus: "Friends+",
        group: "Group",
        group_public: "Group Public",
        group_plus: "Group+",
    };

    assert_eq!(
        format_display_location_with_labels_and_instance(
            &parse_location("wrld_a:1~group(grp_a)~groupAccessType(plus)"),
            "Group World",
            "Group Name",
            &labels,
            false,
        ),
        "Group World Group+(Group Name)"
    );
    assert_eq!(
        format_display_location_with_labels_and_instance(
            &parse_location("wrld_a:1~friends(usr_a)"),
            "Friend World",
            "",
            &labels,
            false,
        ),
        "Friend World Friends"
    );
    assert_eq!(
        format_display_location_with_labels_and_instance(
            &parse_location("wrld_a:1~hidden(usr_a)"),
            "Plus World",
            "",
            &labels,
            false,
        ),
        "Plus World Friends+"
    );
}

#[test]
fn display_location_with_instance_appends_instance_name_when_enabled() {
    assert_eq!(
        format_display_location_with_instance(
            &parse_location("wrld_a:12345~region(use)"),
            "Public World",
            "",
            true,
        ),
        "Public World public #12345"
    );
    assert_eq!(
        format_display_location_with_instance(
            &parse_location("wrld_a:12345~group(grp_a)~groupAccessType(plus)"),
            "Group World",
            "Group Name",
            true,
        ),
        "Group World groupPlus(Group Name) #12345"
    );
}

#[test]
fn display_location_with_instance_omits_suffix_when_disabled() {
    assert_eq!(
        format_display_location_with_instance(
            &parse_location("wrld_a:12345~region(use)"),
            "Public World",
            "",
            false,
        ),
        "Public World public"
    );
}

#[test]
fn display_location_with_instance_ignores_flag_for_sentinels_and_bare_world() {
    for tag in ["offline", "private", "traveling"] {
        assert_eq!(
            format_display_location_with_instance(&parse_location(tag), "Ignored", "", true),
            format_display_location(&parse_location(tag), "Ignored", "")
        );
    }
    assert_eq!(
        format_display_location_with_instance(&parse_location("wrld_only"), "Some World", "", true),
        "Some World"
    );
}

#[test]
fn display_location_with_labels_and_instance_appends_instance_name() {
    let labels = DisplayLocationLabels {
        public: "Public",
        invite: "Invite",
        invite_plus: "Invite+",
        friends: "Friends",
        friends_plus: "Friends+",
        group: "Group",
        group_public: "Group Public",
        group_plus: "Group+",
    };

    assert_eq!(
        format_display_location_with_labels_and_instance(
            &parse_location("wrld_a:12345~group(grp_a)~groupAccessType(plus)"),
            "Group World",
            "Group Name",
            &labels,
            true,
        ),
        "Group World Group+(Group Name) #12345"
    );
    assert_eq!(
        format_display_location_with_labels_and_instance(
            &parse_location("wrld_a:12345~group(grp_a)~groupAccessType(plus)"),
            "Group World",
            "Group Name",
            &labels,
            false,
        ),
        "Group World Group+(Group Name)"
    );
}

#[test]
fn access_type_label_selects_group_variants() {
    let labels = DisplayLocationLabels {
        public: "Public",
        invite: "Invite",
        invite_plus: "Invite+",
        friends: "Friends",
        friends_plus: "Friends+",
        group: "Group",
        group_public: "Group Public",
        group_plus: "Group+",
    };

    assert_eq!(
        access_type_label(
            &parse_location("wrld_a:1~group(grp_a)~groupAccessType(public)"),
            &labels,
        ),
        "Group Public"
    );
    assert_eq!(
        access_type_label(
            &parse_location("wrld_a:1~group(grp_a)~groupAccessType(plus)"),
            &labels,
        ),
        "Group+"
    );
}

#[test]
fn launch_url_includes_short_name_and_requires_instance() {
    assert_eq!(
        launch_url(&parse_location("wrld_a:1~region(use)&shortName=ab12")),
        "https://vrchat.com/home/launch?worldId=wrld_a&instanceId=1~region(use)&shortName=ab12"
    );
    assert_eq!(launch_url(&parse_location("wrld_only")), "");
}

#[test]
fn region_label_preserves_specific_uppercase_codes() {
    assert_eq!(region_label("use"), "USE");
    assert_eq!(region_label("usw"), "USW");
    assert_eq!(region_label("jp"), "JP");
    assert_eq!(region_label("  eu  "), "EU");
    assert_eq!(region_label(""), "");
}

#[test]
fn rejects_empty_local_and_sentinel_locations() {
    for location in [
        "",
        "local",
        "local:1234",
        ":",
        "offline",
        "offline:offline",
        "private",
        "private:private",
        "traveling",
        "traveling:traveling",
    ] {
        assert!(!is_real_instance(location), "{location}");
    }
}

#[test]
fn accepts_world_instance_tags() {
    for location in ["wrld_a:12345", "wrld_a:12345~region(us)", "wrld_a"] {
        assert!(is_real_instance(location), "{location}");
    }
}

#[test]
fn trims_whitespace_and_folds_case_before_matching_sentinels() {
    assert!(!is_real_instance("  offline  "));
    assert!(!is_real_instance("OFFLINE"));
    assert!(!is_real_instance("Private:Private"));
    assert!(!is_real_instance("  Traveling  "));
}
