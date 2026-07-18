use vrcx_0_persistence::game_log::GameLogJoinLeaveSnapshot;

use super::runtime_state::{parse_event_time_ms, player_key};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RosterPlayer {
    pub user_id: String,
    pub display_name: String,
    pub joined_at: String,
    pub joined_at_ms: Option<i64>,
}

struct RosterLeaveCandidate {
    key: String,
    user_id: String,
    display_name: String,
    joined_at_ms: Option<i64>,
}

pub(super) fn resolve_leave_key(
    candidates: &[(String, String)],
    user_id: &str,
    display_name: &str,
) -> Option<String> {
    let candidates = candidates
        .iter()
        .map(|(key, display_name)| RosterLeaveCandidate {
            key: key.clone(),
            user_id: String::new(),
            display_name: display_name.clone(),
            joined_at_ms: None,
        })
        .collect::<Vec<_>>();
    resolve_leave_candidate_key(&candidates, user_id, display_name, None, 0)
}

fn resolve_leave_candidate_key(
    candidates: &[RosterLeaveCandidate],
    user_id: &str,
    display_name: &str,
    left_at_ms: Option<i64>,
    duration_ms: i64,
) -> Option<String> {
    let key = player_key(user_id, display_name);
    if candidates.iter().any(|candidate| candidate.key == key) {
        return Some(key);
    }

    let normalized_display_name = display_name.trim();
    if normalized_display_name.is_empty() {
        return None;
    }

    let matches = candidates
        .iter()
        .filter(|candidate| {
            candidate
                .display_name
                .trim()
                .eq_ignore_ascii_case(normalized_display_name)
        })
        .map(|candidate| candidate.key.clone())
        .collect::<Vec<_>>();
    if matches.len() == 1 {
        return matches.into_iter().next();
    }

    resolve_duration_leave_key(candidates, normalized_display_name, left_at_ms, duration_ms)
}

fn resolve_duration_leave_key(
    candidates: &[RosterLeaveCandidate],
    display_name: &str,
    left_at_ms: Option<i64>,
    duration_ms: i64,
) -> Option<String> {
    let left_at_ms = left_at_ms?;
    if duration_ms <= 0 {
        return None;
    }
    let joined_at_ms = left_at_ms - duration_ms;
    let matches = candidates
        .iter()
        .filter(|candidate| candidate.user_id.trim().is_empty())
        .filter(|candidate| {
            candidate.joined_at_ms.is_some_and(|candidate_joined_at| {
                (candidate_joined_at - joined_at_ms).abs() <= 1000
            })
        })
        .collect::<Vec<_>>();
    if matches.len() == 1 {
        return Some(matches[0].key.clone());
    }
    let name_matches = matches
        .into_iter()
        .filter(|candidate| {
            candidate
                .display_name
                .trim()
                .eq_ignore_ascii_case(display_name)
        })
        .map(|candidate| candidate.key.clone())
        .collect::<Vec<_>>();
    if name_matches.len() == 1 {
        return name_matches.into_iter().next();
    }
    None
}

fn join_key(entry: &GameLogJoinLeaveSnapshot) -> String {
    if !entry.user_id.trim().is_empty() {
        player_key(&entry.user_id, &entry.display_name)
    } else if entry.id > 0 {
        format!("row:{}", entry.id)
    } else {
        player_key(&entry.user_id, &entry.display_name)
    }
}

pub fn fold_roster(entries: &[GameLogJoinLeaveSnapshot]) -> Vec<(String, RosterPlayer)> {
    let mut players: Vec<(String, RosterPlayer)> = Vec::new();
    for entry in entries {
        if entry.user_id.trim().is_empty() && entry.display_name.trim().is_empty() {
            continue;
        }
        match entry.event_type.as_str() {
            "OnPlayerJoined" => {
                let key = join_key(entry);
                let player = RosterPlayer {
                    user_id: entry.user_id.clone(),
                    display_name: entry.display_name.clone(),
                    joined_at: entry.created_at.clone(),
                    joined_at_ms: parse_event_time_ms(&entry.created_at),
                };
                if let Some(existing) = players.iter_mut().find(|(existing, _)| existing == &key) {
                    existing.1 = player;
                } else {
                    players.push((key, player));
                }
            }
            "OnPlayerLeft" => {
                let candidates = players
                    .iter()
                    .map(|(key, player)| RosterLeaveCandidate {
                        key: key.clone(),
                        user_id: player.user_id.clone(),
                        display_name: player.display_name.clone(),
                        joined_at_ms: player.joined_at_ms,
                    })
                    .collect::<Vec<_>>();
                let left_at_ms = parse_event_time_ms(&entry.created_at);
                if let Some(removed) = resolve_leave_candidate_key(
                    &candidates,
                    &entry.user_id,
                    &entry.display_name,
                    left_at_ms,
                    entry.time,
                ) {
                    players.retain(|(key, _)| key != &removed);
                }
            }
            _ => {}
        }
    }
    players
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(
        created_at: &str,
        event_type: &str,
        display_name: &str,
        user_id: &str,
    ) -> GameLogJoinLeaveSnapshot {
        GameLogJoinLeaveSnapshot {
            id: 0,
            created_at: created_at.to_string(),
            event_type: event_type.to_string(),
            display_name: display_name.to_string(),
            user_id: user_id.to_string(),
            time: 0,
        }
    }

    #[test]
    fn joins_survive_and_leaves_remove_by_key() {
        let players = fold_roster(&[
            entry("2026-05-01T10:00:00Z", "OnPlayerJoined", "Alice", "usr_a"),
            entry("2026-05-01T10:01:00Z", "OnPlayerJoined", "Bob", "usr_b"),
            entry("2026-05-01T10:02:00Z", "OnPlayerLeft", "Alice", "usr_a"),
        ]);
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].0, "id:usr_b");
        assert_eq!(players[0].1.display_name, "Bob");
        assert_eq!(
            players[0].1.joined_at_ms,
            parse_event_time_ms("2026-05-01T10:01:00Z")
        );
    }

    #[test]
    fn anonymous_players_key_by_display_name() {
        let players = fold_roster(&[
            entry("2026-05-01T10:00:00Z", "OnPlayerJoined", "NoId", ""),
            entry("2026-05-01T10:01:00Z", "OnPlayerLeft", "NoId", ""),
        ]);
        assert!(players.is_empty());
    }

    #[test]
    fn leave_with_id_removes_unique_anonymous_join_by_display_name() {
        let players = fold_roster(&[
            entry("2026-05-01T10:00:00Z", "OnPlayerJoined", "Left Player", ""),
            entry(
                "2026-05-01T10:01:00Z",
                "OnPlayerLeft",
                "Left Player",
                "usr_left",
            ),
        ]);
        assert!(players.is_empty());
    }

    #[test]
    fn ambiguous_display_name_leave_keeps_both_candidates() {
        let players = fold_roster(&[
            entry("2026-05-01T10:00:00Z", "OnPlayerJoined", "Twin", ""),
            entry("2026-05-01T10:00:30Z", "OnPlayerJoined", "twin", "usr_b"),
            entry(
                "2026-05-01T10:01:00Z",
                "OnPlayerLeft",
                "Twin",
                "usr_missing",
            ),
        ]);
        assert_eq!(players.len(), 2);
    }

    #[test]
    fn rejoin_overwrites_join_time_and_rows_with_no_identity_are_skipped() {
        let players = fold_roster(&[
            entry("2026-05-01T10:00:00Z", "OnPlayerJoined", "Alice", "usr_a"),
            entry("2026-05-01T10:05:00Z", "OnPlayerJoined", "Alice", "usr_a"),
            entry("2026-05-01T10:06:00Z", "OnPlayerJoined", "", ""),
        ]);
        assert_eq!(players.len(), 1);
        assert_eq!(players[0].1.joined_at, "2026-05-01T10:05:00Z");
    }
}
