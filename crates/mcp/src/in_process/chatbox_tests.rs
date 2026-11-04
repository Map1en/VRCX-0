use std::sync::Arc;

use serde_json::{json, Map, Value};

use super::*;
use crate::test_support::{test_runtime, TestMcpChatbox};

fn arguments(value: Value) -> Option<Map<String, Value>> {
    value.as_object().cloned()
}

#[tokio::test]
async fn chatbox_tools_pass_requests_straight_to_the_chatbox() {
    let (_dir, runtime) = test_runtime("in-process-chatbox", "usr_owner").unwrap();
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let config = json!({ "statusEnabled": false, "pages": [{ "id": "p1" }] });
    for (name, args, expected) in [
        ("get_chatbox", json!({}), json!({ "state": true })),
        (
            "send_chatbox_message",
            json!({ "text": "hi there" }),
            json!({ "send": "hi there" }),
        ),
        (
            "set_chatbox_afk",
            json!({ "afk": true }),
            json!({ "afk": true }),
        ),
        (
            "update_chatbox",
            json!({ "config": config }),
            json!({ "config": config }),
        ),
    ] {
        let result = tools.call_tool(name, arguments(args)).await.unwrap();
        assert!(!result.is_error, "{name}: {}", result.text);
        assert_eq!(result.structured, Some(expected), "{name}");
    }
}

#[tokio::test]
async fn chatbox_tool_errors_reach_the_caller() {
    let (_dir, mut runtime) = test_runtime("in-process-chatbox-error", "usr_owner").unwrap();
    runtime.chatbox = Arc::new(TestMcpChatbox(Some("OSC port unavailable".into())));
    let tools = spawn_in_process_tools(runtime).await.unwrap();

    let result = tools
        .call_tool("send_chatbox_message", arguments(json!({ "text": "hi" })))
        .await
        .unwrap();
    assert!(result.is_error);
    assert!(
        result.text.contains("OSC port unavailable"),
        "{}",
        result.text
    );
}
