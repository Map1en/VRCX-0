use serde_json::{json, Map, Value};
use std::sync::{Arc, Mutex};
use vrcx_0_application_activity::{
    activity_type_definitions, ActivityCategory, ActivityDelivery, ActivityFavoriteGroupKeys,
    ActivityFavoriteGroups, ActivityFilters, ActivityRouter, ActivityRule, ActivityScope,
    ActivitySink, ActivitySnapshot, ActivityText, ActivityTypeDefinition, GroupInstanceMonitor,
    NotificationSurface,
};
use vrcx_0_contracts::activity::{
    ActivityActor, ActivityEvent, ActivityFacts, ActivityKind, ActivitySubject,
};
use vrcx_0_i18n::OverlayMessageKey;

#[test]
fn activity_type_definitions_are_exported_from_backend() {
    let definitions = activity_type_definitions();
    let definition = |kind: ActivityKind| {
        definitions
            .iter()
            .find(|definition| definition.key == kind)
            .unwrap_or_else(|| panic!("{} definition", kind.key()))
    };
    let invite = definition(ActivityKind::Invite);
    let group_instance_opened = definition(ActivityKind::GroupInstanceOpened);

    assert_eq!(definitions.len(), ActivityKind::ALL.len());
    assert_eq!(invite.category, ActivityCategory::ActionRequired);
    assert!(invite.allowed_scopes.contains(&ActivityScope::Friends));
    assert_eq!(
        definition(ActivityKind::GroupQueueReady).allowed_scopes,
        [ActivityScope::Off, ActivityScope::On]
    );
    assert_eq!(definition(ActivityKind::AvatarChange).aliases, ["Avatar"]);
    assert_eq!(
        group_instance_opened.allowed_scopes,
        [
            ActivityScope::Off,
            ActivityScope::AllFavorites,
            ActivityScope::SelectedFavorites,
        ]
    );
    let defaults = |kind: ActivityKind| {
        let definition = definition(kind);
        (
            definition.wrist_default_scope,
            definition.alert_default_scope,
            definition.tts_default_scope,
        )
    };
    use ActivityScope::{AllFavorites, EveryoneInInstance, Friends, Off, On};
    assert_eq!(defaults(ActivityKind::GroupInstanceOpened), (Off, Off, Off));
    assert_eq!(defaults(ActivityKind::Online), (Friends, AllFavorites, Off));
    assert_eq!(defaults(ActivityKind::Gps), (Friends, Off, Off));
    assert_eq!(
        defaults(ActivityKind::OnPlayerJoined),
        (EveryoneInInstance, AllFavorites, Off)
    );
    assert_eq!(
        defaults(ActivityKind::OnPlayerJoining),
        (Friends, Friends, AllFavorites)
    );
    assert_eq!(defaults(ActivityKind::GroupAnnouncement), (On, On, Off));
    assert_eq!(
        defaults(ActivityKind::BlockedOnPlayerJoined),
        (Off, Off, Off)
    );
    assert_eq!(defaults(ActivityKind::VideoPlay), (On, Off, Off));
}

#[test]
fn default_filters_give_alert_surfaces_one_profile_and_keep_webhook_off() {
    let filters = ActivityFilters::default();
    let scope = |surface, kind| filters.rule_for(surface, kind).scope;

    for surface in [
        NotificationSurface::Desktop,
        NotificationSurface::ExternalOverlay,
        NotificationSurface::Hmd,
    ] {
        assert_eq!(
            scope(surface, ActivityKind::Online),
            ActivityScope::AllFavorites
        );
    }
    assert_eq!(
        scope(NotificationSurface::Wrist, ActivityKind::Online),
        ActivityScope::Friends
    );
    assert_eq!(
        scope(NotificationSurface::Tts, ActivityKind::Online),
        ActivityScope::Off
    );
    assert_eq!(
        scope(NotificationSurface::Webhook, ActivityKind::Invite),
        ActivityScope::Off
    );
}

#[test]
fn boop_defaults_stay_off_on_vr_overlays_but_reach_desktop_surfaces() {
    let filters = ActivityFilters::default();
    let scope = |surface| filters.rule_for(surface, ActivityKind::Boop).scope;

    for surface in [
        NotificationSurface::Wrist,
        NotificationSurface::ExternalOverlay,
        NotificationSurface::Hmd,
        NotificationSurface::Webhook,
    ] {
        assert_eq!(scope(surface), ActivityScope::Off, "{surface:?}");
    }
    for surface in [
        NotificationSurface::Desktop,
        NotificationSurface::Tts,
        NotificationSurface::DesktopWidget,
    ] {
        assert_eq!(scope(surface), ActivityScope::Friends, "{surface:?}");
    }
}

#[test]
fn desktop_widget_defaults_keep_friend_movement_to_favorites_and_show_instance_safety() {
    let definitions = activity_type_definitions();
    let scope = |kind: ActivityKind| {
        definitions
            .iter()
            .find(|definition| definition.key == kind)
            .map(|definition| definition.widget_default_scope)
            .unwrap_or_else(|| panic!("{} definition", kind.key()))
    };
    use ActivityScope::{AllFavorites, EveryoneInInstance, Friends, Off, On};

    for kind in [
        ActivityKind::Online,
        ActivityKind::Offline,
        ActivityKind::Gps,
        ActivityKind::Status,
        ActivityKind::DisplayName,
        ActivityKind::TrustLevel,
    ] {
        assert_eq!(scope(kind), AllFavorites, "{kind:?}");
    }
    assert_eq!(scope(ActivityKind::OnPlayerJoined), Friends);
    assert_eq!(scope(ActivityKind::OnPlayerLeft), Friends);
    assert_eq!(
        scope(ActivityKind::BlockedOnPlayerJoined),
        EveryoneInInstance
    );
    assert_eq!(scope(ActivityKind::MutedOnPlayerJoined), EveryoneInInstance);
    assert_eq!(scope(ActivityKind::BlockedOnPlayerLeft), Off);
    assert_eq!(scope(ActivityKind::MutedOnPlayerLeft), Off);
    assert_eq!(scope(ActivityKind::VideoPlay), Off);
    assert_eq!(scope(ActivityKind::GroupJoinRequest), On);
    assert_eq!(
        ActivityFilters::default()
            .rule_for(NotificationSurface::DesktopWidget, ActivityKind::Gps)
            .scope,
        AllFavorites
    );
}

#[test]
fn hmd_delivery_is_live_only_and_independent_from_wrist_snapshot() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": { "types": { "Online": { "scope": "off" } } },
        "desktop": { "types": { "Online": { "scope": "off" } } },
        "vr": { "types": { "Online": { "scope": "off" } } },
        "hmd": { "types": { "Online": { "scope": "friends" } } },
        "webhook": { "types": { "Online": { "scope": "off" } } },
        "tts": { "types": { "Online": { "scope": "off" } } }
    })));
    let sink = RecordingSink::default();
    let deliveries = sink.deliveries.clone();
    let snapshots = sink.snapshots.clone();
    runtime.set_sink(sink);
    runtime.set_friend_user_ids(["usr_friend"]);
    runtime.arm_delivery();

    runtime.ingest(recent_event(ActivityKind::Online, "usr_friend"));

    let deliveries = deliveries.lock().unwrap();
    assert_eq!(deliveries.len(), 1);
    assert!(deliveries[0].hmd);
    assert!(!deliveries[0].desktop);
    assert!(!deliveries[0].vr);
    assert!(!deliveries[0].webhook);
    assert!(!deliveries[0].tts);
    assert!(
        snapshots.lock().unwrap().is_empty(),
        "hmd-only deliveries must not create wrist snapshot entries"
    );
}

#[test]
fn tts_delivery_is_independent_from_visual_surfaces() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": { "types": { "Online": { "scope": "off" } } },
        "desktop": { "types": { "Online": { "scope": "off" } } },
        "vr": { "types": { "Online": { "scope": "off" } } },
        "hmd": { "types": { "Online": { "scope": "off" } } },
        "webhook": { "types": { "Online": { "scope": "off" } } },
        "tts": { "types": { "Online": { "scope": "friends" } } }
    })));
    let sink = RecordingSink::default();
    let deliveries = sink.deliveries.clone();
    let snapshots = sink.snapshots.clone();
    runtime.set_sink(sink);
    runtime.set_friend_user_ids(["usr_friend"]);
    runtime.arm_delivery();

    runtime.ingest(recent_event(ActivityKind::Online, "usr_friend"));

    let deliveries = deliveries.lock().unwrap();
    assert_eq!(deliveries.len(), 1);
    assert!(!deliveries[0].desktop);
    assert!(!deliveries[0].vr);
    assert!(!deliveries[0].hmd);
    assert!(!deliveries[0].webhook);
    assert!(deliveries[0].tts);
    assert!(snapshots.lock().unwrap().is_empty());
}

#[test]
fn selected_favorite_groups_are_applied_per_activity_type() {
    let filters = ActivityFilters::from_json(json!({
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
    let runtime = ActivityRouter::with_filters(filters);
    runtime.set_favorite_groups(ActivityFavoriteGroups::from_pairs([
        ("fav-a", ["usr_a"].as_slice()),
        ("fav-b", ["usr_b"].as_slice()),
        ("local:close", ["usr_c"].as_slice()),
    ]));

    let invite_from_a = runtime.ingest(event(ActivityKind::Invite, "usr_a"));
    let invite_from_b = runtime.ingest(event(ActivityKind::Invite, "usr_b"));
    let boop_from_c = runtime.ingest(event(ActivityKind::Boop, "usr_c"));

    assert!(invite_from_a.is_some());
    assert!(invite_from_b.is_none());
    assert!(boop_from_c.is_some());
    assert_eq!(
        runtime
            .snapshot()
            .entries
            .into_iter()
            .map(|entry| (entry.sequence, entry.kind))
            .collect::<Vec<_>>(),
        vec![(1, ActivityKind::Invite), (2, ActivityKind::Boop)]
    );
}

#[test]
fn unsupported_scopes_normalize_to_type_defaults() {
    let filters = ActivityFilters::from_json(json!({
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
        filters
            .rule_for(NotificationSurface::Wrist, ActivityKind::GroupQueueReady)
            .scope,
        ActivityScope::On
    );
    assert_eq!(
        filters
            .rule_for(NotificationSurface::Wrist, ActivityKind::AvatarChange)
            .scope,
        ActivityScope::AllFavorites
    );
}

#[test]
fn group_instance_rules_reject_global_and_unselected_scopes() {
    let filters = ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "group.instanceOpened": {
                    "scope": "on",
                    "favoriteGroupKeys": "all"
                }
            }
        },
        "desktop": {
            "types": {
                "group.instanceOpened": {
                    "scope": "selectedFavorites",
                    "favoriteGroupKeys": "all"
                }
            }
        }
    }));

    assert_eq!(
        filters
            .rule_for(
                NotificationSurface::Wrist,
                ActivityKind::GroupInstanceOpened
            )
            .scope,
        ActivityScope::Off
    );
    assert_eq!(
        filters
            .rule_for(
                NotificationSurface::Desktop,
                ActivityKind::GroupInstanceOpened
            )
            .scope,
        ActivityScope::Off
    );
}

#[test]
fn group_instance_favorites_use_group_membership_not_friend_membership() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": {
            "types": {
                "group.instanceOpened": {
                    "scope": "selectedFavorites",
                    "favoriteGroupKeys": ["group:collection-a"]
                }
            }
        }
    })));
    runtime.set_favorite_groups(ActivityFavoriteGroups::from_pairs([(
        "group:collection-a",
        ["grp_friend_map"].as_slice(),
    )]));
    runtime.set_group_favorite_groups(ActivityFavoriteGroups::from_pairs([(
        "group:collection-a",
        ["grp_saved"].as_slice(),
    )]));
    let group_instance = |source_id: &str, group_id: &str| {
        let mut event = ActivityEvent::new(
            ActivityKind::GroupInstanceOpened,
            source_id,
            "2026-05-31T00:00:00.000Z",
        );
        event.subject = ActivitySubject::Group(group_id.into());
        event
    };

    assert!(runtime
        .ingest(group_instance("saved-group-instance", "grp_saved"))
        .is_some());
    assert!(runtime
        .ingest(group_instance(
            "friend-map-group-instance",
            "grp_friend_map"
        ))
        .is_none());
}

#[test]
fn saved_group_instance_scan_seeds_then_delivers_the_new_parsed_location() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "desktop": {
            "types": {
                "group.instanceOpened": {
                    "scope": "selectedFavorites",
                    "favoriteGroupKeys": ["group:collection-a"]
                }
            }
        }
    })));
    runtime.set_group_favorite_groups(ActivityFavoriteGroups::from_pairs([(
        "group:collection-a",
        ["grp_saved"].as_slice(),
    )]));
    let monitor = GroupInstanceMonitor::default();
    monitor.set_watched_groups(&["grp_saved".to_string()]);
    let sink = RecordingSink::default();
    runtime.set_sink(sink.clone());
    runtime.arm_delivery();
    let scope_key = "usr_owner\u{1f}https://api.example.test\u{1f}7";
    let fetched_at = chrono::Utc::now().to_rfc3339();
    let existing: vrcx_0_core::json::RawJson = json!({
        "location": "wrld_test:existing~group(grp_saved)~groupAccessType(plus)",
        "group": { "id": "grp_saved", "name": "Test Group" },
        "world": { "name": "Test World" }
    })
    .into();

    assert!(monitor
        .scan(
            scope_key,
            "grp_saved",
            &fetched_at,
            std::slice::from_ref(&existing)
        )
        .is_none());

    let event = monitor
        .scan(
            scope_key,
            "grp_saved",
            &fetched_at,
            &[
                existing,
                json!({
                    "location": "wrld_test:new~group(grp_saved)~groupAccessType(plus)",
                    "group": { "id": "grp_saved", "name": "Test Group" },
                    "world": { "name": "Test World" }
                })
                .into(),
            ],
        )
        .expect("new instance event");
    assert_eq!(event.facts.count, 1);
    let entry = runtime.ingest(event).expect("group instance entry");

    assert_eq!(entry.content.group_id, "grp_saved");
    assert_eq!(entry.content.title.source_text(), "Test Group");
    assert_eq!(
        entry.content.body.source_text(),
        "Created a new instance: Test World groupPlus(Test Group)"
    );
    let deliveries = sink.deliveries.lock().unwrap();
    assert_eq!(deliveries.len(), 1);
    assert!(deliveries[0].desktop);
    assert!(!deliveries[0].vr);
    assert!(!deliveries[0].hmd);
    assert!(!deliveries[0].webhook);
    assert!(!deliveries[0].tts);
}

#[test]
fn persisted_overlay_filter_shape_detection_matches_runtime_loader() {
    assert!(!ActivityFilters::has_persisted_rules(&json!({})));
    assert!(ActivityFilters::has_persisted_rules(&json!({
        "wrist": {
            "types": {}
        }
    })));
}

#[test]
fn current_instance_scope_only_matches_current_instance_events() {
    let filters = ActivityFilters::from_json(json!({
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
    let runtime = ActivityRouter::with_filters(filters);

    let mut matching = event(ActivityKind::OnPlayerJoined, "usr_instance");
    matching.in_current_instance = true;
    let non_matching = event(ActivityKind::OnPlayerJoined, "usr_remote");

    assert!(runtime.ingest(matching).is_some());
    assert!(runtime.ingest(non_matching).is_none());
}

#[test]
fn location_content_is_built_from_the_event_facts() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
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
    let mut gps = event(ActivityKind::Gps, "usr_map");
    gps.actor.display_name = "Map User".to_string();
    gps.facts = ActivityFacts {
        location: "wrld_1:123".into(),
        world_name: "Great World".into(),
        group_name: "Group A".into(),
        ..ActivityFacts::default()
    };

    let entry = runtime.ingest(gps).unwrap();

    assert_eq!(entry.content.icon, "location");
    assert_eq!(entry.content.title.source_text(), "Map User");
    assert_eq!(
        entry.content.body.as_message().expect("GPS message").key(),
        OverlayMessageKey::NotificationsGps
    );
    assert_eq!(
        entry.content.body.source_text(),
        "In Great World public(Group A)"
    );
    assert_eq!(
        entry.content.summary,
        "Map User In Great World public(Group A)"
    );
    assert_eq!(entry.content.location, "wrld_1:123");
    assert_eq!(entry.content.world_name, "Great World");
    assert_eq!(entry.content.group_name, "Group A");
}

#[test]
fn all_activity_types_build_desktop_safe_content() {
    let definitions = activity_type_definitions();
    let runtime = ActivityRouter::with_filters(desktop_filters_for(&definitions));
    runtime.set_friend_user_ids(["usr_actor"]);
    runtime.set_group_favorite_groups(ActivityFavoriteGroups::from_pairs([(
        "group:desktop",
        ["grp_desktop"].as_slice(),
    )]));

    for definition in definitions {
        let kind = definition.key;
        let mut row = event(kind, "usr_actor");
        row.actor.display_name = "Desktop Actor".to_string();
        row.facts = representative_facts();
        if kind == ActivityKind::GroupInstanceOpened {
            row.subject = ActivitySubject::Group("grp_desktop".to_string());
        }

        let entry = runtime
            .ingest(row)
            .unwrap_or_else(|| panic!("{} should ingest", kind.key()));

        assert_eq!(entry.kind, kind);
        assert!(
            !entry.content.summary.trim().is_empty(),
            "{} should build non-empty desktop summary",
            kind.key()
        );
        assert_desktop_text_key(kind.key(), "title", &entry.content.title);
        assert_desktop_text_key(kind.key(), "body", &entry.content.body);

        match kind {
            ActivityKind::Bio => {
                assert_message_key(&entry.content.body, OverlayMessageKey::NotificationsBio)
            }
            ActivityKind::Event => assert_message_key(
                &entry.content.title,
                OverlayMessageKey::NotificationsEventTitle,
            ),
            ActivityKind::External => assert_message_key(
                &entry.content.title,
                OverlayMessageKey::NotificationsExternalTitle,
            ),
            ActivityKind::VideoPlay => assert_message_key(
                &entry.content.title,
                OverlayMessageKey::NotificationsVideoPlayTitle,
            ),
            _ => {}
        }
    }
}

#[test]
fn each_surface_setting_alone_decides_delivery_for_every_activity_type() {
    const SURFACES: [&str; 7] = ["wrist", "desktop", "vr", "hmd", "webhook", "tts", "widget"];
    let definitions = activity_type_definitions();

    for definition in &definitions {
        for enabled in std::iter::once(None).chain(SURFACES.into_iter().map(Some)) {
            let filters = Value::Object(
                SURFACES
                    .into_iter()
                    .map(|surface| {
                        let scope = if Some(surface) == enabled {
                            enabled_scope(definition)
                        } else {
                            "off"
                        };
                        (
                            surface.to_string(),
                            json!({ "types": { definition.key.key(): { "scope": scope } } }),
                        )
                    })
                    .collect(),
            );
            let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(filters));
            let sink = RecordingSink::default();
            let deliveries = sink.deliveries.clone();
            let snapshots = sink.snapshots.clone();
            runtime.set_sink(sink);
            runtime.set_friend_user_ids(["usr_actor"]);
            runtime.set_group_favorite_groups(ActivityFavoriteGroups::from_pairs([(
                "group:matrix",
                ["grp_matrix"].as_slice(),
            )]));
            runtime.arm_delivery();
            let mut row = recent_event(definition.key, "usr_actor");
            row.in_current_instance = true;
            row.facts = representative_facts();
            if definition.key == ActivityKind::GroupInstanceOpened {
                row.subject = ActivitySubject::Group("grp_matrix".to_string());
            }

            let entry = runtime.ingest(row);

            let label = format!("{} with {enabled:?} enabled", definition.key.key());
            let deliveries = deliveries.lock().unwrap();
            let delivered = deliveries.first().map(|delivery| {
                [
                    ("desktop", delivery.desktop),
                    ("vr", delivery.vr),
                    ("hmd", delivery.hmd),
                    ("webhook", delivery.webhook),
                    ("tts", delivery.tts),
                    ("widget", delivery.widget),
                ]
                .into_iter()
                .filter_map(|(surface, on)| on.then_some(surface))
                .collect::<Vec<_>>()
            });
            let in_wrist_feed = snapshots
                .lock()
                .unwrap()
                .last()
                .is_some_and(|snapshot| !snapshot.entries.is_empty());
            match enabled {
                None => {
                    assert!(entry.is_none(), "{label}");
                    assert!(deliveries.is_empty(), "{label}");
                }
                Some("wrist") => {
                    assert!(in_wrist_feed, "{label}");
                    assert!(deliveries.is_empty(), "{label}");
                }
                Some(surface) => {
                    assert!(!in_wrist_feed, "{label}");
                    assert_eq!(delivered, Some(vec![surface]), "{label}");
                }
            }
        }
    }
}

fn enabled_scope(definition: &ActivityTypeDefinition) -> &'static str {
    [
        (ActivityScope::On, "on"),
        (ActivityScope::Friends, "friends"),
        (ActivityScope::AllFavorites, "allFavorites"),
    ]
    .into_iter()
    .find(|(scope, _)| definition.allowed_scopes.contains(scope))
    .map(|(_, key)| key)
    .unwrap_or_else(|| panic!("{} has no enabling scope", definition.key.key()))
}

#[test]
fn invite_content_names_the_world_and_the_invite_message() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
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
    let mut invite = event(ActivityKind::Invite, "usr_sender");
    invite.actor.display_name = "Sender".to_string();
    invite.facts = ActivityFacts {
        location: "wrld_1".into(),
        world_name: "Invite World".into(),
        message: "come over".into(),
        ..ActivityFacts::default()
    };

    let entry = runtime.ingest(invite).unwrap();

    assert_eq!(entry.content.icon, "invite");
    assert_eq!(entry.content.title.source_text(), "Sender");
    let body = entry.content.body.as_message().expect("invite message");
    assert_eq!(body.key(), OverlayMessageKey::NotificationsInvite);
    assert_eq!(body.params()["location"], "Invite World");
    assert_eq!(body.params()["message"], "come over");
    assert_eq!(
        entry.content.body.source_text(),
        "Invite to Invite World come over"
    );
    assert_eq!(entry.content.detail, "come over");
    assert_eq!(entry.content.world_name, "Invite World");
}

#[test]
fn favorite_group_keys_serialize_as_the_frontend_config_contract() {
    assert_eq!(
        serde_json::to_value(ActivityRule {
            scope: ActivityScope::SelectedFavorites,
            favorite_group_keys: ActivityFavoriteGroupKeys::Selected(vec![
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
        serde_json::to_value(ActivityFavoriteGroupKeys::All).unwrap(),
        json!("all")
    );
}

#[test]
fn location_ids_are_not_shown_as_names() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": { "types": { "GPS": { "scope": "friends", "favoriteGroupKeys": "all" } } }
    })));
    runtime.set_friend_user_ids(["usr_map"]);
    let mut gps = event(ActivityKind::Gps, "usr_map");
    gps.actor.display_name = "Map User".to_string();
    gps.facts.location = "wrld_1234:5678~group(grp_9999)".into();

    let entry = runtime.ingest(gps).unwrap();

    assert_eq!(entry.content.body.source_text(), "In group");
    assert_eq!(
        entry
            .content
            .body
            .as_message()
            .expect("GPS message")
            .params()["location"],
        "group"
    );
    assert_eq!(entry.content.location, "wrld_1234:5678~group(grp_9999)");
}

#[test]
fn private_location_aligns_with_original_display() {
    let runtime = ActivityRouter::with_filters(ActivityFilters::from_json(json!({
        "version": 1,
        "wrist": { "types": { "GPS": { "scope": "friends", "favoriteGroupKeys": "all" } } }
    })));
    runtime.set_friend_user_ids(["usr_p"]);
    let mut gps = event(ActivityKind::Gps, "usr_p");
    gps.facts.location = "private".into();

    let entry = runtime.ingest(gps).unwrap();

    assert_eq!(entry.content.body.source_text(), "In Private");
    assert_eq!(
        entry
            .content
            .body
            .as_message()
            .expect("GPS message")
            .params()["location"],
        "Private"
    );
}

#[derive(Clone, Default)]
struct RecordingSink {
    snapshots: Arc<Mutex<Vec<ActivitySnapshot>>>,
    deliveries: Arc<Mutex<Vec<ActivityDelivery>>>,
}

impl ActivitySink for RecordingSink {
    fn emit_overlay_activity_snapshot(&self, snapshot: ActivitySnapshot) {
        self.snapshots.lock().unwrap().push(snapshot);
    }

    fn emit_overlay_activity_delivery(&self, delivery: ActivityDelivery) {
        self.deliveries.lock().unwrap().push(delivery);
    }
}

fn event(kind: ActivityKind, user_id: &str) -> ActivityEvent {
    let mut event = ActivityEvent::new(
        kind,
        format!("{}:{user_id}", kind.key()),
        "2026-05-31T00:00:00.000Z",
    );
    event.actor = ActivityActor::new(user_id, user_id);
    event.subject = ActivitySubject::User(user_id.to_string());
    event
}

fn recent_event(kind: ActivityKind, user_id: &str) -> ActivityEvent {
    ActivityEvent {
        created_at: chrono::Utc::now().to_rfc3339(),
        ..event(kind, user_id)
    }
}

fn desktop_filters_for(definitions: &[ActivityTypeDefinition]) -> ActivityFilters {
    let mut types = Map::new();
    for definition in definitions {
        let scope = if definition.allowed_scopes.contains(&ActivityScope::On) {
            "on"
        } else if definition.allowed_scopes.contains(&ActivityScope::Friends) {
            "friends"
        } else if definition
            .allowed_scopes
            .contains(&ActivityScope::AllFavorites)
        {
            "allFavorites"
        } else {
            panic!("{} has no ingestible desktop scope", definition.key.key())
        };
        types.insert(
            definition.key.key().to_string(),
            json!({
                "scope": scope,
                "favoriteGroupKeys": "all"
            }),
        );
    }

    ActivityFilters::from_json(json!({
        "version": 1,
        "desktop": {
            "types": Value::Object(types)
        }
    }))
}

fn representative_facts() -> ActivityFacts {
    ActivityFacts {
        location: "wrld_desktop:123".into(),
        world_id: "wrld_desktop".into(),
        world_name: "Desktop World".into(),
        group_id: "grp_desktop".into(),
        group_name: "Desktop Group".into(),
        title: "Desktop notification title".into(),
        message: "Desktop notification message".into(),
        status: "join me".into(),
        status_description: "Testing desktop notifications".into(),
        avatar_name: "Desktop Avatar".into(),
        previous_display_name: "Old Name".into(),
        trust_level: "Trusted".into(),
        video: "Desktop Video".into(),
        image_url: "https://example.com/thumb.png".into(),
        ..ActivityFacts::default()
    }
}

fn assert_desktop_text_key(activity_type: &str, field: &str, text: &ActivityText) {
    if let Some(message) = text.as_message() {
        let key = serde_json::to_value(message.key()).expect("serialize overlay message key");
        assert!(
            key.as_str()
                .is_some_and(|value| value.starts_with("notifications.")),
            "{activity_type} {field} should use a native notification key, got {key}"
        );
    }
}

fn assert_message_key(text: &ActivityText, expected: OverlayMessageKey) {
    assert_eq!(
        text.as_message().expect("typed overlay message").key(),
        expected
    );
}
