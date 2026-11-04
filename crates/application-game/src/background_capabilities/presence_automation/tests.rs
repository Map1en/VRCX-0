use super::evaluation::{condition_matches, PresenceRuleEvaluation};
use super::*;
use serde_json::json;
use vrcx_0_application_core::{FavoriteEntityKind, MemoryConfigStore};

#[test]
fn presence_rule_storage_preserves_open_json_fields() {
    let config = MemoryConfigStore::default();
    let rule = json!({
        "id": "future-rule",
        "conditions": [{"type": "futureCondition", "extra": 42}],
        "actions": {"futureAction": {"enabled": true}}
    });

    presence_automation_rules_set(
        &config,
        PresenceAutomationRuleKind::Context,
        vec![RawJson::from(rule.clone())],
    )
    .unwrap();
    let loaded =
        presence_automation_rules_get(&config, PresenceAutomationRuleKind::Context).unwrap();

    assert_eq!(loaded.len(), 1);
    assert_eq!(loaded[0].as_value(), &rule);
}

#[test]
fn toggling_one_presence_rule_keeps_the_other_rules_and_fields() {
    let config = MemoryConfigStore::default();
    presence_automation_rules_set(
        &config,
        PresenceAutomationRuleKind::Time,
        vec![
            RawJson::from(json!({"id": "morning", "enabled": false, "label": "Wake"})),
            RawJson::from(json!({"id": "evening", "enabled": false})),
        ],
    )
    .unwrap();

    let saved = presence_automation_rule_enabled_set(
        &config,
        PresenceAutomationRuleKind::Time,
        "morning",
        true,
    )
    .unwrap();
    let loaded = presence_automation_rules_get(&config, PresenceAutomationRuleKind::Time).unwrap();

    let expected = vec![
        json!({"id": "morning", "enabled": true, "label": "Wake"}),
        json!({"id": "evening", "enabled": false}),
    ];
    let values = |rules: &[RawJson]| {
        rules
            .iter()
            .map(|rule| rule.as_value().clone())
            .collect::<Vec<_>>()
    };
    assert_eq!(values(&saved), expected);
    assert_eq!(values(&loaded), expected);
}

#[test]
fn renaming_a_local_favorite_group_rewrites_only_rules_of_that_kind() {
    let config = MemoryConfigStore::default();
    let rule = |groups: &[&str]| {
        json!({
            "id": "rule",
            "selectedGroups": groups,
            "selectedWorldGroups": groups,
            "conditions": [
                {"type": "hasFriendInGroups", "values": groups},
                {"type": "worldInFavoriteGroups", "values": groups},
                {"type": "futureCondition", "values": groups}
            ]
        })
    };
    for kind in [
        PresenceAutomationRuleKind::Time,
        PresenceAutomationRuleKind::Context,
    ] {
        presence_automation_rules_set(
            &config,
            kind,
            vec![RawJson::from(rule(&["group_0", "local:Close"]))],
        )
        .unwrap();
    }

    presence_automation_local_group_renamed(&config, FavoriteEntityKind::Friend, "Close", "Inner")
        .unwrap();

    for kind in [
        PresenceAutomationRuleKind::Time,
        PresenceAutomationRuleKind::Context,
    ] {
        let loaded = presence_automation_rules_get(&config, kind).unwrap();
        let rule = loaded[0].as_value();
        assert_eq!(rule["selectedGroups"], json!(["group_0", "local:Inner"]));
        assert_eq!(
            rule["conditions"][0]["values"],
            json!(["group_0", "local:Inner"])
        );
        assert_eq!(
            rule["selectedWorldGroups"],
            json!(["group_0", "local:Close"])
        );
        assert_eq!(
            rule["conditions"][1]["values"],
            json!(["group_0", "local:Close"])
        );
        assert_eq!(
            rule["conditions"][2]["values"],
            json!(["group_0", "local:Close"])
        );
    }

    presence_automation_local_group_renamed(&config, FavoriteEntityKind::World, "Close", "Visited")
        .unwrap();
    let loaded =
        presence_automation_rules_get(&config, PresenceAutomationRuleKind::Context).unwrap();
    let rule = loaded[0].as_value();
    assert_eq!(
        rule["selectedWorldGroups"],
        json!(["group_0", "local:Visited"])
    );
    assert_eq!(
        rule["conditions"][1]["values"],
        json!(["group_0", "local:Visited"])
    );
    assert_eq!(rule["selectedGroups"], json!(["group_0", "local:Inner"]));
}

#[test]
fn forcing_game_running_prepends_a_single_game_running_condition() {
    let rule = json!({
        "conditions": [
            {"type": "futureCondition", "value": "future-value"},
            {"type": "isGameRunning", "value": false},
            {"type": "isGameRunning"},
        ],
        "actions": {"status": "join me"},
    });
    let action_value = rule["actions"]["status"].as_str().unwrap().as_ptr();
    let condition_value = rule["conditions"][0]["value"].as_str().unwrap().as_ptr();

    let forced = force_game_running_condition(rule);

    assert_eq!(
        forced["conditions"],
        json!([
            {"type": "isGameRunning"},
            {"type": "futureCondition", "value": "future-value"},
        ])
    );
    assert_eq!(forced["actions"], json!({"status": "join me"}));
    assert_eq!(
        forced["actions"]["status"].as_str().unwrap().as_ptr(),
        action_value
    );
    assert_eq!(
        forced["conditions"][1]["value"].as_str().unwrap().as_ptr(),
        condition_value
    );
}

#[test]
fn legacy_company_rule_beats_alone_rule_by_priority() {
    let facts = BackgroundPresenceFacts {
        is_game_running: true,
        player_facts_known: true,
        player_count: 1,
        instance_type: "public".into(),
        ..Default::default()
    };
    let rules = vec![
        json!({
            "id": "legacy-alone",
            "enabled": true,
            "priority": 100,
            "conditions": [{"type": "playerFactsKnown"}],
            "actions": {"status": "join me"},
        }),
        json!({
            "id": "legacy-company",
            "enabled": true,
            "priority": 200,
            "conditions": [{"type": "withCompany"}],
            "actions": {"status": "busy"},
            "stopProcessing": true,
        }),
    ];

    let result = evaluate_presence_rules(&facts, &rules);

    assert_eq!(
        result.patch.get("status"),
        Some(&Value::String("busy".into()))
    );
}

#[test]
fn cached_automation_state_restores_previous_status_after_restart() {
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "vrcx-0-presence-state-{}-{nonce}",
        std::process::id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("presenceAutomationState.json");

    let mut state = BackgroundPresenceAutomationState {
        scope_key: "https://api.example:usr_1".into(),
        ..Default::default()
    };
    state.time_restore_snapshots.insert(
        "status".into(),
        TimeRestoreSnapshot {
            previous_value: "active".into(),
            automated_value: "busy".into(),
        },
    );
    let mut last_serialized = String::new();
    state.persist_cached(&path, &mut last_serialized);
    assert!(!last_serialized.is_empty());
    let before_rewrite = std::fs::metadata(&path).unwrap().modified().unwrap();
    state.persist_cached(&path, &mut last_serialized);
    assert_eq!(
        std::fs::metadata(&path).unwrap().modified().unwrap(),
        before_rewrite
    );

    let mut loaded = BackgroundPresenceAutomationState::load_cached(&path);
    assert_eq!(loaded.scope_key, "https://api.example:usr_1");

    let facts = BackgroundPresenceFacts {
        current_user: json!({ "status": "busy" }).into(),
        ..Default::default()
    };
    let effective =
        build_patch_with_time_restore(&facts, &PresenceRuleEvaluation::default(), &mut loaded);
    assert_eq!(
        effective.patch.get("status"),
        Some(&Value::String("active".into()))
    );

    let missing = BackgroundPresenceAutomationState::load_cached(&dir.join("missing.json"));
    assert!(missing.scope_key.is_empty());
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn world_in_favorite_groups_matches_selected_or_any_group() {
    let facts = BackgroundPresenceFacts {
        current_world_favorite_group_keys: vec!["world:worlds1".into()],
        ..Default::default()
    };

    let any_group = json!({ "type": "worldInFavoriteGroups", "values": [] });
    let selected = json!({ "type": "worldInFavoriteGroups", "values": ["world:worlds1"] });
    let other = json!({ "type": "worldInFavoriteGroups", "values": ["local:Favorites"] });

    assert!(condition_matches(&any_group, &facts));
    assert!(condition_matches(&selected, &facts));
    assert!(!condition_matches(&other, &facts));
    assert!(!condition_matches(
        &any_group,
        &BackgroundPresenceFacts::default()
    ));
}

#[test]
fn instance_group_in_matches_only_selected_group_instances() {
    let facts = BackgroundPresenceFacts {
        parsed_location: vrcx_0_core::location::parse_location(
            "wrld_1:12345~group(grp_selected)~groupAccessType(members)~region(jp)",
        ),
        ..Default::default()
    };

    let selected = json!({ "type": "instanceGroupIn", "values": ["grp_selected"] });
    let other = json!({ "type": "instanceGroupIn", "values": ["grp_other"] });
    let none = json!({ "type": "instanceGroupIn", "values": [] });

    assert!(condition_matches(&selected, &facts));
    assert!(!condition_matches(&other, &facts));
    assert!(!condition_matches(&none, &facts));
    assert!(!condition_matches(
        &selected,
        &BackgroundPresenceFacts {
            parsed_location: vrcx_0_core::location::parse_location("wrld_1:12345~region(jp)"),
            ..Default::default()
        }
    ));
}
