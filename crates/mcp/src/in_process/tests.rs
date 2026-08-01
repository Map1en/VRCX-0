use serde_json::{json, Map};

use super::*;
use crate::test_support::test_runtime;

#[tokio::test]
async fn in_process_bridge_lists_the_real_server_tools() {
    let (_dir, runtime) = test_runtime("in-process-list", "usr_owner").unwrap();
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let descriptors = tools.list_tools().await.unwrap();
    let favorites = descriptors
        .iter()
        .find(|tool| tool.name == "get_favorites")
        .expect("get_favorites should cross the in-process bridge");

    assert!(!favorites.description.is_empty());
    assert_eq!(favorites.parameters["type"], "object");
}

#[tokio::test]
async fn in_process_bridge_returns_structured_read_only_results() {
    let (_dir, runtime) = test_runtime("in-process-call", "usr_owner").unwrap();
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let outcome = tools
        .call_tool("get_favorites", Some(Map::new()))
        .await
        .unwrap();

    assert!(!outcome.is_error);
    let structured = outcome.structured.expect("structured tool result");
    assert_eq!(structured["rows"], json!([]));
    assert!(structured["summary"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));
}

#[tokio::test]
async fn in_process_bridge_preserves_tool_errors_and_dispatch_failures() {
    let (_dir, runtime) = test_runtime("in-process-errors", "usr_owner").unwrap();
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let invalid = tools
        .call_tool(
            "get_favorites",
            Some(Map::from_iter([("kind".into(), json!(42))])),
        )
        .await
        .unwrap();
    assert!(invalid.is_error);
    assert!(!invalid.text.is_empty());

    let unknown = tools.call_tool("missing_tool", Some(Map::new())).await;
    assert!(unknown
        .unwrap_err()
        .to_string()
        .contains("call_tool failed"));
}
