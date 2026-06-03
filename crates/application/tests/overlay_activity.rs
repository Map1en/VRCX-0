use serde_json::json;
use vrcx_0_application::{
    overlay_activity_type_definitions, OverlayActivityCandidate, OverlayActivityCategory,
    OverlayActivityFavoriteGroupKeys, OverlayActivityFilters, OverlayActivityRule,
    OverlayActivityRuntime, OverlayActivityScope, OverlayFavoriteGroups,
};

#[test]
fn activity_type_definitions_are_exported_from_backend() {
    let definitions = overlay_activity_type_definitions();
    let invite = definitions
        .iter()
        .find(|definition| definition.key == "invite")
        .expect("invite definition");
    let queue_ready = definitions
        .iter()
        .find(|definition| definition.key == "group.queueReady")
        .expect("queue ready definition");
    let avatar_change = definitions
        .iter()
        .find(|definition| definition.key == "AvatarChange")
        .expect("avatar definition");

    assert_eq!(invite.category, OverlayActivityCategory::ActionRequired);
    assert!(invite
        .allowed_scopes
        .contains(&OverlayActivityScope::Friends));
    assert_eq!(
        queue_ready.allowed_scopes,
        [OverlayActivityScope::Off, OverlayActivityScope::On]
    );
    assert_eq!(avatar_change.aliases, ["Avatar"]);
    assert!(definitions
        .iter()
        .all(|definition| definition.key != "PortalSpawn"));
}

#[test]
fn selected_favorite_groups_are_applied_per_activity_type() {
    let filters = OverlayActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "invite": {
                    "scope": "selectedFavorites",
                    "favoriteGroupKeys": ["fav-a"]
                },
                "boop": {
                    "scope": "selectedFavorites",
                    "favoriteGroupKeys": ["fav-b", "local:close"]
                }
            }
        }
    }));
    let runtime = OverlayActivityRuntime::with_filters(filters);
    runtime.set_favorite_groups(OverlayFavoriteGroups::from_pairs([
        ("fav-a", ["usr_a"].as_slice()),
        ("fav-b", ["usr_b"].as_slice()),
        ("local:close", ["usr_c"].as_slice()),
    ]));

    let invite_from_a = runtime.ingest_candidate(candidate("invite", "usr_a"));
    let invite_from_b = runtime.ingest_candidate(candidate("invite", "usr_b"));
    let boop_from_c = runtime.ingest_candidate(candidate("boop", "usr_c"));

    assert!(invite_from_a.is_some());
    assert!(invite_from_b.is_none());
    assert!(boop_from_c.is_some());
    assert_eq!(
        runtime
            .snapshot()
            .entries
            .into_iter()
            .map(|entry| (entry.sequence, entry.activity_type))
            .collect::<Vec<_>>(),
        vec![(1, "invite".to_string()), (2, "boop".to_string())]
    );
}

#[test]
fn unsupported_scopes_normalize_to_type_defaults() {
    let filters = OverlayActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "group.queueReady": {
                    "scope": "friends",
                    "favoriteGroupKeys": ["fav-a"]
                },
                "Avatar": {
                    "scope": "allFavorites",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    }));

    assert_eq!(
        filters.rule_for("group.queueReady").scope,
        OverlayActivityScope::On
    );
    assert_eq!(
        filters.rule_for("AvatarChange").scope,
        OverlayActivityScope::AllFavorites
    );
}

#[test]
fn legacy_category_filters_normalize_to_type_rules() {
    let filters = OverlayActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "favoriteGroupKeys": ["fav-a"],
            "categories": {
                "actionRequired": {
                    "scope": "direct",
                    "typeOverrides": {
                        "boop": {
                            "scope": "off"
                        }
                    }
                },
                "currentInstance": {
                    "scope": "currentInstance"
                },
                "profileChange": {
                    "scope": "allFavorites",
                    "typeOverrides": {
                        "Avatar": {
                            "scope": "selectedFavorites",
                            "favoriteGroupKeys": ["fav-b"]
                        }
                    }
                }
            }
        }
    }));

    assert_eq!(filters.rule_for("invite").scope, OverlayActivityScope::On);
    assert_eq!(filters.rule_for("boop").scope, OverlayActivityScope::Off);
    assert_eq!(
        filters.rule_for("OnPlayerJoined").scope,
        OverlayActivityScope::EveryoneInInstance
    );
    assert_eq!(
        filters.rule_for("DisplayName").scope,
        OverlayActivityScope::AllFavorites
    );
    assert_eq!(
        filters.rule_for("AvatarChange"),
        OverlayActivityRule {
            scope: OverlayActivityScope::SelectedFavorites,
            favorite_group_keys: OverlayActivityFavoriteGroupKeys::Selected(vec![
                "fav-b".to_string()
            ])
        }
    );
}

#[test]
fn legacy_shared_feed_wrist_filters_migrate_to_type_rules() {
    let filters = OverlayActivityFilters::from_legacy_shared_feed_filters(json!({
        "noty": {
            "Online": "Off"
        },
        "wrist": {
            "invite": "VIP",
            "OnPlayerJoined": "Everyone",
            "friendRequest": "Off",
            "group.queueReady": "Friends",
            "Avatar": "VIP",
            "Location": "On"
        }
    }));

    assert_eq!(
        filters.rule_for("invite").scope,
        OverlayActivityScope::AllFavorites
    );
    assert_eq!(
        filters.rule_for("OnPlayerJoined").scope,
        OverlayActivityScope::EveryoneInInstance
    );
    assert_eq!(
        filters.rule_for("friendRequest").scope,
        OverlayActivityScope::Off
    );
    assert_eq!(
        filters.rule_for("group.queueReady").scope,
        OverlayActivityScope::On
    );
    assert_eq!(
        filters.rule_for("AvatarChange").scope,
        OverlayActivityScope::AllFavorites
    );
    assert_eq!(filters.rule_for("GPS").scope, OverlayActivityScope::Friends);
}

#[test]
fn persisted_overlay_filter_shape_detection_matches_runtime_loader() {
    assert!(!OverlayActivityFilters::has_persisted_rules(&json!({})));
    assert!(OverlayActivityFilters::has_persisted_rules(&json!({
        "wrist": {
            "types": {}
        }
    })));
    assert!(OverlayActivityFilters::has_persisted_rules(&json!({
        "wrist": {
            "categories": {}
        }
    })));
}

#[test]
fn unknown_activity_type_rule_uses_off_scope() {
    let filters = OverlayActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "invite": {
                    "scope": "on",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    }));

    assert_eq!(
        filters.rule_for("unknown.raw.type").scope,
        OverlayActivityScope::Off
    );
}

#[test]
fn current_instance_scope_only_matches_current_instance_candidates() {
    let filters = OverlayActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "OnPlayerJoined": {
                    "scope": "everyoneInInstance",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    }));
    let runtime = OverlayActivityRuntime::with_filters(filters);

    let mut matching = candidate("OnPlayerJoined", "usr_instance");
    matching.current_instance = true;
    let mut non_matching = candidate("OnPlayerJoined", "usr_remote");
    non_matching.current_instance = false;

    assert!(runtime.ingest_candidate(matching).is_some());
    assert!(runtime.ingest_candidate(non_matching).is_none());
}

#[test]
fn activity_content_is_built_from_feed_payload() {
    let runtime = OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "GPS": {
                    "scope": "friends",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));
    runtime.set_friend_user_ids(["usr_map"]);
    let mut row = candidate("GPS", "usr_map");
    row.actor_display_name = "Map User".to_string();
    row.payload = json!({
        "type": "GPS",
        "userId": "usr_map",
        "displayName": "Map User",
        "location": "wrld_1:123",
        "worldName": "Great World",
        "groupName": "Group A"
    });

    let entry = runtime.ingest_candidate(row).unwrap();

    assert_eq!(entry.content.icon, "location");
    assert_eq!(entry.content.title.fallback, "Map User");
    assert_eq!(entry.content.body.key, "notifications.gps");
    assert_eq!(entry.content.body.fallback, "is in Great World (Group A)");
    assert_eq!(
        entry.content.summary,
        "Map User is in Great World (Group A)"
    );
    assert_eq!(entry.content.location, "wrld_1:123");
    assert_eq!(entry.content.world_name, "Great World");
    assert_eq!(entry.content.group_name, "Group A");
}

#[test]
fn notification_content_uses_invite_details() {
    let runtime = OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "invite": {
                    "scope": "on",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));
    let mut row = candidate("invite", "usr_sender");
    row.actor_display_name = "Sender".to_string();
    row.payload = json!({
        "type": "invite",
        "senderUserId": "usr_sender",
        "senderUsername": "Sender",
        "details": {
            "worldId": "wrld_1",
            "worldName": "Invite World",
            "inviteMessage": "come over"
        }
    });

    let entry = runtime.ingest_candidate(row).unwrap();

    assert_eq!(entry.content.icon, "invite");
    assert_eq!(entry.content.title.fallback, "Sender");
    assert_eq!(entry.content.body.key, "notifications.invite");
    assert_eq!(
        entry.content.body.params,
        json!({ "location": "Invite World", "message": "come over" })
    );
    assert_eq!(
        entry.content.body.fallback,
        "has invited you to Invite World come over"
    );
    assert_eq!(entry.content.detail, "come over");
    assert_eq!(entry.content.world_name, "Invite World");
}

#[test]
fn unknown_activity_types_are_rejected() {
    let runtime = OverlayActivityRuntime::with_filters(OverlayActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "invite": {
                    "scope": "on",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    })));

    assert!(runtime
        .ingest_candidate(candidate("unknown.raw.type", "usr_actor"))
        .is_none());
    assert!(runtime.snapshot().entries.is_empty());
}

#[test]
fn favorite_group_keys_serialize_as_the_frontend_config_contract() {
    assert_eq!(
        serde_json::to_value(OverlayActivityRule {
            scope: OverlayActivityScope::SelectedFavorites,
            favorite_group_keys: OverlayActivityFavoriteGroupKeys::Selected(vec![
                "fav-a".to_string(),
                "local:close".to_string(),
            ]),
        })
        .unwrap(),
        json!({
            "scope": "selectedFavorites",
            "favoriteGroupKeys": ["fav-a", "local:close"]
        })
    );
    assert_eq!(
        serde_json::to_value(OverlayActivityFavoriteGroupKeys::All).unwrap(),
        json!("all")
    );
}

fn candidate(activity_type: &str, user_id: &str) -> OverlayActivityCandidate {
    OverlayActivityCandidate {
        source_id: format!("{activity_type}:{user_id}"),
        activity_type: activity_type.to_string(),
        created_at: "2026-05-31T00:00:00.000Z".to_string(),
        actor_user_id: user_id.to_string(),
        actor_display_name: user_id.to_string(),
        current_instance: false,
        payload: json!({}),
    }
}
