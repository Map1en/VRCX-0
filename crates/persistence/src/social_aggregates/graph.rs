use std::collections::{BTreeMap, BTreeSet};

use vrcx_0_core::social_circles;

use crate::database::DatabaseService;
use crate::friends::friend_log_current_list;
use crate::mutual_graph::mutual_graph_snapshot_get;
use crate::Error;

use super::caveats::{friend_circles_caveats, social_graph_caveats};
use super::types::{
    FriendCirclePair, FriendCircleRow, FriendCirclesInput, FriendCirclesOutput, SocialGraphEdge,
    SocialGraphInput, SocialGraphNode, SocialGraphOutput,
};

const DEFAULT_MAX_NODES: usize = 40;
const MAX_MAX_NODES: usize = 250;
const DEFAULT_MAX_EDGES: usize = 100;
const MAX_MAX_EDGES: usize = 1_000;
const DEFAULT_MAX_CIRCLES: usize = 6;
const MAX_MAX_CIRCLES: usize = 50;
const DEFAULT_MAX_MEMBERS_PER_CIRCLE: usize = 8;
const MAX_MAX_MEMBERS_PER_CIRCLE: usize = 100;

pub fn get_social_graph(
    db: &DatabaseService,
    input: SocialGraphInput,
) -> Result<SocialGraphOutput, Error> {
    let owner_user_id = input.owner_user_id.into_inner();
    let snapshot = mutual_graph_snapshot_get(db, owner_user_id.clone())?;
    let friends = friend_log_current_list(db, owner_user_id)?;
    let friend_ids = friends
        .iter()
        .map(|friend| friend.user_id.clone())
        .filter(|user_id| !user_id.trim().is_empty())
        .collect::<BTreeSet<_>>();
    let display_name_by_user_id = friends
        .into_iter()
        .filter(|friend| !friend.display_name.trim().is_empty())
        .map(|friend| (friend.user_id, friend.display_name))
        .collect::<BTreeMap<_, _>>();
    let mut fetched_friends = 0usize;
    let mut opted_out_friends = 0usize;
    let mut newest_fetched_at: Option<String> = None;
    let mut oldest_fetched_at: Option<String> = None;
    for meta in &snapshot.meta {
        if meta.opted_out {
            opted_out_friends += 1;
            continue;
        }
        if meta.last_fetched_at.trim().is_empty() {
            continue;
        }
        fetched_friends += 1;
        newest_fetched_at = Some(match newest_fetched_at {
            Some(current) => current.max(meta.last_fetched_at.clone()),
            None => meta.last_fetched_at.clone(),
        });
        oldest_fetched_at = Some(match oldest_fetched_at {
            Some(current) => current.min(meta.last_fetched_at.clone()),
            None => meta.last_fetched_at.clone(),
        });
    }
    let focus = input
        .user_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);
    let max_nodes = clamped_limit(input.max_nodes, DEFAULT_MAX_NODES, MAX_MAX_NODES);
    let max_edges = clamped_limit(input.max_edges, DEFAULT_MAX_EDGES, MAX_MAX_EDGES);
    let mut degree_by_user_id: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut edges = Vec::new();
    let mut seen_pairs = BTreeSet::new();

    for friend_id in snapshot.friend_ids {
        if focus
            .as_ref()
            .is_some_and(|focus| input.depth == 0 && focus != &friend_id)
        {
            continue;
        }
        degree_by_user_id.entry(friend_id).or_default();
    }

    for link in snapshot.links {
        if let Some(focus) = &focus {
            if input.depth <= 1 && link.friend_id != *focus && link.mutual_id != *focus {
                continue;
            }
        }
        degree_by_user_id
            .entry(link.friend_id.clone())
            .or_default()
            .insert(link.mutual_id.clone());
        degree_by_user_id
            .entry(link.mutual_id.clone())
            .or_default()
            .insert(link.friend_id.clone());
        let pair = if link.friend_id <= link.mutual_id {
            (link.friend_id.clone(), link.mutual_id.clone())
        } else {
            (link.mutual_id.clone(), link.friend_id.clone())
        };
        if !seen_pairs.insert(pair) {
            continue;
        }
        edges.push(SocialGraphEdge {
            source_user_id: link.friend_id,
            target_user_id: link.mutual_id,
        });
    }

    let total_nodes = degree_by_user_id.len();
    let total_edges = edges.len();
    let mut nodes = degree_by_user_id
        .into_iter()
        .map(|(user_id, connections)| SocialGraphNode {
            display_name: display_name_by_user_id
                .get(&user_id)
                .cloned()
                .unwrap_or_default(),
            is_friend: friend_ids.contains(&user_id),
            user_id,
            connection_degree: connections.len(),
        })
        .collect::<Vec<_>>();
    nodes.sort_by(|left, right| {
        right
            .connection_degree
            .cmp(&left.connection_degree)
            .then_with(|| left.display_name.cmp(&right.display_name))
            .then_with(|| left.user_id.cmp(&right.user_id))
    });
    if let Some(focus) = &focus {
        if let Some(index) = nodes.iter().position(|node| node.user_id == *focus) {
            let focus_node = nodes.remove(index);
            nodes.insert(0, focus_node);
        }
    }
    nodes.truncate(max_nodes);

    let retained_user_ids = nodes
        .iter()
        .map(|node| node.user_id.clone())
        .collect::<BTreeSet<_>>();
    let edges = edges
        .into_iter()
        .filter(|edge| {
            retained_user_ids.contains(&edge.source_user_id)
                && retained_user_ids.contains(&edge.target_user_id)
        })
        .take(max_edges)
        .collect::<Vec<_>>();

    Ok(SocialGraphOutput {
        truncated: nodes.len() < total_nodes || edges.len() < total_edges,
        nodes,
        edges,
        total_nodes,
        total_edges,
        fetched_friends,
        opted_out_friends,
        newest_fetched_at,
        oldest_fetched_at,
        caveats: social_graph_caveats(),
    })
}

fn clamped_limit(limit: Option<i64>, default: usize, max: usize) -> usize {
    limit
        .and_then(|value| usize::try_from(value).ok())
        .unwrap_or(default)
        .clamp(1, max)
}

pub fn get_friend_circles(
    db: &DatabaseService,
    input: FriendCirclesInput,
) -> Result<FriendCirclesOutput, Error> {
    let owner_user_id = input.owner_user_id.into_inner();
    let snapshot = mutual_graph_snapshot_get(db, owner_user_id.clone())?;
    let friends = friend_log_current_list(db, owner_user_id)?;
    let friend_ids = friends
        .iter()
        .map(|friend| friend.user_id.clone())
        .filter(|user_id| !user_id.trim().is_empty())
        .collect::<BTreeSet<_>>();
    let display_name_by_user_id = friends
        .into_iter()
        .map(|friend| {
            let display_name = if friend.display_name.trim().is_empty() {
                friend.user_id.clone()
            } else {
                friend.display_name
            };
            (friend.user_id, display_name)
        })
        .collect::<BTreeMap<_, _>>();
    let mut deduped_edges = BTreeSet::new();
    for link in snapshot.links {
        if !friend_ids.contains(&link.friend_id) || !friend_ids.contains(&link.mutual_id) {
            continue;
        }
        if link.friend_id == link.mutual_id {
            continue;
        }
        let (left, right) = if link.friend_id < link.mutual_id {
            (link.friend_id, link.mutual_id)
        } else {
            (link.mutual_id, link.friend_id)
        };
        deduped_edges.insert((left, right));
    }
    let edge_list = deduped_edges.iter().cloned().collect::<Vec<_>>();
    let circles =
        social_circles::friend_circles(&friend_ids.iter().cloned().collect::<Vec<_>>(), &edge_list);
    let circle_count = circles.len();
    let connected_friend_ids = edge_list
        .iter()
        .flat_map(|(left, right)| [left.clone(), right.clone()])
        .collect::<BTreeSet<_>>();
    let isolated_friend_count = friend_ids.len().saturating_sub(connected_friend_ids.len());
    let max_circles = clamped_limit(input.max_circles, DEFAULT_MAX_CIRCLES, MAX_MAX_CIRCLES);
    let max_members = clamped_limit(
        input.max_members_per_circle,
        DEFAULT_MAX_MEMBERS_PER_CIRCLE,
        MAX_MAX_MEMBERS_PER_CIRCLE,
    );
    let rows = circles
        .into_iter()
        .take(max_circles)
        .map(|circle| {
            let member_ids = circle.members;
            let member_count = member_ids.len();
            let member_set = member_ids.iter().cloned().collect::<BTreeSet<_>>();
            let sample_pairs = edge_list
                .iter()
                .filter(|(left, right)| member_set.contains(left) && member_set.contains(right))
                .take(3)
                .map(|(left, right)| FriendCirclePair {
                    a: display_name_by_user_id
                        .get(left)
                        .cloned()
                        .unwrap_or_else(|| left.clone()),
                    b: display_name_by_user_id
                        .get(right)
                        .cloned()
                        .unwrap_or_else(|| right.clone()),
                })
                .collect::<Vec<_>>();
            let members = member_ids
                .into_iter()
                .take(max_members)
                .map(|user_id| {
                    display_name_by_user_id
                        .get(&user_id)
                        .cloned()
                        .unwrap_or(user_id)
                })
                .collect::<Vec<_>>();
            FriendCircleRow {
                members,
                member_count,
                sample_pairs,
            }
        })
        .collect::<Vec<_>>();
    let summary =
        friend_circles_summary(friend_ids.len(), circle_count, isolated_friend_count, &rows);
    Ok(FriendCirclesOutput {
        circles: rows,
        circle_count,
        isolated_friend_count,
        friends_analyzed: friend_ids.len(),
        summary,
        caveats: friend_circles_caveats(),
    })
}

fn friend_circles_summary(
    friends_analyzed: usize,
    circle_count: usize,
    isolated_friend_count: usize,
    rows: &[FriendCircleRow],
) -> String {
    let top = rows
        .first()
        .map(|circle| {
            let names = circle
                .members
                .iter()
                .take(3)
                .cloned()
                .collect::<Vec<_>>()
                .join(", ");
            format!(
                "the largest ({}) are linked through mutual friends: {}",
                circle.member_count, names
            )
        })
        .unwrap_or_else(|| "no fetched mutual circles are available yet".into());
    format!(
        "Your {friends_analyzed} friends form {circle_count} mutual circle(s); {top}. {isolated_friend_count} share no fetched mutual link."
    )
}
