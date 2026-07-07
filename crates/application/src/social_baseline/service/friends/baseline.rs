use super::*;

pub(super) fn collect_suspicious_friend_ids(
    expected_ids: &[String],
    state_by_id: &HashMap<String, String>,
    fetched_friends_by_id: &HashMap<String, RemoteFriendProfile>,
) -> Vec<String> {
    let mut suspicious = Vec::new();
    for friend_id in expected_ids {
        let Some(profile) = fetched_friends_by_id.get(friend_id) else {
            continue;
        };
        let list_state = state_by_id
            .get(friend_id)
            .map(String::as_str)
            .unwrap_or("offline");
        let inferred = infer_state_from_platform(&object_field_string(&profile.raw, &["platform"]));
        let location = object_field_string(&profile.raw, &["location"]);
        if inferred != list_state || location == "traveling" {
            suspicious.push(friend_id.clone());
        }
    }
    suspicious
}

pub async fn build_friend_roster_baseline(
    deps: SocialBaselineDeps,
    input: SocialFriendRosterBaselineInput,
) -> Result<SocialFriendRosterBaselineOutput> {
    let cached_current_user =
        CurrentUserSnapshotView::from_raw(input.current_user_snapshot.as_value());
    let user_id = normalize_text(if input.user_id.is_empty() {
        cached_current_user.user_id.clone()
    } else {
        input.user_id.clone()
    });
    if user_id.is_empty() {
        return Err(Error::Custom(
            "SocialFriendRosterBaselineGet requires an authenticated user id.".into(),
        ));
    }
    if !auth_scope_matches(&deps, &user_id, &input.endpoint) {
        return Ok(stale_friend_output(user_id, String::new()));
    }

    let current_user =
        execute_vrchat_json_request(&deps, current_user_get_input(input.endpoint.clone()))
            .await
            .ok()
            .filter(|value| !object_field_string(value, &["id"]).is_empty())
            .map(|value| CurrentUserSnapshotView::from_raw(&value))
            .unwrap_or(cached_current_user);

    let CurrentUserSnapshotView {
        mut state_by_id,
        state_order_ids,
        friend_ids: snapshot_friend_ids,
        has_friend_list,
        ..
    } = current_user;
    if !has_friend_list {
        return Ok(stale_friend_output(
            user_id,
            "Current user friend list is incomplete.".into(),
        ));
    }
    let mut expected_ids = Vec::new();
    let mut expected_seen = HashSet::new();
    extend_unique(&mut expected_ids, &mut expected_seen, state_order_ids);
    extend_unique(
        &mut expected_ids,
        &mut expected_seen,
        snapshot_friend_ids.clone(),
    );

    let online_friends = fetch_all_friends(&deps, &input.endpoint, false).await?;
    let offline_friends = fetch_all_friends(&deps, &input.endpoint, true).await?;
    let mut fetched_friends_by_id: HashMap<String, RemoteFriendProfile> = HashMap::new();
    let mut fetched_friend_ids_ordered = Vec::new();
    let mut fetched_friend_ids_seen = HashSet::new();
    // Fetched `state` is unreliable and must never overwrite the /auth/user list bucket.
    for friend in online_friends {
        insert_fetched_friend(
            &mut fetched_friends_by_id,
            &mut fetched_friend_ids_ordered,
            &mut fetched_friend_ids_seen,
            friend,
            Some("online"),
        );
    }
    for friend in offline_friends {
        insert_fetched_friend(
            &mut fetched_friends_by_id,
            &mut fetched_friend_ids_ordered,
            &mut fetched_friend_ids_seen,
            friend,
            Some("offline"),
        );
    }

    if !auth_scope_matches(&deps, &user_id, &input.endpoint) {
        return Ok(stale_friend_output(user_id, String::new()));
    }

    let mut refetch_ids =
        collect_suspicious_friend_ids(&expected_ids, &state_by_id, &fetched_friends_by_id);
    if input.is_first_load {
        for friend_id in &expected_ids {
            if !fetched_friends_by_id.contains_key(friend_id) {
                refetch_ids.push(friend_id.clone());
            }
        }
    }
    if !refetch_ids.is_empty() {
        let repaired = refetch_users_concurrent(&deps, &input.endpoint, refetch_ids).await;
        for (repaired_id, user) in repaired {
            let repaired_bucket = normalize_state_bucket(&object_field_string(&user, &["state"]));
            let Some(mut profile) = RemoteFriendProfile::from_raw(user, None) else {
                continue;
            };
            profile.source_state_bucket = fetched_friends_by_id
                .get(&repaired_id)
                .and_then(|existing| existing.source_state_bucket.clone());
            fetched_friends_by_id.insert(repaired_id.clone(), profile);
            if !repaired_bucket.is_empty() {
                state_by_id.insert(repaired_id, repaired_bucket);
            }
        }
    }

    let snapshot = build_fast_roster_snapshot(
        &user_id,
        &expected_ids,
        &state_by_id,
        &fetched_friends_by_id,
    );
    let friend_log_changed =
        reconcile_friend_log_against_current(&deps, &user_id, &expected_ids, &snapshot);
    let detail = String::new();
    let count = snapshot
        .get("orderedFriendIds")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);

    Ok(SocialFriendRosterBaselineOutput {
        user_id,
        stale: false,
        count,
        detail,
        snapshot: Some(RawJson::from(snapshot)),
        friend_log_changed,
    })
}

fn reconcile_friend_log_against_current(
    deps: &SocialBaselineDeps,
    user_id: &str,
    expected_ids: &[String],
    snapshot: &Value,
) -> bool {
    let initialized = config_get_bool(deps.db.as_ref(), &format!("friendLogInit_{user_id}"), false)
        .unwrap_or(false);
    if !initialized {
        return false;
    }

    let existing = match friend_log_current_list(deps.db.as_ref(), user_id.to_string()) {
        Ok(rows) => rows,
        Err(error) => {
            tracing::warn!("friend-log reconciliation read failed: {error}");
            return false;
        }
    };

    let existing_ids: HashSet<&str> = existing.iter().map(|row| row.user_id.as_str()).collect();
    let expected_set: HashSet<&str> = expected_ids.iter().map(String::as_str).collect();

    let created_at = chrono::Utc::now().to_rfc3339();
    let friends_by_id = snapshot.get("friendsById").and_then(Value::as_object);
    let mut batch = RealtimePersistenceBatch::default();

    for friend_id in expected_ids {
        if friend_id == user_id || existing_ids.contains(friend_id.as_str()) {
            continue;
        }
        let entry = friends_by_id.and_then(|map| map.get(friend_id));
        let display_name = entry
            .map(|value| object_field_string(value, &["displayName", "display_name"]))
            .unwrap_or_default();
        let trust_level = entry
            .map(|value| object_field_string(value, &["$trustLevel", "trustLevel"]))
            .unwrap_or_default();
        batch.friend_log_upserts.push(FriendLogUpsert {
            target_user_id: friend_id.clone(),
            display_name,
            trust_level,
            friend_number: 0,
            created_at: created_at.clone(),
            force_history: false,
        });
    }

    for row in &existing {
        if row.user_id == user_id || expected_set.contains(row.user_id.as_str()) {
            continue;
        }
        batch.friend_log_deletes.push(FriendLogDelete {
            target_user_id: row.user_id.clone(),
            created_at: created_at.clone(),
        });
    }

    if batch.friend_log_upserts.is_empty() && batch.friend_log_deletes.is_empty() {
        return false;
    }

    match write_realtime_batch(deps.db.as_ref(), user_id, &batch) {
        Ok(counts) => counts.affected_count > 0,
        Err(error) => {
            tracing::warn!("friend-log reconciliation write failed: {error}");
            false
        }
    }
}
