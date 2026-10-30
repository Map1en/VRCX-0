use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::*;

async fn serve_socks5_models() -> (String, tokio::task::JoinHandle<String>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let proxy_url = format!("socks5://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut greeting = [0_u8; 3];
        stream.read_exact(&mut greeting).await.unwrap();
        assert_eq!(greeting, [5, 1, 0]);
        stream.write_all(&[5, 0]).await.unwrap();

        let mut request = [0_u8; 4];
        stream.read_exact(&mut request).await.unwrap();
        assert_eq!(request, [5, 1, 0, 3]);
        let domain_length = stream.read_u8().await.unwrap() as usize;
        let mut domain = vec![0_u8; domain_length];
        stream.read_exact(&mut domain).await.unwrap();
        let mut port = [0_u8; 2];
        stream.read_exact(&mut port).await.unwrap();
        assert_eq!(u16::from_be_bytes(port), 80);
        stream
            .write_all(&[5, 0, 0, 1, 127, 0, 0, 1, 0, 0])
            .await
            .unwrap();

        let mut request = Vec::new();
        let mut chunk = [0_u8; 1024];
        loop {
            let read = stream.read(&mut chunk).await.unwrap();
            request.extend_from_slice(&chunk[..read]);
            if read == 0 || request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        let body = r#"{"data":[{"id":"remote-dns-model"}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8(domain).unwrap()
    });
    (proxy_url, server)
}

#[tokio::test]
async fn list_models_uses_explicit_http_proxy() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let proxy_address = listener.local_addr().unwrap();
    let proxy_task = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut chunk = [0u8; 1024];
        loop {
            let read = stream.read(&mut chunk).await.unwrap();
            if read == 0 {
                break;
            }
            request.extend_from_slice(&chunk[..read]);
            if request.windows(4).any(|window| window == b"\r\n\r\n") {
                break;
            }
        }
        let body = r#"{"data":[{"id":"proxy-model"}]}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        stream.write_all(response.as_bytes()).await.unwrap();
        String::from_utf8(request).unwrap()
    });

    let proxy_url = format!("http://{proxy_address}");
    let client = LlmClient::new("http://127.0.0.1:9/v1", "", "", Some(&proxy_url)).unwrap();

    let result = client.list_models().await.unwrap();
    assert_eq!(result.models, vec!["proxy-model"]);
    assert!(result.model_reasoning.is_empty());
    let request = proxy_task.await.unwrap();
    assert!(request.starts_with("GET http://127.0.0.1:9/v1/models HTTP/1.1\r\n"));
}

#[test]
fn list_models_parses_supported_efforts_preserving_order_and_unknown_values() {
    let body = r#"{
            "data": [
                {
                    "id": "openai/gpt-4o",
                    "reasoning": {
                        "supported_efforts": ["xhigh", "high", "medium"],
                        "mandatory": false
                    }
                },
                {
                    "id": "anthropic/claude",
                    "reasoning": {
                        "supported_efforts": ["low", "none"]
                    }
                },
                {
                    "id": "no-reasoning-model"
                },
                {
                    "id": "empty-efforts-model",
                    "reasoning": {
                        "supported_efforts": []
                    }
                },
                {
                    "id": "mandatory-model",
                    "reasoning": {
                        "supported_efforts": ["high"],
                        "mandatory": true
                    }
                }
            ]
        }"#;
    let result = parse_models_response(body, 200).unwrap();
    assert_eq!(
        result.models,
        vec![
            "anthropic/claude",
            "empty-efforts-model",
            "mandatory-model",
            "no-reasoning-model",
            "openai/gpt-4o"
        ]
    );
    assert_eq!(result.model_reasoning.len(), 3);
    assert_eq!(
        result.model_reasoning[0],
        LlmModelReasoning {
            model_id: "openai/gpt-4o".into(),
            supported_efforts: vec!["xhigh".into(), "high".into(), "medium".into()],
            mandatory: false,
        }
    );
    assert_eq!(
        result.model_reasoning[1],
        LlmModelReasoning {
            model_id: "anthropic/claude".into(),
            supported_efforts: vec!["low".into(), "none".into()],
            mandatory: false,
        }
    );
    assert_eq!(
        result.model_reasoning[2],
        LlmModelReasoning {
            model_id: "mandatory-model".into(),
            supported_efforts: vec!["high".into()],
            mandatory: true,
        }
    );
}

#[test]
fn list_models_expands_null_supported_efforts_but_not_an_omitted_field() {
    let body = r#"{
            "data": [
                {
                    "id": "unrestricted-model",
                    "reasoning": {
                        "supported_efforts": null,
                        "mandatory": true
                    }
                },
                {
                    "id": "no-effort-selector",
                    "reasoning": {
                        "mandatory": false,
                        "default_enabled": true
                    }
                }
            ]
        }"#;

    let result = parse_models_response(body, 200).unwrap();

    assert_eq!(
        result.models,
        vec!["no-effort-selector", "unrestricted-model"]
    );
    assert_eq!(
        result.model_reasoning,
        vec![LlmModelReasoning {
            model_id: "unrestricted-model".into(),
            supported_efforts: OPENROUTER_REASONING_EFFORTS
                .iter()
                .map(|effort| (*effort).to_string())
                .collect(),
            mandatory: true,
        }]
    );
}

#[test]
fn list_models_ignores_malformed_reasoning_metadata_per_model() {
    let body = r#"{
            "data": [
                {"id": "wrong-object", "reasoning": "unsupported"},
                {
                    "id": "wrong-efforts",
                    "reasoning": {"supported_efforts": "high", "mandatory": true}
                },
                {
                    "id": "mixed-efforts",
                    "reasoning": {
                        "supported_efforts": ["minimal", 42, null, "xhigh"],
                        "mandatory": "yes"
                    }
                }
            ]
        }"#;

    let result = parse_models_response(body, 200).unwrap();

    assert_eq!(
        result.models,
        vec!["mixed-efforts", "wrong-efforts", "wrong-object"]
    );
    assert_eq!(
        result.model_reasoning,
        vec![LlmModelReasoning {
            model_id: "mixed-efforts".into(),
            supported_efforts: vec!["minimal".into(), "xhigh".into()],
            mandatory: false,
        }]
    );
}

#[test]
fn chat_request_body_omits_reasoning_when_effort_is_none() {
    let messages: Vec<ChatMessage> = vec![ChatMessage::user("hi")];
    let body = ChatRequestBody {
        model: "m",
        messages: &messages,
        tools: Vec::new(),
        tool_choice: None,
        stream: false,
        reasoning: None,
    };
    let json = serde_json::to_string(&body).unwrap();
    assert!(!json.contains("reasoning"));
}

#[test]
fn chat_request_body_includes_reasoning_effort_verbatim() {
    let messages: Vec<ChatMessage> = vec![ChatMessage::user("hi")];
    let body = ChatRequestBody {
        model: "m",
        messages: &messages,
        tools: Vec::new(),
        tool_choice: None,
        stream: false,
        reasoning: Some(ReasoningRequest {
            effort: "medium".into(),
        }),
    };
    let json = serde_json::to_string(&body).unwrap();
    assert!(json.contains(r#""reasoning":{"effort":"medium"}"#));
}

#[test]
fn chat_request_body_omits_reasoning_when_effort_is_empty() {
    let messages: Vec<ChatMessage> = vec![ChatMessage::user("hi")];
    let options = LlmRequestOptions {
        reasoning_effort: Some(String::new()),
        forbid_tool_calls: false,
    };
    let body = ChatRequestBody {
        model: "m",
        messages: &messages,
        tools: Vec::new(),
        tool_choice: None,
        stream: false,
        reasoning: reasoning_request(&options),
    };
    let json = serde_json::to_string(&body).unwrap();
    assert!(!json.contains("reasoning"));
}

#[test]
fn streaming_chat_request_body_includes_reasoning_effort_verbatim() {
    let messages = vec![ChatMessage::user("hi")];
    let options = LlmRequestOptions {
        reasoning_effort: Some("xhigh".into()),
        forbid_tool_calls: false,
    };
    let body = ChatRequestBody {
        model: "m",
        messages: &messages,
        tools: Vec::new(),
        tool_choice: None,
        stream: true,
        reasoning: reasoning_request(&options),
    };

    let json = serde_json::to_value(body).unwrap();
    assert_eq!(json["stream"], true);
    assert_eq!(json["reasoning"]["effort"], "xhigh");
}

#[test]
fn streaming_reasoning_details_are_accumulated_in_response_order() {
    let mut state = ChatStreamState::default();
    let mut on_text = |_: &str| {};

    apply_chat_stream_line(
        r#"data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.summary","summary":"Checking context","id":"summary-1","format":"anthropic-claude-v1","index":0}]}}]}"#,
        &mut on_text,
        &mut state,
    );
    apply_chat_stream_line(
        r#"data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.encrypted","data":"opaque-data","id":"encrypted-1","format":"anthropic-claude-v1","index":1}]}}]}"#,
        &mut on_text,
        &mut state,
    );

    assert_eq!(
        state.reasoning_details,
        vec![
            serde_json::json!({
                "type": "reasoning.summary",
                "summary": "Checking context",
                "id": "summary-1",
                "format": "anthropic-claude-v1",
                "index": 0
            }),
            serde_json::json!({
                "type": "reasoning.encrypted",
                "data": "opaque-data",
                "id": "encrypted-1",
                "format": "anthropic-claude-v1",
                "index": 1
            }),
        ]
    );
}

#[test]
fn assistant_tool_call_message_resends_reasoning_details_unchanged() {
    let reasoning_details = vec![serde_json::json!({
        "type": "reasoning.text",
        "text": "Need current social data",
        "signature": "signed-value",
        "id": "reasoning-1",
        "format": "anthropic-claude-v1",
        "index": 0
    })];
    let message = AssistantTurn {
        content: String::new(),
        tool_calls: vec![ToolCall {
            id: "call-1".into(),
            kind: "function".into(),
            function: FunctionCall {
                name: "get_summary".into(),
                arguments: "{}".into(),
            },
        }],
        reasoning_details: reasoning_details.clone(),
        finish_reason: Some("tool_calls".into()),
    }
    .into_message();

    let json = serde_json::to_value(message).unwrap();
    assert_eq!(json["reasoning_details"], Value::Array(reasoning_details));
    assert_eq!(json["tool_calls"][0]["id"], "call-1");
    assert!(serde_json::to_value(ChatMessage::user("hi"))
        .unwrap()
        .get("reasoning_details")
        .is_none());
}

#[tokio::test]
async fn transport_error_detail_names_the_kind_and_underlying_cause() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);

    let error = Client::new()
        .get(format!("http://{address}/v1/models"))
        .send()
        .await
        .unwrap_err();
    let detail = transport_error_detail(&error);

    assert!(
        detail.starts_with("connect: error sending request"),
        "{detail}"
    );
    assert!(detail.contains("tcp connect error"), "{detail}");
    assert_eq!(
        LlmError::Http(error).to_string(),
        format!("LLM transport error: {detail}")
    );
}

#[tokio::test]
async fn socks5_proxy_resolves_llm_destination_remotely() {
    let (proxy_url, server) = serve_socks5_models().await;
    let client = LlmClient::new("http://llm.test.invalid/v1", "", "", Some(&proxy_url)).unwrap();

    let result = client.list_models().await.unwrap();

    assert_eq!(result.models, vec!["remote-dns-model"]);
    assert_eq!(server.await.unwrap(), "llm.test.invalid");
}

#[test]
fn chat_completion_response_extracts_first_message_content() {
    let body = r#"{
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": "  translated text  "
                    }
                }
            ]
        }"#;

    assert_eq!(
        parse_chat_completion_content(body).unwrap(),
        "translated text"
    );
}

#[test]
fn chat_completion_response_rejects_missing_content() {
    let body = r#"{"choices":[{"message":{"role":"assistant"}}]}"#;

    assert!(matches!(
        parse_chat_completion_content(body),
        Err(LlmError::Api { status: 200, .. })
    ));
}

#[test]
fn drain_complete_lines_reassembles_multibyte_split_across_chunks() {
    let full = "data: 你好👋\n".as_bytes().to_vec();
    let mut buffer = Vec::new();

    // First chunk ends partway through the first multibyte character.
    buffer.extend_from_slice(&full[..8]);
    let mut lines = Vec::new();
    drain_complete_lines(&mut buffer, |line| lines.push(line.to_string()));
    assert!(lines.is_empty());

    buffer.extend_from_slice(&full[8..]);
    drain_complete_lines(&mut buffer, |line| lines.push(line.to_string()));
    assert_eq!(lines, vec!["data: 你好👋\n".to_string()]);
    assert!(!lines[0].contains('\u{FFFD}'));
    assert!(buffer.is_empty());
}

#[test]
fn drain_complete_lines_keeps_trailing_partial_line_buffered() {
    let mut buffer = b"data: a\ndata: b".to_vec();
    let mut lines = Vec::new();
    drain_complete_lines(&mut buffer, |line| lines.push(line.to_string()));
    assert_eq!(lines, vec!["data: a\n"]);
    assert_eq!(buffer, b"data: b");
}

#[test]
fn takes_final_stream_line_without_a_trailing_newline() {
    let mut buffer = b"data: final".to_vec();

    assert_eq!(
        take_remaining_line(&mut buffer).as_deref(),
        Some("data: final")
    );
    assert!(buffer.is_empty());
}

#[test]
fn repeated_cumulative_tool_names_are_idempotent() {
    assert_eq!(
        assemble_tool_name(
            &[
                "get_best_time_to_play".into(),
                "get_best_time_to_play".into()
            ],
            &["get_best_time_to_play"]
        ),
        "get_best_time_to_play"
    );
}

#[test]
fn fragmented_tool_names_still_append_deltas() {
    assert_eq!(
        assemble_tool_name(
            &["get_best_".into(), "time_to_play".into()],
            &["get_best_time_to_play"]
        ),
        "get_best_time_to_play"
    );
}

#[test]
fn valid_repeated_name_fragments_are_not_deduplicated() {
    assert_eq!(
        assemble_tool_name(&["foo".into(), "foo".into()], &["foofoo"]),
        "foofoo"
    );
}

#[test]
fn tool_arguments_accept_delta_and_cumulative_streams() {
    assert_eq!(
        assemble_tool_arguments(&["{\"limit\":".into(), "10}".into()]),
        r#"{"limit":10}"#
    );
    assert_eq!(
        assemble_tool_arguments(&[r#"{"limit":10}"#.into(), r#"{"limit":10}"#.into()]),
        r#"{"limit":10}"#
    );
    assert_eq!(
        assemble_tool_arguments(&[r#"{"limit":"#.into(), r#"{"limit":10}"#.into()]),
        r#"{"limit":10}"#
    );
    assert_eq!(
        assemble_tool_arguments(&["{}".into(), r#"{"limit":"#.into(), "10}".into()]),
        r#"{}{"limit":10}"#
    );
}

#[tokio::test]
async fn streamed_answers_outlasting_the_timeout_arrive_complete_while_chunks_keep_flowing() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut chunk = [0_u8; 4096];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let read = stream.read(&mut chunk).await.unwrap();
            request.extend_from_slice(&chunk[..read]);
        }
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n",
            )
            .await
            .unwrap();
        for piece in ["a", "b", "c", "d", "e", "f"] {
            tokio::time::sleep(Duration::from_millis(150)).await;
            let line =
                format!("data: {{\"choices\":[{{\"delta\":{{\"content\":\"{piece}\"}}}}]}}\n\n");
            if stream.write_all(line.as_bytes()).await.is_err() {
                return;
            }
        }
        let _ = stream.write_all(b"data: [DONE]\n\n").await;
    });
    let client =
        LlmClient::with_timeout(base_url, "", "model", None, Duration::from_millis(500)).unwrap();

    let turn = client
        .stream_chat(
            &[ChatMessage::user("hi")],
            &[],
            &LlmRequestOptions::default(),
            |_| {},
        )
        .await
        .unwrap();

    assert_eq!(turn.content, "abcdef");
    server.await.unwrap();
}

#[tokio::test]
async fn non_streaming_completions_still_stop_at_the_overall_timeout() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut chunk = [0_u8; 4096];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let read = stream.read(&mut chunk).await.unwrap();
            request.extend_from_slice(&chunk[..read]);
        }
        let _ = stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n",
            )
            .await;
        for _ in 0..20 {
            tokio::time::sleep(Duration::from_millis(150)).await;
            if stream.write_all(b" ").await.is_err() {
                return;
            }
        }
    });
    let client =
        LlmClient::with_timeout(base_url, "", "model", None, Duration::from_millis(500)).unwrap();

    let started = std::time::Instant::now();
    let result = client
        .complete_chat(&[ChatMessage::user("hi")], &LlmRequestOptions::default())
        .await;

    assert!(result.is_err());
    assert!(started.elapsed() < Duration::from_secs(2));
}

#[test]
fn stream_lines_record_finish_reason_done_and_in_band_errors() {
    let mut state = ChatStreamState::default();
    let mut on_text = |_: &str| {};

    apply_chat_stream_line(
        r#"data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}"#,
        &mut on_text,
        &mut state,
    );
    apply_chat_stream_line("data: [DONE]", &mut on_text, &mut state);
    assert_eq!(state.finish_reason.as_deref(), Some("length"));
    assert!(state.done);
    assert!(state.error.is_none());

    apply_chat_stream_line(
        r#"data: {"error":{"message":"upstream overloaded","code":502}}"#,
        &mut on_text,
        &mut state,
    );
    assert!(matches!(
        state.error,
        Some(LlmError::Api { status: 502, ref message }) if message == "upstream overloaded"
    ));
}

const SSE_STOP: &str = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"ok\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";

fn json_error_response(status_line: &str, extra_headers: &str, body: &str) -> String {
    format!(
        "HTTP/1.1 {status_line}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{extra_headers}Connection: close\r\n\r\n{body}",
        body.len()
    )
}

async fn serve_scripted(responses: Vec<String>) -> (String, Arc<AtomicUsize>) {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let hits = Arc::new(AtomicUsize::new(0));
    let served = hits.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let index = served.fetch_add(1, Ordering::SeqCst);
            let response = responses[index.min(responses.len() - 1)].clone();
            let mut request = Vec::new();
            let mut chunk = [0_u8; 4096];
            while !request.windows(4).any(|window| window == b"\r\n\r\n") {
                let read = stream.read(&mut chunk).await.unwrap();
                if read == 0 {
                    break;
                }
                request.extend_from_slice(&chunk[..read]);
            }
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.shutdown().await;
        }
    });
    (base_url, hits)
}

async fn stream_once(base_url: String) -> Result<AssistantTurn, LlmError> {
    let client = LlmClient::new(base_url, "", "model", None).unwrap();
    client
        .stream_chat(
            &[ChatMessage::user("hi")],
            &[],
            &LlmRequestOptions::default(),
            |_| {},
        )
        .await
}

#[tokio::test]
async fn rate_limited_requests_retry_after_the_server_delay() {
    let (base_url, hits) = serve_scripted(vec![
        json_error_response(
            "429 Too Many Requests",
            "Retry-After: 0\r\n",
            r#"{"error":{"message":"rate limited"}}"#,
        ),
        json_error_response("503 Service Unavailable", "retry-after-ms: 10\r\n", "{}"),
        SSE_STOP.into(),
    ])
    .await;

    let turn = stream_once(base_url).await.unwrap();

    assert_eq!(turn.content, "ok");
    assert!(!turn.truncated());
    assert_eq!(hits.load(Ordering::SeqCst), 3);
}

async fn stream_and_capture_body(tools: &[ToolDefinition], options: &LlmRequestOptions) -> Value {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.unwrap();
    let base_url = format!("http://{}/v1", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut chunk = [0_u8; 4096];
        let body_start = loop {
            let read = stream.read(&mut chunk).await.unwrap();
            request.extend_from_slice(&chunk[..read]);
            if let Some(end) = request.windows(4).position(|window| window == b"\r\n\r\n") {
                break end + 4;
            }
        };
        let headers = String::from_utf8_lossy(&request[..body_start]).to_ascii_lowercase();
        let length: usize = headers
            .lines()
            .find_map(|line| line.strip_prefix("content-length:"))
            .unwrap()
            .trim()
            .parse()
            .unwrap();
        while request.len() < body_start + length {
            let read = stream.read(&mut chunk).await.unwrap();
            request.extend_from_slice(&chunk[..read]);
        }
        stream.write_all(SSE_STOP.as_bytes()).await.unwrap();
        let _ = stream.shutdown().await;
        serde_json::from_slice::<Value>(&request[body_start..body_start + length]).unwrap()
    });

    LlmClient::new(base_url, "", "model", None)
        .unwrap()
        .stream_chat(&[ChatMessage::user("hi")], tools, options, |_| {})
        .await
        .unwrap();
    server.await.unwrap()
}

#[tokio::test]
async fn forbidding_tool_calls_keeps_tools_declared_with_tool_choice_none() {
    let tools = [ToolDefinition {
        name: "search".into(),
        description: "search".into(),
        parameters: serde_json::json!({ "type": "object" }),
    }];

    let allowed = stream_and_capture_body(&tools, &LlmRequestOptions::default()).await;
    assert!(allowed.get("tool_choice").is_none());

    let forbidden = stream_and_capture_body(
        &tools,
        &LlmRequestOptions {
            forbid_tool_calls: true,
            ..LlmRequestOptions::default()
        },
    )
    .await;
    assert_eq!(forbidden["tool_choice"], "none");
    assert_eq!(forbidden["tools"][0]["function"]["name"], "search");
}

#[tokio::test]
async fn exhausted_quota_and_client_errors_are_not_retried() {
    for response in [
        json_error_response(
            "429 Too Many Requests",
            "Retry-After: 0\r\n",
            r#"{"error":{"code":"insufficient_quota"}}"#,
        ),
        json_error_response("400 Bad Request", "", r#"{"error":"bad"}"#),
        json_error_response("429 Too Many Requests", "Retry-After: 3600\r\n", "{}"),
    ] {
        let (base_url, hits) = serve_scripted(vec![response]).await;

        let result = stream_once(base_url).await;

        assert!(matches!(result, Err(LlmError::Api { .. })));
        assert_eq!(hits.load(Ordering::SeqCst), 1);
    }
}

#[tokio::test]
async fn retries_stop_after_the_attempt_limit() {
    let (base_url, hits) = serve_scripted(vec![json_error_response(
        "502 Bad Gateway",
        "Retry-After: 0\r\n",
        "{}",
    )])
    .await;

    let result = stream_once(base_url).await;

    assert!(matches!(result, Err(LlmError::Api { status: 502, .. })));
    assert_eq!(hits.load(Ordering::SeqCst), MAX_RETRIES as usize + 1);
}

#[tokio::test]
async fn streams_that_end_without_finishing_are_errors() {
    let (base_url, _) = serve_scripted(vec![
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"content\":\"half\"}}]}\n\n".into(),
    ])
    .await;

    let result = stream_once(base_url).await;

    assert!(matches!(
        result,
        Err(LlmError::Api { status: 200, ref message }) if message.contains("ended before")
    ));
}

#[tokio::test]
async fn in_band_stream_errors_surface_instead_of_an_empty_answer() {
    let (base_url, hits) = serve_scripted(vec![
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"error\":{\"message\":\"provider failed\",\"code\":502}}\n\ndata: [DONE]\n\n".into(),
    ])
    .await;

    let result = stream_once(base_url).await;

    assert!(matches!(
        result,
        Err(LlmError::Api { status: 502, ref message }) if message == "provider failed"
    ));
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn length_finish_reason_marks_the_turn_truncated() {
    let (base_url, _) = serve_scripted(vec![
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\ndata: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"get_summary\",\"arguments\":\"{\\\"limit\\\": 1\"}}]},\"finish_reason\":\"length\"}]}\n\ndata: [DONE]\n\n".into(),
    ])
    .await;

    let turn = stream_once(base_url).await.unwrap();

    assert!(turn.truncated());
    assert_eq!(turn.tool_calls.len(), 1);
}
