#[cfg(test)]
mod tests {
    use super::super::*;
    use std::collections::HashMap;
    use std::env;
    use std::fs;

    #[derive(Clone)]
    struct Divergence {
        line: usize,
        ws_type: String,
        uid: String,
        fields: Vec<&'static str>,
        after_state: String,
        after_bucket: String,
        after_location: String,
        after_traveling: String,
        after_pending: bool,
        record_state: String,
        record_location: String,
        record_traveling: String,
        record_pending: bool,
    }

    fn field_str(value: Option<&Value>) -> String {
        match value {
            Some(Value::String(text)) => text.clone(),
            Some(Value::Null) | None => String::new(),
            Some(other) => other.to_string(),
        }
    }

    fn field_bool(value: Option<&Value>) -> bool {
        value.and_then(Value::as_bool).unwrap_or(false)
    }

    fn roster_record(entry: &Value) -> Option<(String, FriendRecord)> {
        let uid = entry.get("uid").and_then(Value::as_str)?.to_string();
        let record = FriendRecord {
            id: uid.clone(),
            display_name: field_str(entry.get("dn")),
            state: field_str(entry.get("state")),
            state_bucket: field_str(entry.get("state")),
            location: field_str(entry.get("loc")),
            status: field_str(entry.get("status")),
            ..FriendRecord::default()
        };
        Some((uid, record))
    }

    fn record_of(runtime: &RealtimeFriendsRuntime, uid: &str) -> Option<FriendRecord> {
        runtime
            .snapshot()
            .and_then(|snapshot| snapshot.friends_by_id.get(uid).cloned())
    }

    fn classify(d: &Divergence) -> &'static str {
        let record_online = d.record_state == "online";
        let after_not_online = d.after_bucket == "offline" || d.after_bucket == "active";
        if d.record_pending && !d.after_pending {
            return "debounce_pending_offline";
        }
        if record_online && after_not_online {
            if d.ws_type == "friend-update" {
                return "update_no_demote_embedded_state";
            }
            return "debounce_offline_active_held_online";
        }
        if !d.after_pending
            && (d.after_location == "offline" || d.after_location == "traveling")
            && d.record_location != d.after_location
            && record_online
        {
            return "debounce_location_held_online";
        }
        if d.fields == ["status"] && d.after_bucket == "offline" {
            return "status_offline_convention";
        }
        if d.fields == ["location"]
            && d.record_location == "traveling"
            && d.after_location == d.record_traveling
        {
            return "traveling_collapsed_into_location";
        }
        let rank = |bucket: &str| match bucket {
            "online" => 2,
            "active" => 1,
            _ => 0,
        };
        if rank(&d.after_bucket) > rank(&d.record_state) {
            return "reconnect_cascade_presence_higher_in_trace";
        }
        "unclassified"
    }

    fn timer_summary(action: &PendingOfflineTimerAction) -> Value {
        match action {
            PendingOfflineTimerAction::None => json!({ "kind": "none" }),
            PendingOfflineTimerAction::Schedule {
                user_id,
                token,
                delay_ms,
            } => json!({
                "kind": "schedule",
                "userId": user_id,
                "token": token,
                "delayMs": delay_ms,
            }),
        }
    }

    // Feed-entry `time` durations are computed from Utc::now() at apply time, so they differ
    // between the golden run and any later replay; null them out so equivalence covers structure.
    fn normalize_feed_times(value: &mut Value) {
        if let Some(entries) = value.as_array_mut() {
            for entry in entries {
                if let Some(object) = entry.as_object_mut() {
                    if object.contains_key("time") {
                        object.insert("time".into(), Value::Null);
                    }
                }
            }
        }
    }

    fn output_to_value(output: &RealtimeFriendOutput) -> Value {
        let mut projection = serde_json::to_value(&output.projection).unwrap_or(Value::Null);
        if let Some(feeds) = projection.get_mut("feedEntries") {
            normalize_feed_times(feeds);
        }
        let mut persistence = serde_json::to_value(&output.persistence).unwrap_or(Value::Null);
        if let Some(feeds) = persistence.get_mut("feedEntries") {
            normalize_feed_times(feeds);
        }
        json!({
            "ownerUserId": output.owner_user_id,
            "projection": projection,
            "persistence": persistence,
            "timer": timer_summary(&output.timer_action),
            "profileRefetchUserIds": output.profile_refetch_user_ids,
            "friendNoteChanged": output.friend_note_changed,
        })
    }

    fn event_dump_line(
        runtime: &RealtimeFriendsRuntime,
        line_no: usize,
        kind: &str,
        uid: &str,
        ws_type: &str,
        result: &str,
        output: Option<&RealtimeFriendOutput>,
    ) -> String {
        let record = record_of(runtime, uid)
            .map(|record| serde_json::to_value(&record).unwrap_or(Value::Null))
            .unwrap_or(Value::Null);
        let entry = json!({
            "line": line_no,
            "kind": kind,
            "uid": uid,
            "wsType": ws_type,
            "result": result,
            "record": record,
            "output": output.map(output_to_value).unwrap_or(Value::Null),
        });
        serde_json::to_string(&entry).unwrap_or_default()
    }

    fn first_json_diff(a: &Value, b: &Value, path: &str) -> Option<(String, String, String)> {
        match (a, b) {
            (Value::Object(a_map), Value::Object(b_map)) => {
                let mut keys: Vec<&String> = a_map.keys().chain(b_map.keys()).collect();
                keys.sort();
                keys.dedup();
                for key in keys {
                    let next = format!("{path}.{key}");
                    match (a_map.get(key), b_map.get(key)) {
                        (Some(av), Some(bv)) => {
                            if let Some(diff) = first_json_diff(av, bv, &next) {
                                return Some(diff);
                            }
                        }
                        (present_a, present_b) => {
                            return Some((
                                next,
                                present_a
                                    .map(ToString::to_string)
                                    .unwrap_or("<absent>".into()),
                                present_b
                                    .map(ToString::to_string)
                                    .unwrap_or("<absent>".into()),
                            ));
                        }
                    }
                }
                None
            }
            (Value::Array(a_arr), Value::Array(b_arr)) => {
                if a_arr.len() != b_arr.len() {
                    return Some((
                        format!("{path}.len"),
                        a_arr.len().to_string(),
                        b_arr.len().to_string(),
                    ));
                }
                for (index, (av, bv)) in a_arr.iter().zip(b_arr).enumerate() {
                    if let Some(diff) = first_json_diff(av, bv, &format!("{path}[{index}]")) {
                        return Some(diff);
                    }
                }
                None
            }
            _ => {
                if a == b {
                    None
                } else {
                    Some((path.to_string(), a.to_string(), b.to_string()))
                }
            }
        }
    }

    #[test]
    #[ignore]
    fn ws_trace_replay_matches_after_state() {
        let Ok(path) = env::var("VRCX0_WS_TRACE") else {
            eprintln!("VRCX0_WS_TRACE not set; skipping ws-trace replay");
            return;
        };
        let raw = fs::read_to_string(&path).expect("read ws-trace file");

        let dump_path = env::var("VRCX0_REPLAY_DUMP").ok();
        let expect_lines: Option<Vec<String>> = env::var("VRCX0_REPLAY_EXPECT").ok().map(|path| {
            fs::read_to_string(&path)
                .expect("read expect file")
                .lines()
                .map(str::to_string)
                .collect()
        });
        let mut dumped: Vec<String> = Vec::new();
        let mut event_index = 0usize;
        let mut first_expect_diff: Option<String> = None;

        let runtime = RealtimeFriendsRuntime::new();
        let mut latest_token: HashMap<String, u64> = HashMap::new();

        let mut baselines = 0usize;
        let mut ws_events = 0usize;
        let mut fire_events = 0usize;
        let mut compared = 0usize;
        let mut matched = 0usize;
        let mut record_missing = 0usize;
        let mut fire_no_token = 0usize;
        let mut traveling_field_diffs = 0usize;
        let mut traveling_seed_direction = 0usize;
        let mut traveling_convention_direction = 0usize;

        let mut divergences: Vec<Divergence> = Vec::new();

        {
            let mut record_event =
                |runtime: &RealtimeFriendsRuntime,
                 line_no: usize,
                 kind: &str,
                 uid: &str,
                 ws_type: &str,
                 result: &str,
                 output: Option<&RealtimeFriendOutput>| {
                    let line =
                        event_dump_line(runtime, line_no, kind, uid, ws_type, result, output);
                    if let Some(expect) = expect_lines.as_ref() {
                        if first_expect_diff.is_none() {
                            match expect.get(event_index) {
                                None => {
                                    first_expect_diff = Some(format!(
                                    "event {event_index} (trace L{line_no}): golden has no such line"
                                ));
                                }
                                Some(golden) if golden != &line => {
                                    let detail = match (
                                    serde_json::from_str::<Value>(golden),
                                    serde_json::from_str::<Value>(&line),
                                ) {
                                    (Ok(g), Ok(n)) => first_json_diff(&g, &n, "$")
                                        .map(|(field, golden_value, new_value)| {
                                            format!(
                                                "field={field} golden={golden_value} new={new_value}"
                                            )
                                        })
                                        .unwrap_or_else(|| "string differs".into()),
                                    _ => "unparseable line".into(),
                                };
                                    first_expect_diff = Some(format!(
                                    "event {event_index} (trace L{line_no} {kind} {uid}): {detail}"
                                ));
                                }
                                Some(_) => {}
                            }
                        }
                    }
                    if dump_path.is_some() {
                        dumped.push(line);
                    }
                    event_index += 1;
                };

            for (index, line) in raw.lines().enumerate() {
                let line_no = index + 1;
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let entry: Value = serde_json::from_str(line)
                    .unwrap_or_else(|error| panic!("line {line_no}: invalid json: {error}"));
                let kind = entry.get("kind").and_then(Value::as_str).unwrap_or("");

                match kind {
                    "baseline" => {
                        baselines += 1;
                        let generation =
                            entry.get("generation").and_then(Value::as_u64).unwrap_or(0);
                        let revision = entry.get("revision").and_then(Value::as_u64).unwrap_or(0);
                        let mut friends_by_id = HashMap::new();
                        if let Some(roster) = entry.get("roster").and_then(Value::as_array) {
                            for row in roster {
                                if let Some((uid, record)) = roster_record(row) {
                                    friends_by_id.insert(uid, record);
                                }
                            }
                        }
                        let (_result, schedules) = runtime.set_baseline_with_schedules(
                            FriendRosterBaseline {
                                current_user_id: "usr_self".into(),
                                friends_by_id,
                                ..FriendRosterBaseline::default()
                            },
                            generation,
                            revision,
                        );
                        for (uid, token, _delay) in schedules {
                            latest_token.insert(uid, token);
                        }
                    }
                    "ws" => {
                        ws_events += 1;
                        let uid = entry
                            .get("uid")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let ws_type = entry
                            .get("ws")
                            .and_then(|ws| ws.get("type"))
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let received_at = entry.get("at").and_then(Value::as_str).unwrap_or("");
                        let payload = RealtimeWsMessagePayload {
                            json: entry.get("ws").cloned().unwrap_or(Value::Null),
                            raw: "{}".into(),
                            received_at: received_at.to_string(),
                        };
                        let (result_str, output) = match runtime.apply_ws_message(&payload) {
                            RealtimeFriendApplyResult::Output(output) => ("output", Some(output)),
                            RealtimeFriendApplyResult::MissingBaseline => ("missingBaseline", None),
                            RealtimeFriendApplyResult::Ignored => ("ignored", None),
                        };
                        if let Some(output) = output.as_ref() {
                            if let PendingOfflineTimerAction::Schedule { user_id, token, .. } =
                                &output.timer_action
                            {
                                latest_token.insert(user_id.clone(), *token);
                            }
                        }
                        record_event(
                            &runtime,
                            line_no,
                            "ws",
                            &uid,
                            &ws_type,
                            result_str,
                            output.as_deref(),
                        );
                        compare_after(
                            &runtime,
                            line_no,
                            &ws_type,
                            &uid,
                            entry.get("after"),
                            &mut compared,
                            &mut matched,
                            &mut record_missing,
                            &mut traveling_field_diffs,
                            &mut traveling_seed_direction,
                            &mut traveling_convention_direction,
                            &mut divergences,
                        );
                    }
                    "fire" => {
                        fire_events += 1;
                        let uid = entry
                            .get("uid")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_string();
                        let received_at = entry.get("at").and_then(Value::as_str).unwrap_or("");
                        let (result_str, output) = match latest_token.get(&uid).copied() {
                            Some(token) => {
                                match runtime.fire_pending_offline(
                                    &uid,
                                    token,
                                    received_at.to_string(),
                                ) {
                                    Some(output) => ("output", Some(output)),
                                    None => ("none", None),
                                }
                            }
                            None => {
                                fire_no_token += 1;
                                ("noToken", None)
                            }
                        };
                        record_event(
                            &runtime,
                            line_no,
                            "fire",
                            &uid,
                            "",
                            result_str,
                            output.as_ref(),
                        );
                        compare_after(
                            &runtime,
                            line_no,
                            "fire",
                            &uid,
                            entry.get("after"),
                            &mut compared,
                            &mut matched,
                            &mut record_missing,
                            &mut traveling_field_diffs,
                            &mut traveling_seed_direction,
                            &mut traveling_convention_direction,
                            &mut divergences,
                        );
                    }
                    _ => {}
                }
            }
        }

        if let Some(path) = dump_path.as_ref() {
            fs::write(path, format!("{}\n", dumped.join("\n"))).expect("write dump file");
            eprintln!("wrote {} golden event lines to {path}", dumped.len());
        }

        if let Some(expected) = expect_lines.as_ref() {
            if let Some(diff) = first_expect_diff.as_ref() {
                panic!("VRCX0_REPLAY_EXPECT mismatch: {diff}");
            }
            assert_eq!(
                expected.len(),
                event_index,
                "golden line count {} != replayed events {event_index}",
                expected.len()
            );
            eprintln!("VRCX0_REPLAY_EXPECT: {event_index} events match golden byte-for-byte");
        }

        let mut by_category: HashMap<&'static str, usize> = HashMap::new();
        let mut by_field: HashMap<&'static str, usize> = HashMap::new();
        let mut by_type: HashMap<String, usize> = HashMap::new();
        let mut residual: Vec<&Divergence> = Vec::new();
        for divergence in &divergences {
            let category = classify(divergence);
            *by_category.entry(category).or_insert(0) += 1;
            *by_type.entry(divergence.ws_type.clone()).or_insert(0) += 1;
            for field in &divergence.fields {
                *by_field.entry(field).or_insert(0) += 1;
            }
            if category == "unclassified" {
                residual.push(divergence);
            }
        }

        eprintln!("=== ws-trace replay summary ===");
        eprintln!("baselines={baselines} ws={ws_events} fire={fire_events}");
        eprintln!(
            "compared={compared} matched={matched} divergences={}",
            divergences.len()
        );
        eprintln!("record_missing_on_compare={record_missing} fire_no_token={fire_no_token}");
        eprintln!(
            "EXCLUDED travelingToLocation field (unvalidatable): total={} seed_direction(ours_empty)={} convention_direction(ours_nonempty)={}",
            traveling_field_diffs, traveling_seed_direction, traveling_convention_direction
        );
        eprintln!("--- divergences by root-cause category ---");
        let mut categories: Vec<(&&'static str, &usize)> = by_category.iter().collect();
        categories.sort_by(|a, b| b.1.cmp(a.1));
        for (category, count) in categories {
            eprintln!("  {category}: {count}");
        }
        eprintln!("--- differing fields across divergences ---");
        let mut fields: Vec<(&&'static str, &usize)> = by_field.iter().collect();
        fields.sort_by(|a, b| b.1.cmp(a.1));
        for (field, count) in fields {
            eprintln!("  {field}: {count}");
        }
        eprintln!("--- divergences by ws type ---");
        let mut types: Vec<(&String, &usize)> = by_type.iter().collect();
        types.sort_by(|a, b| b.1.cmp(a.1));
        for (ws_type, count) in types {
            eprintln!("  {ws_type}: {count}");
        }
        eprintln!("--- residual (unclassified) count={} ---", residual.len());
        for divergence in residual.iter().take(40) {
            eprintln!(
                "  L{} {} {} fields={:?} after[state={} loc={} trav={} pend={}] record[state={} loc={} trav={} pend={}]",
                divergence.line,
                divergence.ws_type,
                divergence.uid,
                divergence.fields,
                divergence.after_state,
                divergence.after_location,
                divergence.after_traveling,
                divergence.after_pending,
                divergence.record_state,
                divergence.record_location,
                divergence.record_traveling,
                divergence.record_pending,
            );
        }
        if residual.len() > 40 {
            eprintln!("  ... {} more residual", residual.len() - 40);
        }

        assert_eq!(
            residual.len(),
            0,
            "unclassified ws-trace residual divergences (see stderr breakdown)"
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn compare_after(
        runtime: &RealtimeFriendsRuntime,
        line_no: usize,
        ws_type: &str,
        uid: &str,
        after: Option<&Value>,
        compared: &mut usize,
        matched: &mut usize,
        record_missing: &mut usize,
        traveling_field_diffs: &mut usize,
        traveling_seed_direction: &mut usize,
        traveling_convention_direction: &mut usize,
        divergences: &mut Vec<Divergence>,
    ) {
        let Some(after) = after.filter(|value| value.is_object()) else {
            return;
        };
        *compared += 1;
        let Some(record) = record_of(runtime, uid) else {
            *record_missing += 1;
            return;
        };

        let record_pending = record
            .extra
            .get("pendingOffline")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        let after_state = field_str(after.get("state"));
        let after_bucket = field_str(after.get("stateBucket"));
        let after_location = field_str(after.get("location"));
        let after_traveling = field_str(after.get("traveling"));
        let after_pending = field_bool(after.get("pendingOffline"));

        if after_traveling != record.traveling_to_location {
            *traveling_field_diffs += 1;
            if record.traveling_to_location.trim().is_empty() {
                *traveling_seed_direction += 1;
            } else {
                *traveling_convention_direction += 1;
            }
        }

        let mut fields: Vec<&'static str> = Vec::new();
        if after_location != record.location {
            fields.push("location");
        }
        if after_state != record.state {
            fields.push("state");
        }
        if after_bucket != record.state_bucket {
            fields.push("stateBucket");
        }
        if field_str(after.get("status")) != record.status {
            fields.push("status");
        }
        if after_pending != record_pending {
            fields.push("pendingOffline");
        }

        if fields.is_empty() {
            *matched += 1;
            return;
        }

        divergences.push(Divergence {
            line: line_no,
            ws_type: ws_type.to_string(),
            uid: uid.to_string(),
            fields,
            after_state,
            after_bucket,
            after_location,
            after_traveling,
            after_pending,
            record_state: record.state.clone(),
            record_location: record.location.clone(),
            record_traveling: record.traveling_to_location.clone(),
            record_pending,
        });
    }
}
