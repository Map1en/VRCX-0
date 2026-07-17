use super::*;

fn add_state_bucket_ids(
    snapshot: &Value,
    key: &str,
    deps: &str,
    state_by_id: &mut HashMap<String, String>,
    ordered_ids: &mut Vec<String>,
    seen: &mut HashSet<String>,
) {
    for user_id in string_array_field(snapshot, key) {
        if user_id.is_empty() {
            continue;
        }
        unique_push(ordered_ids, seen, user_id.clone());
        state_by_id.insert(user_id, deps.to_string());
    }
}

pub(in super::super) fn build_friend_state_map(
    snapshot: &Value,
) -> (HashMap<String, String>, Vec<String>) {
    let mut state_by_id = HashMap::new();
    let mut ordered_ids = Vec::new();
    let mut seen = HashSet::new();
    add_state_bucket_ids(
        snapshot,
        "friends",
        "offline",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    add_state_bucket_ids(
        snapshot,
        "offlineFriends",
        "offline",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    add_state_bucket_ids(
        snapshot,
        "activeFriends",
        "active",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    add_state_bucket_ids(
        snapshot,
        "onlineFriends",
        "online",
        &mut state_by_id,
        &mut ordered_ids,
        &mut seen,
    );
    (state_by_id, ordered_ids)
}

pub(in super::super) fn build_snapshot_friend_ids(
    snapshot: &Value,
) -> (Vec<String>, HashSet<String>, bool) {
    let has_friend_list = object_field(snapshot, "friends").is_some_and(Value::is_array);
    let friend_ids = string_array_field(snapshot, "friends");
    let friend_set = friend_ids.iter().cloned().collect();
    (friend_ids, friend_set, has_friend_list)
}
