use super::*;
use serde_json::json;
use vrcx_0_core::friends::FriendRecord;

fn friend(
    id: &str,
    display_name: &str,
    state_bucket: &str,
    location: &str,
) -> (FriendRecord, PresenceView) {
    friend_on_platform(id, display_name, state_bucket, location, "")
}

fn friend_on_platform(
    id: &str,
    display_name: &str,
    state_bucket: &str,
    location: &str,
    platform: &str,
) -> (FriendRecord, PresenceView) {
    let profile = json!({ "state": state_bucket, "location": location, "platform": platform });
    (
        FriendRecord {
            id: id.into(),
            display_name: display_name.into(),
            ..FriendRecord::default()
        },
        PresenceView::from_profile(profile.as_object().expect("profile object")),
    )
}

fn params(states: Option<Vec<&str>>, include_location: Option<bool>) -> OnlineFriendsParams {
    OnlineFriendsParams {
        states: states.map(|values| values.into_iter().map(String::from).collect()),
        include_location,
    }
}

fn row_ids(output: &OnlineFriendsOutput) -> Vec<&str> {
    output.rows.iter().map(|row| row.user_id.as_str()).collect()
}

#[test]
fn defaults_to_online_and_active_states_and_excludes_offline() {
    let friends = vec![
        friend("usr_a", "Alice", "online", ""),
        friend("usr_b", "Bob", "active", ""),
        friend("usr_c", "Carol", "offline", ""),
        friend("usr_d", "Dave", "ask me", ""),
    ];

    let output = build_online_friends_output(friends, params(None, None));

    assert_eq!(row_ids(&output), vec!["usr_a", "usr_b"]);
}

#[test]
fn custom_states_are_trimmed_and_lowercased_before_matching() {
    let friends = vec![
        friend("usr_a", "Alice", "active", ""),
        friend("usr_b", "Bob", "online", ""),
    ];

    let output = build_online_friends_output(friends, params(Some(vec![" Active "]), None));

    assert_eq!(row_ids(&output), vec!["usr_a"]);
}

#[test]
fn rows_are_sorted_by_display_name_then_user_id() {
    let friends = vec![
        friend("usr_b", "Zed", "online", ""),
        friend("usr_a", "Alice", "online", ""),
        friend("usr_c", "Alice", "online", ""),
    ];

    let output = build_online_friends_output(friends, params(None, None));

    assert_eq!(row_ids(&output), vec!["usr_a", "usr_c", "usr_b"]);
}

#[test]
fn location_fields_are_populated_and_access_type_normalized_by_default() {
    let (mut alice, view) = friend(
        "usr_a",
        "Alice",
        "online",
        "wrld_1234:56789~hidden(usr_owner)",
    );
    alice.extra.insert("worldName".into(), json!("Cool World"));

    let output = build_online_friends_output(vec![(alice, view)], params(None, None));

    let row = &output.rows[0];
    assert_eq!(
        row.location.as_deref(),
        Some("wrld_1234:56789~hidden(usr_owner)")
    );
    assert_eq!(row.world_id.as_deref(), Some("wrld_1234"));
    assert_eq!(row.world_name.as_deref(), Some("Cool World"));
    assert_eq!(row.instance_access_type.as_deref(), Some("friendsPlus"));
}

#[test]
fn world_name_falls_back_to_snake_case_extra_key() {
    let (mut alice, view) = friend("usr_a", "Alice", "online", "wrld_1234:56789");
    alice
        .extra
        .insert("world_name".into(), json!("Snake World"));

    let output = build_online_friends_output(vec![(alice, view)], params(None, None));

    assert_eq!(output.rows[0].world_name.as_deref(), Some("Snake World"));
}

#[test]
fn include_location_false_hides_location_fields_but_keeps_state_and_status() {
    let (mut alice, view) = friend("usr_a", "Alice", "online", "wrld_1234:56789");
    alice.status = "join me".into();

    let output = build_online_friends_output(vec![(alice, view)], params(None, Some(false)));

    let row = &output.rows[0];
    assert!(row.location.is_none());
    assert!(row.world_id.is_none());
    assert!(row.world_name.is_none());
    assert!(row.instance_access_type.is_none());
    assert_eq!(row.state, "online");
    assert_eq!(row.status, "join me");
}

#[test]
fn platform_prefers_current_platform_and_falls_back_to_last_platform() {
    let (mut alice, alice_view) = friend_on_platform("usr_a", "Alice", "online", "", "android");
    alice.last_platform = "standalonewindows".into();
    let (mut bob, bob_view) = friend("usr_b", "Bob", "online", "");
    bob.last_platform = "standalonewindows".into();
    let (mut carol, carol_view) = friend_on_platform("usr_c", "Carol", "online", "", "web");
    carol.last_platform = "android".into();

    let output = build_online_friends_output(
        vec![(alice, alice_view), (bob, bob_view), (carol, carol_view)],
        params(None, None),
    );

    assert_eq!(output.rows[0].platform, "android");
    assert_eq!(output.rows[1].platform, "standalonewindows");
    assert_eq!(output.rows[2].platform, "android");
}

#[test]
fn display_name_falls_back_to_username_then_id() {
    let mut no_display_name = friend("usr_a", "", "online", "");
    no_display_name.0.username = "aliceusername".into();
    let no_name_at_all = friend("usr_b", "", "online", "");

    let output =
        build_online_friends_output(vec![no_display_name, no_name_at_all], params(None, None));

    let alice = output
        .rows
        .iter()
        .find(|row| row.user_id == "usr_a")
        .unwrap();
    assert_eq!(alice.display_name, "aliceusername");
    let bob = output
        .rows
        .iter()
        .find(|row| row.user_id == "usr_b")
        .unwrap();
    assert_eq!(bob.display_name, "usr_b");
}

#[test]
fn summary_reports_no_friends_when_the_filtered_list_is_empty() {
    let output = build_online_friends_output(vec![], params(None, None));

    assert_eq!(output.summary, "No friends are online right now.");
}

#[test]
fn summary_lists_friend_count_and_names() {
    let friends = vec![
        friend("usr_a", "Alice", "online", ""),
        friend("usr_b", "Bob", "online", ""),
    ];

    let output = build_online_friends_output(friends, params(None, None));

    assert_eq!(output.summary, "2 friends online now: Alice, Bob.");
}

#[test]
fn online_friends_params_accept_string_booleans_from_models() {
    let params: OnlineFriendsParams =
        serde_json::from_value(json!({ "includeLocation": "true" })).unwrap();
    assert_eq!(params.include_location, Some(true));

    let params: OnlineFriendsParams = serde_json::from_value(json!({})).unwrap();
    assert_eq!(params.include_location, None);
}
