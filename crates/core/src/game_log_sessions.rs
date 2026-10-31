use std::cmp::Ordering;
use std::collections::HashSet;

use serde::{Deserialize, Serialize};

const SESSION_AGGREGATE_THRESHOLD: usize = 5;
const SESSION_AGGREGATE_WINDOW_MS: i64 = 5000;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionLocationInput {
    pub epoch: i64,
    pub sort_id: i64,
    pub id: Option<i64>,
    pub created_at: String,
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub group_name: String,
    pub duration: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionEventInput {
    pub epoch: i64,
    pub sort_id: i64,
    pub row_id: Option<i64>,
    pub type_: String,
    pub created_at: String,
    pub display_name: String,
    pub user_id: String,
    pub location: String,
    pub video_url: Option<String>,
    pub video_name: Option<String>,
    pub video_id: Option<String>,
    pub is_favorite: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionMemberOut {
    pub display_name: String,
    pub user_id: String,
    pub created_at: String,
    pub is_favorite: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionEventOut {
    #[serde(rename = "type")]
    pub type_: String,
    pub created_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub location: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub play_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_favorite: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub members: Option<Vec<SessionMemberOut>>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SessionSegmentOut {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<i64>,
    pub created_at: String,
    pub location: String,
    pub world_id: String,
    pub world_name: String,
    pub group_name: String,
    pub duration: Option<i64>,
    pub remote: bool,
    pub events: Vec<SessionEventOut>,
}

// Order rows the same way the table view does: created_at epoch then per-table id.
// Folding sessions over this order keeps the session view consistent with the
// table, so an event between two locations always belongs to the earlier one.
fn compare_stream(left: (i64, i64), right: (i64, i64)) -> Ordering {
    left.0.cmp(&right.0).then(left.1.cmp(&right.1))
}

#[derive(Hash, PartialEq, Eq)]
enum DedupeKey<'a> {
    Row {
        type_: &'a str,
        row_id: i64,
    },
    Fields {
        type_: &'a str,
        created_at: &'a str,
        user_id: &'a str,
        display_name: &'a str,
        location: &'a str,
        video_url: &'a str,
    },
}

fn dedupe_key(event: &SessionEventInput) -> DedupeKey<'_> {
    match event.row_id {
        Some(row_id) => DedupeKey::Row {
            type_: &event.type_,
            row_id,
        },
        None => DedupeKey::Fields {
            type_: &event.type_,
            created_at: &event.created_at,
            user_id: &event.user_id,
            display_name: &event.display_name,
            location: &event.location,
            video_url: event.video_url.as_deref().unwrap_or_default(),
        },
    }
}

struct SingleNode {
    epoch: i64,
    row_id: Option<i64>,
    type_: String,
    created_at: String,
    display_name: String,
    user_id: String,
    location: String,
    video_url: Option<String>,
    video_name: Option<String>,
    video_id: Option<String>,
    is_favorite: bool,
    play_count: Option<i64>,
}

struct GroupNode {
    epoch: i64,
    type_: String,
    created_at: String,
    members: Vec<SessionMemberOut>,
}

enum Node {
    Single(SingleNode),
    Group(GroupNode),
}

impl Node {
    fn epoch(&self) -> i64 {
        match self {
            Node::Single(single) => single.epoch,
            Node::Group(group) => group.epoch,
        }
    }

    fn type_str(&self) -> &str {
        match self {
            Node::Single(single) => &single.type_,
            Node::Group(group) => &group.type_,
        }
    }
}

fn single_node(event: &SessionEventInput) -> SingleNode {
    SingleNode {
        epoch: event.epoch,
        row_id: event.row_id,
        type_: event.type_.clone(),
        created_at: event.created_at.clone(),
        display_name: event.display_name.clone(),
        user_id: event.user_id.clone(),
        location: event.location.clone(),
        video_url: event.video_url.clone(),
        video_name: event.video_name.clone(),
        video_id: event.video_id.clone(),
        is_favorite: event.is_favorite,
        play_count: None,
    }
}

fn member_of(single: &SingleNode) -> SessionMemberOut {
    SessionMemberOut {
        display_name: single.display_name.clone(),
        user_id: single.user_id.clone(),
        created_at: single.created_at.clone(),
        is_favorite: single.is_favorite,
    }
}

fn make_group(events: &[Node], indices: &[usize], group_type: &str) -> GroupNode {
    let anchor = &events[indices[0]];
    let epoch = anchor.epoch();
    let created_at = match anchor {
        Node::Single(single) => single.created_at.clone(),
        Node::Group(group) => group.created_at.clone(),
    };
    let mut members = Vec::with_capacity(indices.len());
    for &index in indices {
        if let Node::Single(single) = &events[index] {
            members.push(member_of(single));
        }
    }
    GroupNode {
        epoch,
        type_: group_type.to_string(),
        created_at,
        members,
    }
}

fn splice_group(events: &mut Vec<Node>, indices: &[usize], group: GroupNode) {
    let first = indices[0];
    let last = indices[indices.len() - 1];
    events[first] = Node::Group(group);
    let mut next_match = 1;
    let mut index = first + 1;
    events
        .extract_if(first + 1..=last, |_| {
            let remove = indices.get(next_match).copied() == Some(index);
            if remove {
                next_match += 1;
            }
            index += 1;
            remove
        })
        .for_each(drop);
}

// Collapse a run of >= THRESHOLD same-type events within WINDOW_MS of the anchor
// into one group. `from_tail` scans backward from the last match (tail run);
// otherwise forward from the first match (head run). Groups are skipped when
// matching but still bound the window via their stored epoch.
fn aggregate(events: &mut Vec<Node>, match_type: &str, group_type: &str, from_tail: bool) {
    let anchor = if from_tail {
        (0..events.len())
            .rev()
            .find(|&index| events[index].type_str() == match_type)
    } else {
        events.iter().position(|node| node.type_str() == match_type)
    };
    let anchor = match anchor {
        Some(index) => index,
        None => return,
    };

    let mut indices: Vec<usize> = Vec::with_capacity(SESSION_AGGREGATE_THRESHOLD);
    if from_tail {
        let window_start = events[anchor].epoch() - SESSION_AGGREGATE_WINDOW_MS;
        for index in (0..=anchor).rev() {
            if events[index].epoch() < window_start {
                break;
            }
            if events[index].type_str() == match_type {
                indices.push(index);
            }
        }
        indices.reverse();
    } else {
        let window_end = events[anchor].epoch() + SESSION_AGGREGATE_WINDOW_MS;
        for (index, node) in events.iter().enumerate().skip(anchor) {
            if node.epoch() > window_end {
                break;
            }
            if node.type_str() == match_type {
                indices.push(index);
            }
        }
    }
    if indices.len() < SESSION_AGGREGATE_THRESHOLD {
        return;
    }

    let group = make_group(events, &indices, group_type);
    splice_group(events, &indices, group);
}

fn merge_video_plays(events: &mut Vec<Node>) {
    if events.len() > 1 {
        let mut index = events.len() - 1;
        while index > 0 {
            let mergeable = matches!(
                (&events[index], &events[index - 1]),
                (Node::Single(current), Node::Single(previous))
                    if current.type_ == "VideoPlay"
                        && previous.type_ == "VideoPlay"
                        && current.video_url == previous.video_url
            );
            if mergeable {
                let add = match &events[index] {
                    Node::Single(current) => current.play_count.unwrap_or(1),
                    Node::Group(_) => 1,
                };
                if let Node::Single(previous) = &mut events[index - 1] {
                    previous.play_count = Some(previous.play_count.unwrap_or(1) + add);
                }
                events.remove(index);
            }
            index -= 1;
        }
    }
    for node in events.iter_mut() {
        if let Node::Single(single) = node {
            if single.type_ == "VideoPlay" && single.play_count.unwrap_or(0) == 0 {
                single.play_count = Some(1);
            }
        }
    }
}

fn node_to_out(node: Node) -> SessionEventOut {
    match node {
        Node::Single(single) => SessionEventOut {
            type_: single.type_,
            created_at: single.created_at,
            row_id: single.row_id,
            user_id: Some(single.user_id),
            display_name: Some(single.display_name),
            location: Some(single.location),
            video_url: single.video_url,
            video_name: single.video_name,
            video_id: single.video_id,
            play_count: single.play_count,
            is_favorite: Some(single.is_favorite),
            count: None,
            members: None,
        },
        Node::Group(group) => SessionEventOut {
            type_: group.type_,
            created_at: group.created_at,
            row_id: None,
            user_id: None,
            display_name: None,
            location: None,
            video_url: None,
            video_name: None,
            video_id: None,
            play_count: None,
            is_favorite: None,
            count: Some(group.members.len() as i64),
            members: Some(group.members),
        },
    }
}

struct SegmentBuild {
    epoch: i64,
    sort_id: i64,
    id: Option<i64>,
    created_at: String,
    location: String,
    world_id: String,
    world_name: String,
    group_name: String,
    duration: Option<i64>,
    events: Vec<Node>,
}

/// Fold location segments and their flat event stream into newest-first session
/// segments. Deterministic, no I/O: callers pre-parse `created_at` into `epoch`
/// (ms) and derive `sort_id` from per-table row ids, so tie-breaking stays a pure
/// integer comparison and never depends on date-string parsing here.
pub fn build_game_log_sessions(
    locations: &[SessionLocationInput],
    events: &[SessionEventInput],
) -> Vec<SessionSegmentOut> {
    if locations.is_empty() {
        return Vec::new();
    }

    let mut segments: Vec<SegmentBuild> = locations
        .iter()
        .map(|location| SegmentBuild {
            epoch: location.epoch,
            sort_id: location.sort_id,
            id: location.id,
            created_at: location.created_at.clone(),
            location: location.location.clone(),
            world_id: location.world_id.clone(),
            world_name: location.world_name.clone(),
            group_name: location.group_name.clone(),
            duration: location.duration,
            events: Vec::new(),
        })
        .collect();
    segments.sort_by(|left, right| {
        compare_stream((left.epoch, left.sort_id), (right.epoch, right.sort_id))
    });

    let mut seen: HashSet<DedupeKey<'_>> = HashSet::with_capacity(events.len());
    let mut deduped: Vec<&SessionEventInput> = Vec::with_capacity(events.len());
    for event in events {
        if seen.insert(dedupe_key(event)) {
            deduped.push(event);
        }
    }
    deduped.sort_by(|left, right| {
        compare_stream((left.epoch, left.sort_id), (right.epoch, right.sort_id))
    });

    let mut active_index: isize = -1;
    let mut next_index: usize = 0;
    for event in deduped {
        while next_index < segments.len()
            && compare_stream(
                (segments[next_index].epoch, segments[next_index].sort_id),
                (event.epoch, event.sort_id),
            ) != Ordering::Greater
        {
            active_index = next_index as isize;
            next_index += 1;
        }
        if active_index >= 0 {
            let active_index = active_index as usize;
            let target_index = if active_index > 0
                && segments[active_index].epoch == event.epoch
                && !event.location.is_empty()
                && segments[active_index].location != event.location
                && segments[active_index - 1].location == event.location
            {
                active_index - 1
            } else {
                active_index
            };
            segments[target_index]
                .events
                .push(Node::Single(single_node(event)));
        }
    }

    for segment in segments.iter_mut() {
        aggregate(&mut segment.events, "OnPlayerLeft", "LeftGroup", true);
        aggregate(&mut segment.events, "OnPlayerJoined", "JoinGroup", true);
        aggregate(&mut segment.events, "OnPlayerJoined", "JoinGroup", false);
        merge_video_plays(&mut segment.events);
        segment.events.reverse();
    }
    segments.reverse();

    segments
        .into_iter()
        .map(|segment| SessionSegmentOut {
            id: segment.id,
            created_at: segment.created_at,
            location: segment.location,
            world_id: segment.world_id,
            world_name: segment.world_name,
            group_name: segment.group_name,
            duration: segment.duration,
            remote: segment.events.is_empty(),
            events: segment.events.into_iter().map(node_to_out).collect(),
        })
        .collect()
}
