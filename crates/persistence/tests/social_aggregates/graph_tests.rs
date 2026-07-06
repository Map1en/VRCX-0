use serde_json::json;

use super::test_support::*;
use super::*;

#[test]
fn social_graph_uses_mutual_graph_edges_without_implying_coplay() {
    let (_dir, db) = test_db("social-graph");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_friends (friend_id TEXT PRIMARY KEY)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
            "CREATE TABLE usrself_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))",
            &Default::default(),
        )
        .unwrap();
    db.execute_non_query(
            "CREATE TABLE usrself_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)",
            &Default::default(),
        )
        .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_friends (friend_id)
             VALUES ('usr_a'), ('usr_b')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_links (friend_id, mutual_id)
             VALUES ('usr_a', 'usr_b')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_meta (friend_id, last_fetched_at, opted_out)
             VALUES
                ('usr_a', '2026-06-01T10:00:00Z', 0),
                ('usr_b', '2026-06-02T11:00:00Z', 0),
                ('usr_opted', '2026-06-03T12:00:00Z', 1)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES
                ('usr_a', 'Alice', 'Trusted', 1),
                ('usr_b', 'Bob', 'Known', 2)",
        &Default::default(),
    )
    .unwrap();

    let output = get_social_graph(
        &db,
        SocialGraphInput {
            owner_user_id: "usr_self".into(),
            user_id: None,
            depth: 1,
            max_nodes: None,
            max_edges: None,
        },
    )
    .unwrap();

    assert_eq!(output.nodes.len(), 2);
    assert_eq!(output.edges.len(), 1);
    assert_eq!(output.total_nodes, 2);
    assert_eq!(output.total_edges, 1);
    assert!(!output.truncated);
    let alice = output
        .nodes
        .iter()
        .find(|node| node.user_id == "usr_a")
        .unwrap();
    assert_eq!(alice.display_name, "Alice");
    assert!(alice.is_friend);
    assert_eq!(output.fetched_friends, 2);
    assert_eq!(output.opted_out_friends, 1);
    assert_eq!(
        output.oldest_fetched_at,
        Some("2026-06-01T10:00:00Z".into())
    );
    assert_eq!(
        output.newest_fetched_at,
        Some("2026-06-02T11:00:00Z".into())
    );
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("friend relationship")));
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("refresh_mutual_graph")));
}

#[test]
fn social_graph_marks_first_degree_friends_apart_from_mutuals() {
    let (_dir, db) = test_db("social-graph-is-friend");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_friends (friend_id TEXT PRIMARY KEY)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)",
        &Default::default(),
    )
    .unwrap();
    // usr_a is my friend; usr_stranger is a friend-of-friend, not mine.
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_friends (friend_id) VALUES ('usr_a')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_links (friend_id, mutual_id) VALUES ('usr_a', 'usr_stranger')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_meta (friend_id, last_fetched_at, opted_out) VALUES ('usr_a', '2026-06-01T10:00:00Z', 0)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES ('usr_a', 'Alice', 'Trusted', 1)",
        &Default::default(),
    )
    .unwrap();

    let output = get_social_graph(
        &db,
        SocialGraphInput {
            owner_user_id: "usr_self".into(),
            user_id: None,
            depth: 1,
            max_nodes: None,
            max_edges: None,
        },
    )
    .unwrap();

    let alice = output
        .nodes
        .iter()
        .find(|node| node.user_id == "usr_a")
        .unwrap();
    assert!(alice.is_friend);
    let stranger = output
        .nodes
        .iter()
        .find(|node| node.user_id == "usr_stranger")
        .unwrap();
    assert!(!stranger.is_friend);
    assert!(stranger.display_name.is_empty());
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("isFriend")));
}

#[test]
fn social_graph_applies_node_and_edge_caps_with_total_counts() {
    let (_dir, db) = test_db("social-graph-caps");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_friends (friend_id TEXT PRIMARY KEY)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_friends (friend_id)
             VALUES ('usr_a'), ('usr_b'), ('usr_c'), ('usr_d')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_links (friend_id, mutual_id)
             VALUES
                ('usr_a', 'usr_b'),
                ('usr_a', 'usr_c'),
                ('usr_a', 'usr_d'),
                ('usr_b', 'usr_c'),
                ('usr_b', 'usr_d'),
                ('usr_c', 'usr_d')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES
                ('usr_a', 'Alice', 'Trusted', 1),
                ('usr_b', 'Bob', 'Known', 2),
                ('usr_c', 'Carol', 'Known', 3),
                ('usr_d', 'Delta', 'Known', 4)",
        &Default::default(),
    )
    .unwrap();

    let output = get_social_graph(
        &db,
        SocialGraphInput {
            owner_user_id: "usr_self".into(),
            user_id: Some("usr_d".into()),
            depth: 1,
            max_nodes: Some(3),
            max_edges: Some(2),
        },
    )
    .unwrap();

    assert_eq!(output.total_nodes, 4);
    assert_eq!(output.total_edges, 3);
    assert_eq!(output.nodes.len(), 3);
    assert_eq!(output.edges.len(), 2);
    assert!(output.truncated);
    assert_eq!(output.nodes[0].user_id, "usr_d");
    assert!(output.edges.iter().all(|edge| output
        .nodes
        .iter()
        .any(|node| node.user_id == edge.source_user_id)
        && output
            .nodes
            .iter()
            .any(|node| node.user_id == edge.target_user_id)));
}

#[test]
fn friend_circles_groups_mutually_linked_friends_and_excludes_second_degree_nodes() {
    let (_dir, db) = test_db("friend-circles");
    ensure_realtime_tables(&db, "usrself").unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_friends (friend_id TEXT PRIMARY KEY)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "CREATE TABLE usrself_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_friend_log_current (user_id, display_name, trust_level, friend_number)
             VALUES
                ('usr_a', 'Alice', 'Trusted', 1),
                ('usr_b', 'Bob', 'Known', 2),
                ('usr_c', 'Carol', 'Known', 3),
                ('usr_d', 'Delta', 'Known', 4),
                ('usr_e', 'Echo', 'Known', 5),
                ('usr_f', 'Foxtrot', 'Known', 6)",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_friends (friend_id)
             VALUES ('usr_a'), ('usr_b'), ('usr_c'), ('usr_d'), ('usr_e'), ('usr_stranger')",
        &Default::default(),
    )
    .unwrap();
    db.execute_non_query(
        "INSERT INTO usrself_mutual_graph_links (friend_id, mutual_id)
             VALUES
                ('usr_a', 'usr_b'),
                ('usr_b', 'usr_c'),
                ('usr_d', 'usr_e'),
                ('usr_e', 'usr_d'),
                ('usr_a', 'usr_stranger')",
        &Default::default(),
    )
    .unwrap();

    let output = get_friend_circles(
        &db,
        FriendCirclesInput {
            owner_user_id: "usr_self".into(),
            max_circles: Some(6),
            max_members_per_circle: Some(8),
        },
    )
    .unwrap();

    assert_eq!(output.circle_count, 2);
    assert_eq!(output.circles.len(), 2);
    assert_eq!(output.friends_analyzed, 6);
    assert_eq!(output.isolated_friend_count, 1);
    assert_eq!(output.circles[0].member_count, 3);
    assert_eq!(output.circles[0].members, vec!["Alice", "Bob", "Carol"]);
    assert_eq!(output.circles[1].members, vec!["Delta", "Echo"]);
    assert!(output
        .circles
        .iter()
        .all(|circle| !circle.members.iter().any(|name| name == "usr_stranger")));
    assert!(!output.circles[0].sample_pairs.is_empty());
    assert!(output.summary.contains("6 friends"));
    assert!(output
        .caveats
        .iter()
        .any(|caveat| caveat.contains("Connected circles")));
}
