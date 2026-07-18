use super::*;
use crate::runtime::tests::test_services;
use crate::runtime::{
    VrOverlayRuntime, VR_OVERLAY_FRIENDS_PANEL_GROUP_CONFIG_KEY,
    VR_OVERLAY_PANEL_SELECTED_CATEGORY_CONFIG_KEY,
};
use std::sync::Arc;

#[test]
fn hidden_friends_panel_ignores_selected_category_config() {
    let (_dir, _db, services) = test_services("friends-panel-category-config");
    services
        .data()
        .config()
        .set_string(VR_OVERLAY_FRIENDS_PANEL_GROUP_CONFIG_KEY, "friend:group_0")
        .unwrap();
    let runtime = VrOverlayRuntime::new(Arc::clone(&services));

    assert_eq!(
        runtime.load_friends_panel_selected_category(),
        FRIENDS_PANEL_CATEGORY_ALL
    );

    runtime.persist_friends_panel_selected_category(FRIENDS_PANEL_CATEGORY_FAVORITES_ONLINE);

    assert_eq!(
        services
            .data()
            .config()
            .get_string(VR_OVERLAY_PANEL_SELECTED_CATEGORY_CONFIG_KEY, "")
            .unwrap(),
        ""
    );
}

#[test]
fn favorite_friend_groups_snapshot_preserves_remote_and_local_labels() {
    let snapshot = serde_json::json!({
        "favoriteFriendGroups": [
            {
                "key": "friend:group_0",
                "name": "group_0",
                "displayName": "VIP",
                "count": 1
            }
        ],
        "groupedFavoriteFriendIdsByGroupKey": {
            "friend:group_0": ["usr_a"]
        },
        "localFriendFavoriteGroups": [
            {
                "key": "Best",
                "displayName": "Best Local",
                "count": 1
            }
        ],
        "localFriendFavorites": {
            "Best": ["usr_b"]
        }
    });

    let groups = favorite_friend_groups_snapshot_from_baseline(&snapshot);

    assert_eq!(groups.all_user_ids(), vec!["usr_a", "usr_b"]);
    assert_eq!(groups.groups.len(), 2);
    assert_eq!(groups.groups[0].key, "friend:group_0");
    assert_eq!(groups.groups[0].label, "VIP");
    assert_eq!(groups.groups[0].user_ids, vec!["usr_a"]);
    assert_eq!(groups.groups[1].key, "local:Best");
    assert_eq!(groups.groups[1].label, "Best Local");
    assert_eq!(groups.groups[1].user_ids, vec!["usr_b"]);
}

#[test]
fn friends_panel_model_filters_favorites_and_keeps_note_memo_traveling() {
    let snapshot = vrcx_0_application_realtime::RealtimeFriendSnapshot {
        current_user_id: "usr_self".to_string(),
        friends_by_id: [
            (
                "usr_online".to_string(),
                vrcx_0_core::friends::FriendRecord {
                    id: "usr_online".to_string(),
                    display_name: "Online Friend".to_string(),
                    state_bucket: "online".to_string(),
                    status: "join me".to_string(),
                    location: "wrld_home:123".to_string(),
                    world_id: "wrld_home".to_string(),
                    ..vrcx_0_core::friends::FriendRecord::default()
                },
            ),
            (
                "usr_traveling".to_string(),
                vrcx_0_core::friends::FriendRecord {
                    id: "usr_traveling".to_string(),
                    display_name: "Traveling Friend".to_string(),
                    state_bucket: "online".to_string(),
                    location: "traveling".to_string(),
                    traveling_to_location: "wrld_target:456".to_string(),
                    ..vrcx_0_core::friends::FriendRecord::default()
                },
            ),
            (
                "usr_offline".to_string(),
                vrcx_0_core::friends::FriendRecord {
                    id: "usr_offline".to_string(),
                    display_name: "Offline Friend".to_string(),
                    state_bucket: "offline".to_string(),
                    location: "offline".to_string(),
                    ..vrcx_0_core::friends::FriendRecord::default()
                },
            ),
        ]
        .into_iter()
        .collect(),
        ..vrcx_0_application_realtime::RealtimeFriendSnapshot::default()
    };
    let groups = FavoriteFriendGroupsSnapshot {
        groups: vec![FavoriteFriendGroupSnapshot {
            key: "friend:group_0".to_string(),
            label: "VIP".to_string(),
            user_ids: vec![
                "usr_online".to_string(),
                "usr_traveling".to_string(),
                "usr_offline".to_string(),
            ],
        }],
    };
    let input = FriendsPanelModelInput {
        selected_category_key: "missing".to_string(),
        friend_snapshot: Some(snapshot),
        favorite_groups: groups,
        current_location: String::new(),
        current_location_player_ids: Vec::new(),
        notes_by_user_id: [("usr_online".to_string(), "VRChat note".to_string())]
            .into_iter()
            .collect(),
        memos_by_user_id: [("usr_online".to_string(), "Local memo".to_string())]
            .into_iter()
            .collect(),
        world_names_by_id: [
            ("wrld_home".to_string(), "Home World".to_string()),
            ("wrld_target".to_string(), "Target World".to_string()),
        ]
        .into_iter()
        .collect(),
        avatars_by_user_id: HashMap::new(),
        locale: OverlayLocale::En,
        all_friends_includes_favorites: true,
        is_game_running: false,
    };

    let model = build_friends_panel_model(input);

    assert_eq!(model.selected_category_key, "all");
    assert_eq!(
        model
            .categories
            .iter()
            .map(|category| {
                (
                    category.key.as_str(),
                    category.label.as_str(),
                    category.count,
                )
            })
            .collect::<Vec<_>>(),
        vec![
            ("all", "All", 2),
            ("sameInstance", "Same Instance", 0),
            ("favOnline", "Favorites Online", 2),
            ("favLocal", "Local Favorites", 0),
            ("group:friend:group_0", "VIP", 2),
        ]
    );
    assert_eq!(
        model
            .rows
            .iter()
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec!["usr_online", "usr_traveling"]
    );
    let online = model
        .rows
        .iter()
        .find(|row| row.user_id == "usr_online")
        .expect("online row");
    assert_eq!(online.location_text, "Home World Public");
    assert_eq!(online.note.as_deref(), Some("VRChat note"));
    assert_eq!(online.memo.as_deref(), Some("Local memo"));

    let traveling = model
        .rows
        .iter()
        .find(|row| row.user_id == "usr_traveling")
        .expect("traveling row");
    assert!(traveling.is_traveling);
    assert_eq!(traveling.location_text, "Traveling");
    assert_eq!(
        traveling.traveling_text.as_deref(),
        Some("Target World Public")
    );
}

#[test]
fn friends_panel_model_builds_categories_and_respects_all_friends_setting() {
    let snapshot = RealtimeFriendSnapshot {
        current_user_id: "usr_self".to_string(),
        friends_by_id: [
            (
                "usr_favorite".to_string(),
                FriendRecord {
                    id: "usr_favorite".to_string(),
                    display_name: "Favorite".to_string(),
                    state_bucket: "online".to_string(),
                    location: "wrld_home:123".to_string(),
                    world_id: "wrld_home".to_string(),
                    ..FriendRecord::default()
                },
            ),
            (
                "usr_local".to_string(),
                FriendRecord {
                    id: "usr_local".to_string(),
                    display_name: "Local".to_string(),
                    state_bucket: "active".to_string(),
                    location: "wrld_home:123".to_string(),
                    world_id: "wrld_home".to_string(),
                    ..FriendRecord::default()
                },
            ),
            (
                "usr_other".to_string(),
                FriendRecord {
                    id: "usr_other".to_string(),
                    display_name: "Other".to_string(),
                    state_bucket: "online".to_string(),
                    location: "wrld_home:123".to_string(),
                    world_id: "wrld_home".to_string(),
                    ..FriendRecord::default()
                },
            ),
        ]
        .into_iter()
        .collect(),
        ..RealtimeFriendSnapshot::default()
    };
    let groups = FavoriteFriendGroupsSnapshot {
        groups: vec![
            FavoriteFriendGroupSnapshot {
                key: "friend:group_0".to_string(),
                label: "VIP".to_string(),
                user_ids: vec!["usr_favorite".to_string()],
            },
            FavoriteFriendGroupSnapshot {
                key: "local:Best".to_string(),
                label: "Best".to_string(),
                user_ids: vec!["usr_local".to_string()],
            },
        ],
    };

    let excluded = build_friends_panel_model(FriendsPanelModelInput {
        selected_category_key: "all".to_string(),
        friend_snapshot: Some(snapshot.clone()),
        favorite_groups: groups.clone(),
        locale: OverlayLocale::En,
        all_friends_includes_favorites: false,
        ..FriendsPanelModelInput::default()
    });

    assert_eq!(
        excluded
            .categories
            .iter()
            .map(|category| (category.key.as_str(), category.count))
            .collect::<Vec<_>>(),
        vec![
            ("all", 1),
            ("sameInstance", 2),
            ("favOnline", 1),
            ("favLocal", 0),
            ("group:friend:group_0", 1),
            ("group:local:Best", 0),
        ]
    );
    assert_eq!(
        excluded
            .rows
            .iter()
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec!["usr_other"]
    );

    let included = build_friends_panel_model(FriendsPanelModelInput {
        selected_category_key: "all".to_string(),
        friend_snapshot: Some(snapshot),
        favorite_groups: groups,
        locale: OverlayLocale::En,
        all_friends_includes_favorites: true,
        ..FriendsPanelModelInput::default()
    });

    assert_eq!(included.categories[0].count, 2);
    assert_eq!(
        included
            .rows
            .iter()
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec!["usr_favorite", "usr_other"]
    );
}

#[test]
fn friends_panel_model_marks_open_request_and_invite_actions() {
    let snapshot = RealtimeFriendSnapshot {
        current_user_id: "usr_self".to_string(),
        friends_by_id: [
            (
                "usr_open".to_string(),
                FriendRecord {
                    id: "usr_open".to_string(),
                    display_name: "Open Friend".to_string(),
                    state_bucket: "online".to_string(),
                    location: "wrld_public:123".to_string(),
                    world_id: "wrld_public".to_string(),
                    ..FriendRecord::default()
                },
            ),
            (
                "usr_request".to_string(),
                FriendRecord {
                    id: "usr_request".to_string(),
                    display_name: "Request Friend".to_string(),
                    state_bucket: "online".to_string(),
                    location: "wrld_private:456~private(usr_request)".to_string(),
                    world_id: "wrld_private".to_string(),
                    ..FriendRecord::default()
                },
            ),
            (
                "usr_active_request".to_string(),
                FriendRecord {
                    id: "usr_active_request".to_string(),
                    display_name: "Active Request Friend".to_string(),
                    state_bucket: "active".to_string(),
                    location: "wrld_private:789~private(usr_active_request)".to_string(),
                    world_id: "wrld_private".to_string(),
                    ..FriendRecord::default()
                },
            ),
        ]
        .into_iter()
        .collect(),
        ..RealtimeFriendSnapshot::default()
    };

    let model = build_friends_panel_model(FriendsPanelModelInput {
        selected_category_key: FRIENDS_PANEL_CATEGORY_ALL.to_string(),
        friend_snapshot: Some(snapshot),
        current_location: "wrld_home:999~hidden(usr_self)".to_string(),
        locale: OverlayLocale::En,
        all_friends_includes_favorites: true,
        is_game_running: true,
        ..FriendsPanelModelInput::default()
    });

    let actions_by_user_id = model
        .rows
        .iter()
        .map(|row| (row.user_id.as_str(), row.actions.clone()))
        .collect::<HashMap<_, _>>();
    assert_eq!(
        actions_by_user_id
            .get("usr_open")
            .and_then(|actions| actions.primary),
        Some(FriendPanelRowPrimaryAction::Open)
    );
    assert_eq!(
        actions_by_user_id
            .get("usr_request")
            .and_then(|actions| actions.primary),
        Some(FriendPanelRowPrimaryAction::Request)
    );
    assert!(!actions_by_user_id.contains_key("usr_active_request"));
    assert!(actions_by_user_id
        .get("usr_open")
        .is_some_and(|actions| actions.invite));
    assert!(actions_by_user_id
        .get("usr_request")
        .is_some_and(|actions| actions.invite));
}

#[test]
fn friends_panel_same_instance_category_is_additive() {
    let mut local = FriendRecord {
        id: "usr_local".to_string(),
        display_name: "Local".to_string(),
        state_bucket: "online".to_string(),
        location: "private".to_string(),
        ..FriendRecord::default()
    };
    local.extra.insert(
        "$location".to_string(),
        serde_json::json!({
            "worldId": "wrld_live",
            "instanceId": "123"
        }),
    );
    let snapshot = RealtimeFriendSnapshot {
        current_user_id: "usr_self".to_string(),
        friends_by_id: [
            (
                "usr_favorite".to_string(),
                FriendRecord {
                    id: "usr_favorite".to_string(),
                    display_name: "Favorite".to_string(),
                    state_bucket: "online".to_string(),
                    location: "wrld_live:123".to_string(),
                    world_id: "wrld_live".to_string(),
                    ..FriendRecord::default()
                },
            ),
            ("usr_local".to_string(), local),
            (
                "usr_other".to_string(),
                FriendRecord {
                    id: "usr_other".to_string(),
                    display_name: "Other".to_string(),
                    state_bucket: "online".to_string(),
                    location: "private".to_string(),
                    ..FriendRecord::default()
                },
            ),
            (
                "usr_solo".to_string(),
                FriendRecord {
                    id: "usr_solo".to_string(),
                    display_name: "Solo".to_string(),
                    state_bucket: "online".to_string(),
                    location: "wrld_else:456".to_string(),
                    world_id: "wrld_else".to_string(),
                    ..FriendRecord::default()
                },
            ),
            (
                "usr_party_a".to_string(),
                FriendRecord {
                    id: "usr_party_a".to_string(),
                    display_name: "Party A".to_string(),
                    state_bucket: "online".to_string(),
                    location: "wrld_party:456".to_string(),
                    world_id: "wrld_party".to_string(),
                    ..FriendRecord::default()
                },
            ),
            (
                "usr_party_b".to_string(),
                FriendRecord {
                    id: "usr_party_b".to_string(),
                    display_name: "Party B".to_string(),
                    state_bucket: "online".to_string(),
                    location: "wrld_party:456".to_string(),
                    world_id: "wrld_party".to_string(),
                    ..FriendRecord::default()
                },
            ),
        ]
        .into_iter()
        .collect(),
        ..RealtimeFriendSnapshot::default()
    };
    let groups = FavoriteFriendGroupsSnapshot {
        groups: vec![
            FavoriteFriendGroupSnapshot {
                key: "friend:group_0".to_string(),
                label: "VIP".to_string(),
                user_ids: vec!["usr_favorite".to_string()],
            },
            FavoriteFriendGroupSnapshot {
                key: "local:Best".to_string(),
                label: "Best".to_string(),
                user_ids: vec!["usr_local".to_string()],
            },
        ],
    };

    let model = build_friends_panel_model(FriendsPanelModelInput {
        selected_category_key: FRIENDS_PANEL_CATEGORY_SAME_INSTANCE.to_string(),
        friend_snapshot: Some(snapshot.clone()),
        favorite_groups: groups.clone(),
        current_location: "wrld_live:123".to_string(),
        current_location_player_ids: vec!["usr_other".to_string()],
        world_names_by_id: [
            ("wrld_live".to_string(), "Live World".to_string()),
            ("wrld_party".to_string(), "Party World".to_string()),
        ]
        .into_iter()
        .collect(),
        locale: OverlayLocale::En,
        all_friends_includes_favorites: true,
        ..FriendsPanelModelInput::default()
    });

    assert_eq!(
        model
            .categories
            .iter()
            .map(|category| (category.key.as_str(), category.count))
            .collect::<Vec<_>>(),
        vec![
            ("all", 6),
            ("sameInstance", 5),
            ("favOnline", 2),
            ("favLocal", 1),
            ("group:friend:group_0", 1),
            ("group:local:Best", 1),
        ]
    );
    assert_eq!(
        model
            .rows
            .iter()
            .filter(|row| !row.user_id.is_empty())
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "usr_favorite",
            "usr_local",
            "usr_other",
            "usr_party_a",
            "usr_party_b"
        ]
    );
    let section_labels = model
        .rows
        .iter()
        .filter_map(|row| row.section_label.as_deref())
        .collect::<Vec<_>>();
    assert_eq!(section_labels.len(), 2);
    assert!(section_labels[0].contains("Live World"));
    assert!(section_labels[1].contains("Party World"));

    let group_model = build_friends_panel_model(FriendsPanelModelInput {
        selected_category_key: "group:friend:group_0".to_string(),
        friend_snapshot: Some(snapshot),
        favorite_groups: groups,
        current_location: "wrld_live:123".to_string(),
        current_location_player_ids: vec!["usr_other".to_string()],
        locale: OverlayLocale::En,
        all_friends_includes_favorites: true,
        ..FriendsPanelModelInput::default()
    });

    assert_eq!(
        group_model
            .rows
            .iter()
            .map(|row| row.user_id.as_str())
            .collect::<Vec<_>>(),
        vec!["usr_favorite"]
    );
}

#[test]
fn friends_panel_model_prefers_live_friend_note_over_cached_note_map() {
    let mut friend = FriendRecord {
        id: "usr_friend".to_string(),
        display_name: "Friend".to_string(),
        state_bucket: "online".to_string(),
        location: "wrld_home:123".to_string(),
        world_id: "wrld_home".to_string(),
        ..FriendRecord::default()
    };
    friend.extra.insert(
        "note".to_string(),
        serde_json::Value::String("Live note".to_string()),
    );
    let model = build_friends_panel_model(FriendsPanelModelInput {
        selected_category_key: "all".to_string(),
        friend_snapshot: Some(RealtimeFriendSnapshot {
            current_user_id: "usr_self".to_string(),
            friends_by_id: [("usr_friend".to_string(), friend)].into_iter().collect(),
            ..RealtimeFriendSnapshot::default()
        }),
        favorite_groups: FavoriteFriendGroupsSnapshot {
            groups: vec![FavoriteFriendGroupSnapshot {
                key: "friend:group_0".to_string(),
                label: "VIP".to_string(),
                user_ids: vec!["usr_friend".to_string()],
            }],
        },
        current_location: String::new(),
        current_location_player_ids: Vec::new(),
        notes_by_user_id: [("usr_friend".to_string(), "Cached note".to_string())]
            .into_iter()
            .collect(),
        memos_by_user_id: HashMap::new(),
        world_names_by_id: HashMap::new(),
        avatars_by_user_id: HashMap::new(),
        locale: OverlayLocale::En,
        all_friends_includes_favorites: true,
        is_game_running: false,
    });

    assert_eq!(model.rows[0].note.as_deref(), Some("Live note"));
}
