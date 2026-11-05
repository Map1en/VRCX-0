use super::*;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[test]
fn routing_is_limited_to_the_official_endpoint_and_is_model_independent() {
    for model in ["gpt-6-luna", "gpt-6-astra", "custom-model"] {
        let official = LlmClient::new("https://api.openai.com/v1/", "", model, None).unwrap();
        assert!(official.uses_responses_api());
        let router = LlmClient::new("https://openrouter.ai/api/v1", "", model, None).unwrap();
        assert!(!router.uses_responses_api());
    }
}

#[tokio::test]
async fn streamed_tool_call_replays_call_and_output_without_stateless_reasoning_items() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        for response_body in [
            concat!(
                "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[",
                "{\"type\":\"reasoning\",\"id\":\"rs_1\",\"encrypted_content\":\"opaque\",\"summary\":[]},",
                "{\"type\":\"function_call\",\"id\":\"fc_1\",\"call_id\":\"call_1\",\"name\":\"lookup\",\"arguments\":\"{}\",\"status\":\"completed\"}]}}\n\n"
            ),
            concat!(
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Found it\"}\n\n",
                "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"Found it\"}]}]}}\n\n"
            ),
        ] {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = Vec::new();
            let mut buffer = [0; 4096];
            let header_end = loop {
                let n = socket.read(&mut buffer).await.unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(i) = bytes.windows(4).position(|w| w == b"\r\n\r\n") { break i + 4; }
            };
            let headers = String::from_utf8_lossy(&bytes[..header_end]);
            assert!(headers.starts_with("POST /v1/responses "));
            let length: usize = headers.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse().unwrap())).unwrap();
            while bytes.len() < header_end + length {
                let n = socket.read(&mut buffer).await.unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
            }
            requests.push(serde_json::from_slice::<Value>(&bytes[header_end..header_end + length]).unwrap());
            let response = format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", response_body.len(), response_body);
            socket.write_all(response.as_bytes()).await.unwrap();
        }
        requests
    });
    let client = LlmClient::new(base_url, "", "test-model", None).unwrap();
    let tools = vec![ToolDefinition {
        name: "lookup".into(),
        description: "lookup".into(),
        parameters: json!({"type":"object","properties":{}}),
    }];
    let mut messages = vec![ChatMessage::user("find it")];
    let first = client
        .stream_responses(&messages, &tools, &LlmRequestOptions::default(), |_| {})
        .await
        .unwrap();
    assert_eq!(first.tool_calls[0].id, "call_1");
    messages.push(first.into_message());
    messages.push(ChatMessage::tool("call_1", "found"));
    let mut streamed = String::new();
    let second = client
        .stream_responses(&messages, &tools, &LlmRequestOptions::default(), |text| {
            streamed.push_str(text)
        })
        .await
        .unwrap();
    assert_eq!(second.content, "Found it");
    assert_eq!(streamed, "Found it");
    let requests = server.await.unwrap();
    assert_eq!(requests[0]["store"], false);
    assert_eq!(requests[0]["tools"][0]["name"], "lookup");
    assert_eq!(requests[0]["tools"][0]["strict"], false);
    let input = requests[1]["input"].as_array().unwrap();
    assert_eq!(input.len(), 3);
    assert_eq!(input[1]["type"], "function_call");
    assert_eq!(input[1]["call_id"], "call_1");
    assert_eq!(input[2]["type"], "function_call_output");
    assert_eq!(input[2]["call_id"], "call_1");
}

#[test]
fn function_call_without_arguments_is_still_dispatched() {
    let turn = response_turn(
        json!({"status":"completed","output":[{"type":"function_call","call_id":"call_1","name":"lookup","arguments":""}]}),
        String::new(),
    )
    .unwrap();
    assert_eq!(turn.tool_calls[0].function.arguments, "");
    assert_eq!(turn.finish_reason.as_deref(), Some("tool_calls"));
}

#[test]
fn incomplete_and_failed_responses_do_not_succeed_silently() {
    let mut state = ResponsesStreamState::default();
    apply_line(
        r#"data: {"type":"response.failed","response":{"error":{"message":"failed","code":"invalid_request_error"}}}"#,
        &mut |_| {},
        &mut state,
    );
    assert!(matches!(state.error, Some(LlmError::Api { message, .. }) if message == "failed"));
    let turn = response_turn(json!({"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[]}), String::new()).unwrap();
    assert!(turn.truncated());
    assert!(response_turn(
        json!({"status":"incomplete","incomplete_details":{"reason":"content_filter"},"output":[]}),
        String::new()
    )
    .is_err());
}
