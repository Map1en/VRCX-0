use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{Client, Proxy};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use specta::Type;

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("LLM transport error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("LLM API error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("LLM not configured")]
    NotConfigured,
}

const OPENROUTER_CANONICAL_BASE_URL: &str = "https://openrouter.ai/api/v1";
const OPENROUTER_REASONING_EFFORTS: &[&str] =
    &["max", "xhigh", "high", "medium", "low", "minimal", "none"];

pub fn is_openrouter_base_url(base_url: &str) -> bool {
    normalize_base_url(base_url) == OPENROUTER_CANONICAL_BASE_URL
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmModelReasoning {
    pub model_id: String,
    pub supported_efforts: Vec<String>,
    pub mandatory: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LlmEndpointDetectModelsResult {
    pub models: Vec<String>,
    pub model_reasoning: Vec<LlmModelReasoning>,
}

#[derive(Debug, Clone, Default)]
pub struct LlmRequestOptions {
    pub reasoning_effort: Option<String>,
}

#[derive(Clone)]
pub struct LlmClient {
    http: Client,
    base_url: String,
    api_key: String,
    model: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FunctionCall {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: FunctionCall,
}

#[derive(Debug, Clone, Serialize)]
pub struct ChatMessage {
    pub role: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub reasoning_details: Vec<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
}

impl ChatMessage {
    pub fn system(content: impl Into<String>) -> Self {
        Self::text("system", content)
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self::text("user", content)
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self::text("assistant", content)
    }

    pub fn tool(tool_call_id: impl Into<String>, content: impl Into<String>) -> Self {
        Self {
            role: "tool".into(),
            content: Some(content.into()),
            tool_calls: Vec::new(),
            reasoning_details: Vec::new(),
            tool_call_id: Some(tool_call_id.into()),
        }
    }

    fn text(role: &str, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: Some(content.into()),
            tool_calls: Vec::new(),
            reasoning_details: Vec::new(),
            tool_call_id: None,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ToolDefinition {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

#[derive(Debug, Clone)]
pub struct AssistantTurn {
    pub content: String,
    pub tool_calls: Vec<ToolCall>,
    pub reasoning_details: Vec<Value>,
}

impl AssistantTurn {
    pub fn into_message(self) -> ChatMessage {
        ChatMessage {
            role: "assistant".into(),
            content: (!self.content.is_empty()).then_some(self.content),
            tool_calls: self.tool_calls,
            reasoning_details: self.reasoning_details,
            tool_call_id: None,
        }
    }
}

#[derive(Serialize)]
struct RequestFunction<'a> {
    name: &'a str,
    description: &'a str,
    parameters: &'a Value,
}

#[derive(Serialize)]
struct RequestTool<'a> {
    #[serde(rename = "type")]
    kind: &'static str,
    function: RequestFunction<'a>,
}

#[derive(Serialize)]
struct ReasoningRequest {
    effort: String,
}

#[derive(Serialize)]
struct ChatRequestBody<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<RequestTool<'a>>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<ReasoningRequest>,
}

#[derive(Deserialize)]
struct ChatChunk {
    #[serde(default)]
    choices: Vec<ChunkChoice>,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    #[serde(default)]
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Deserialize, Default)]
struct ChatCompletionChoice {
    #[serde(default)]
    message: ChatCompletionMessage,
}

#[derive(Deserialize, Default)]
struct ChatCompletionMessage {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Deserialize)]
struct ChunkChoice {
    #[serde(default)]
    delta: ChunkDelta,
}

#[derive(Deserialize, Default)]
struct ChunkDelta {
    #[serde(default)]
    content: Option<String>,
    #[serde(default)]
    tool_calls: Option<Vec<ChunkToolCall>>,
    #[serde(default)]
    reasoning_details: Option<Vec<Value>>,
}

#[derive(Deserialize)]
struct ChunkToolCall {
    index: usize,
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    function: Option<ChunkFunction>,
}

#[derive(Deserialize)]
struct ChunkFunction {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    arguments: Option<String>,
}

#[derive(Default)]
struct ToolCallAcc {
    id: String,
    name_fragments: Vec<String>,
    argument_fragments: Vec<String>,
}

#[derive(Deserialize)]
struct ModelsResponse {
    #[serde(default)]
    data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    #[serde(default)]
    id: Option<String>,
    #[serde(default)]
    reasoning: Option<Value>,
}

impl LlmClient {
    pub fn new(
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
        proxy_url: Option<&str>,
    ) -> Result<Self, LlmError> {
        let mut builder = Client::builder().timeout(Duration::from_secs(180));
        if let Some(proxy_url) = proxy_url {
            builder = builder.proxy(Proxy::all(proxy_url)?);
        }
        let http = builder.build()?;
        let base_url = base_url.into();
        Ok(Self {
            http,
            base_url: normalize_base_url(&base_url),
            api_key: api_key.into(),
            model: model.into(),
        })
    }

    /// List the models the configured endpoint advertises (`GET /models`).
    pub async fn list_models(&self) -> Result<LlmEndpointDetectModelsResult, LlmError> {
        let url = format!("{}/models", self.base_url);
        let response = self.authorized(self.http.get(&url)).send().await?;
        let status = response.status();
        if !status.is_success() {
            let message = response.text().await.unwrap_or_default();
            tracing::warn!(url = %url, status = %status, body = %message, "assistant: model fetch failed");
            return Err(LlmError::Api {
                status: status.as_u16(),
                message,
            });
        }
        let body = response.text().await?;
        parse_models_response(&body, status.as_u16()).map_err(|error| {
            tracing::warn!(url = %url, error = %error, body = %body, "assistant: model list parse failed");
            error
        })
    }

    /// Apply bearer auth only when a key is configured; local endpoints
    /// (Ollama, LM Studio) accept anonymous requests and reject an empty bearer.
    fn authorized(&self, request: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if self.api_key.is_empty() {
            request
        } else {
            request.bearer_auth(&self.api_key)
        }
    }

    /// Request one non-streaming chat completion.
    pub async fn complete_chat(
        &self,
        messages: &[ChatMessage],
        options: &LlmRequestOptions,
    ) -> Result<String, LlmError> {
        let body = ChatRequestBody {
            model: &self.model,
            messages,
            tools: Vec::new(),
            stream: false,
            reasoning: reasoning_request(options),
        };

        let response = self
            .authorized(
                self.http
                    .post(format!("{}/chat/completions", self.base_url)),
            )
            .json(&body)
            .send()
            .await?;

        let status = response.status();
        let body = response.text().await?;
        if !status.is_success() {
            return Err(LlmError::Api {
                status: status.as_u16(),
                message: body,
            });
        }
        parse_chat_completion_content(&body)
    }

    /// Stream one chat completion. `on_text` is called with each content delta
    /// for live UI rendering; the assembled turn (text + tool calls) is returned.
    pub async fn stream_chat<F>(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        options: &LlmRequestOptions,
        mut on_text: F,
    ) -> Result<AssistantTurn, LlmError>
    where
        F: FnMut(&str),
    {
        let request_tools = tools
            .iter()
            .map(|tool| RequestTool {
                kind: "function",
                function: RequestFunction {
                    name: &tool.name,
                    description: &tool.description,
                    parameters: &tool.parameters,
                },
            })
            .collect();
        let body = ChatRequestBody {
            model: &self.model,
            messages,
            tools: request_tools,
            stream: true,
            reasoning: reasoning_request(options),
        };

        let response = self
            .authorized(
                self.http
                    .post(format!("{}/chat/completions", self.base_url)),
            )
            .json(&body)
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let message = response.text().await.unwrap_or_default();
            return Err(LlmError::Api { status, message });
        }

        let mut stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        let mut content = String::new();
        let mut tool_acc: Vec<ToolCallAcc> = Vec::new();
        let mut reasoning_details = Vec::new();

        while let Some(chunk) = stream.next().await {
            buffer.extend_from_slice(&chunk?);
            for line in drain_complete_lines(&mut buffer) {
                apply_chat_stream_line(
                    &line,
                    &mut on_text,
                    &mut content,
                    &mut tool_acc,
                    &mut reasoning_details,
                );
            }
        }
        if let Some(line) = take_remaining_line(&mut buffer) {
            apply_chat_stream_line(
                &line,
                &mut on_text,
                &mut content,
                &mut tool_acc,
                &mut reasoning_details,
            );
        }

        let tool_names = tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();
        let tool_calls = tool_acc
            .into_iter()
            .enumerate()
            .filter_map(|(index, acc)| {
                let name = assemble_tool_name(&acc.name_fragments, &tool_names);
                if name.is_empty() {
                    return None;
                }
                Some(ToolCall {
                    // Some local models omit the id; fall back to the index (not the
                    // name) so two calls to the same tool keep distinct ids.
                    id: if acc.id.is_empty() {
                        format!("call_{index}")
                    } else {
                        acc.id
                    },
                    kind: "function".into(),
                    function: FunctionCall {
                        name,
                        arguments: assemble_tool_arguments(&acc.argument_fragments),
                    },
                })
            })
            .collect();

        Ok(AssistantTurn {
            content,
            tool_calls,
            reasoning_details,
        })
    }
}

fn parse_models_response(
    body: &str,
    status: u16,
) -> Result<LlmEndpointDetectModelsResult, LlmError> {
    let payload: ModelsResponse = serde_json::from_str(body).map_err(|error| LlmError::Api {
        status,
        message: format!("unexpected /models response: {error}"),
    })?;
    let mut models = Vec::new();
    let mut model_reasoning = Vec::new();
    for entry in payload.data {
        let Some(id) = entry.id else {
            continue;
        };
        models.push(id.clone());
        let Some(reasoning) = entry.reasoning.as_ref().and_then(Value::as_object) else {
            continue;
        };
        let supported_efforts = match reasoning.get("supported_efforts") {
            Some(Value::Array(efforts)) => efforts
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>(),
            Some(Value::Null) => OPENROUTER_REASONING_EFFORTS
                .iter()
                .map(|effort| (*effort).to_string())
                .collect(),
            _ => continue,
        };
        if supported_efforts.is_empty() {
            continue;
        }
        model_reasoning.push(LlmModelReasoning {
            model_id: id,
            supported_efforts,
            mandatory: reasoning
                .get("mandatory")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        });
    }
    models.sort();
    Ok(LlmEndpointDetectModelsResult {
        models,
        model_reasoning,
    })
}

fn reasoning_request(options: &LlmRequestOptions) -> Option<ReasoningRequest> {
    options
        .reasoning_effort
        .as_ref()
        .filter(|value| !value.is_empty())
        .map(|effort| ReasoningRequest {
            effort: effort.clone(),
        })
}

fn apply_chat_stream_line<F>(
    line: &str,
    on_text: &mut F,
    content: &mut String,
    tool_acc: &mut Vec<ToolCallAcc>,
    reasoning_details: &mut Vec<Value>,
) where
    F: FnMut(&str),
{
    let Some(data) = line.trim_end().strip_prefix("data:") else {
        return;
    };
    let data = data.trim();
    if data.is_empty() || data == "[DONE]" {
        return;
    }
    let Ok(parsed) = serde_json::from_str::<ChatChunk>(data) else {
        return;
    };
    for choice in parsed.choices {
        if let Some(text) = choice.delta.content {
            if !text.is_empty() {
                on_text(&text);
                content.push_str(&text);
            }
        }
        if let Some(details) = choice.delta.reasoning_details {
            reasoning_details.extend(details);
        }
        if let Some(calls) = choice.delta.tool_calls {
            for call in calls {
                if tool_acc.len() <= call.index {
                    tool_acc.resize_with(call.index + 1, ToolCallAcc::default);
                }
                let acc = &mut tool_acc[call.index];
                if let Some(id) = call.id {
                    acc.id = id;
                }
                if let Some(function) = call.function {
                    if let Some(name) = function.name {
                        acc.name_fragments.push(name);
                    }
                    if let Some(arguments) = function.arguments {
                        acc.argument_fragments.push(arguments);
                    }
                }
            }
        }
    }
}

fn assemble_tool_name(fragments: &[String], tool_names: &[&str]) -> String {
    let concatenated = fragments.concat();
    if tool_names.contains(&concatenated.as_str()) {
        return concatenated;
    }
    if let Some(name) = fragments
        .last()
        .filter(|name| tool_names.contains(&name.as_str()))
    {
        return name.clone();
    }
    let cumulative = merge_cumulative_fragments(fragments);
    if tool_names.contains(&cumulative.as_str()) {
        cumulative
    } else {
        concatenated
    }
}

fn assemble_tool_arguments(fragments: &[String]) -> String {
    let concatenated = fragments.concat();
    if is_json_object(&concatenated) {
        return concatenated;
    }
    if let Some(snapshot) = fragments.last().filter(|value| is_json_object(value)) {
        return snapshot.clone();
    }
    let cumulative = merge_cumulative_fragments(fragments);
    if is_json_object(&cumulative) {
        cumulative
    } else {
        concatenated
    }
}

fn merge_cumulative_fragments(fragments: &[String]) -> String {
    let mut cumulative = String::new();
    for fragment in fragments {
        if fragment == &cumulative || cumulative.ends_with(fragment) {
            continue;
        }
        if fragment.starts_with(&cumulative) {
            cumulative.clear();
        }
        cumulative.push_str(fragment);
    }
    cumulative
}

fn is_json_object(value: &str) -> bool {
    matches!(serde_json::from_str::<Value>(value), Ok(Value::Object(_)))
}

fn normalize_base_url(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

fn parse_chat_completion_content(body: &str) -> Result<String, LlmError> {
    let payload: ChatCompletionResponse =
        serde_json::from_str(body).map_err(|error| LlmError::Api {
            status: 200,
            message: format!("unexpected chat completion response: {error}"),
        })?;
    let Some(content) = payload
        .choices
        .into_iter()
        .find_map(|choice| choice.message.content)
    else {
        return Err(LlmError::Api {
            status: 200,
            message: "unexpected chat completion response: missing message content".into(),
        });
    };
    let content = content.trim().to_string();
    if content.is_empty() {
        return Err(LlmError::Api {
            status: 200,
            message: "unexpected chat completion response: missing message content".into(),
        });
    }
    Ok(content)
}

// Drain every complete (newline-terminated) line from the byte buffer, decoding
// each as UTF-8. Partial trailing bytes stay buffered so a multibyte character
// split across network chunks is never decoded until it is whole.
fn drain_complete_lines(buffer: &mut Vec<u8>) -> Vec<String> {
    let Some(last_newline) = buffer.iter().rposition(|&byte| byte == b'\n') else {
        return Vec::new();
    };
    let consumed = last_newline + 1;
    let lines = buffer[..consumed]
        .split_inclusive(|&byte| byte == b'\n')
        .map(|line| String::from_utf8_lossy(line).into_owned())
        .collect();
    // Shift the unconsumed tail down once, instead of once per line.
    buffer.drain(..consumed);
    lines
}

fn take_remaining_line(buffer: &mut Vec<u8>) -> Option<String> {
    if buffer.is_empty() {
        return None;
    }
    let remaining = std::mem::take(buffer);
    Some(String::from_utf8_lossy(&remaining).into_owned())
}

#[cfg(test)]
mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;

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
    fn is_openrouter_base_url_matches_canonical_url_only() {
        assert!(is_openrouter_base_url("https://openrouter.ai/api/v1"));
        assert!(is_openrouter_base_url("https://openrouter.ai/api/v1/"));
        assert!(is_openrouter_base_url(" https://openrouter.ai/api/v1 "));
        assert!(!is_openrouter_base_url("https://openrouter.ai/api/v2"));
        assert!(!is_openrouter_base_url("https://api.openai.com/v1"));
        assert!(!is_openrouter_base_url(
            "https://openrouter-proxy.example/v1"
        ));
        assert!(!is_openrouter_base_url(""));
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
        };
        let body = ChatRequestBody {
            model: "m",
            messages: &messages,
            tools: Vec::new(),
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
        };
        let body = ChatRequestBody {
            model: "m",
            messages: &messages,
            tools: Vec::new(),
            stream: true,
            reasoning: reasoning_request(&options),
        };

        let json = serde_json::to_value(body).unwrap();
        assert_eq!(json["stream"], true);
        assert_eq!(json["reasoning"]["effort"], "xhigh");
    }

    #[test]
    fn streaming_reasoning_details_are_accumulated_in_response_order() {
        let mut content = String::new();
        let mut tool_acc = Vec::new();
        let mut reasoning_details = Vec::new();
        let mut on_text = |_: &str| {};

        apply_chat_stream_line(
            r#"data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.summary","summary":"Checking context","id":"summary-1","format":"anthropic-claude-v1","index":0}]}}]}"#,
            &mut on_text,
            &mut content,
            &mut tool_acc,
            &mut reasoning_details,
        );
        apply_chat_stream_line(
            r#"data: {"choices":[{"delta":{"reasoning_details":[{"type":"reasoning.encrypted","data":"opaque-data","id":"encrypted-1","format":"anthropic-claude-v1","index":1}]}}]}"#,
            &mut on_text,
            &mut content,
            &mut tool_acc,
            &mut reasoning_details,
        );

        assert_eq!(
            reasoning_details,
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

    #[test]
    fn accepts_socks5_proxy_url() {
        assert!(LlmClient::new(
            "https://example.com/v1",
            "",
            "model",
            Some("socks5://127.0.0.1:1080")
        )
        .is_ok());
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
        assert!(drain_complete_lines(&mut buffer).is_empty());

        buffer.extend_from_slice(&full[8..]);
        let lines = drain_complete_lines(&mut buffer);
        assert_eq!(lines, vec!["data: 你好👋\n".to_string()]);
        assert!(!lines[0].contains('\u{FFFD}'));
        assert!(buffer.is_empty());
    }

    #[test]
    fn drain_complete_lines_keeps_trailing_partial_line_buffered() {
        let mut buffer = b"data: a\ndata: b".to_vec();
        assert_eq!(drain_complete_lines(&mut buffer), vec!["data: a\n"]);
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
}
