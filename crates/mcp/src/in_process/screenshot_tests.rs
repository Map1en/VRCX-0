use std::collections::HashSet;
use std::sync::Arc;

use serde_json::{json, Map};
use vrcx_0_persistence::screenshot_cache::ScreenshotLibraryEntry;

use super::*;
use crate::test_support::{test_runtime_with_database, TestMcpScreenshots};

fn shot(
    root: &str,
    name: &str,
    captured_at_ms: i64,
    world: (&str, &str),
    players: &[(&str, &str)],
) -> ScreenshotLibraryEntry {
    let metadata = json!({
        "author": { "id": "usr_owner", "displayName": "Owner" },
        "world": { "id": world.0, "name": world.1, "instanceId": "" },
        "players": players
            .iter()
            .map(|(id, name)| json!({ "id": id, "displayName": name }))
            .collect::<Vec<_>>()
    });
    ScreenshotLibraryEntry {
        scan_root: root.into(),
        path: format!("{root}/{name}"),
        folder_path: root.into(),
        file_name: name.into(),
        size_bytes: 100,
        modified_at: captured_at_ms,
        created_at: None,
        width: Some(1920),
        height: Some(1080),
        world_id: Some(world.0.into()),
        world_name: Some(world.1.into()),
        captured_at: None,
        captured_at_ms,
        metadata_json: Some(metadata.to_string()),
        error: None,
    }
}

#[tokio::test]
async fn screenshot_tools_find_shots_together_and_rank_people_without_yourself() {
    let (dir, mut runtime, _db) =
        test_runtime_with_database("in-process-screenshots", "usr_owner").unwrap();
    let screenshots = TestMcpScreenshots::new(&dir.path);
    let root = screenshots.root.clone();
    let owner = ("usr_owner", "Owner");
    let alice = ("usr_alice", "Alice");
    let bob = ("usr_bob", "Bob");
    let pier = ("wrld_pier", "Night Pier");
    let entries = [
        shot(
            &root,
            "VRChat_a.png",
            1_780_000_000_000,
            pier,
            &[owner, alice, bob],
        ),
        shot(
            &root,
            "VRChat_b.png",
            1_780_000_100_000,
            pier,
            &[owner, alice],
        ),
        shot(
            &root,
            "VRChat_c.png",
            1_780_000_200_000,
            ("wrld_loft", "Cozy Loft"),
            &[owner, bob],
        ),
    ];
    let seen: HashSet<String> = entries.iter().map(|entry| entry.path.clone()).collect();
    screenshots
        .cache
        .replace_library_entries(&root, &seen, &entries, false)
        .unwrap();
    runtime.screenshots = Arc::new(screenshots);
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let mut arguments = Map::new();
    arguments.insert("people".into(), json!(["usr_alice", "usr_bob"]));
    let search = tools
        .call_tool("search_screenshots", Some(arguments))
        .await
        .unwrap();
    assert!(!search.is_error, "{}", search.text);
    let search = search.structured.expect("structured result");
    assert_eq!(search["total"], 1);
    assert_eq!(search["screenshots"][0]["screenshotId"], "VRChat_a.png");
    assert_eq!(search["screenshots"][0]["people"], json!(["Alice", "Bob"]));
    assert!(!search.to_string().contains(&root), "{search}");

    let mut arguments = Map::new();
    arguments.insert("world".into(), json!("night pier"));
    let summary = tools
        .call_tool("summarize_screenshots", Some(arguments))
        .await
        .unwrap();
    assert!(!summary.is_error, "{}", summary.text);
    let summary = summary.structured.expect("structured result");
    assert_eq!(summary["total"], 2);
    let people: Vec<_> = summary["rows"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row["displayName"].as_str().unwrap_or_default(),
                row["count"].as_i64().unwrap_or_default(),
            )
        })
        .collect();
    assert_eq!(people, [("Alice", 2), ("Bob", 1)]);
}
