use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{Client, Proxy};
use serde::{Deserialize, Serialize};
use serde_json::Value;
pub use vrcx_0_contracts::llm::{
    AssistantTurn, ChatMessage, FunctionCall, LlmEndpointDetectModelsResult, LlmModelReasoning,
    LlmRequestOptions, ToolCall, ToolDefinition,
};
use vrcx_0_core::proxy::with_remote_dns;

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("LLM transport error: {}", transport_error_detail(.0))]
    Http(#[from] reqwest::Error),
    #[error("LLM API error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("LLM not configured")]
    NotConfigured,
}

const OPENROUTER_REASONING_EFFORTS: &[&str] =
    &["max", "xhigh", "high", "medium", "low", "minimal", "none"];
const MAX_RETRIES: u32 = 3;
const MAX_SERVER_RETRY_DELAY: Duration = Duration::from_secs(60);
const QUOTA_EXHAUSTED_MARKERS: &[&str] = &["insufficient_quota", "quota exceeded", "billing"];

#[derive(Clone)]
pub struct LlmClient {
    http: Client,
    request_timeout: Duration,
    base_url: String,
    api_key: String,
    model: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    tool_choice: Option<&'static str>,
    stream: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<ReasoningRequest>,
}

#[derive(Deserialize)]
struct ChatChunk {
    #[serde(default)]
    choices: Vec<ChunkChoice>,
    #[serde(default)]
    error: Option<Value>,
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
    #[serde(default)]
    finish_reason: Option<String>,
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

#[derive(Default)]
struct ChatStreamState {
    content: String,
    tool_acc: Vec<ToolCallAcc>,
    reasoning_details: Vec<Value>,
    finish_reason: Option<String>,
    done: bool,
    error: Option<LlmError>,
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
        Self::with_timeout(
            base_url,
            api_key,
            model,
            proxy_url,
            Duration::from_secs(180),
        )
    }

    fn with_timeout(
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
        proxy_url: Option<&str>,
        timeout: Duration,
    ) -> Result<Self, LlmError> {
        let mut builder = Client::builder()
            .connect_timeout(timeout)
            .read_timeout(timeout);
        if let Some(proxy_url) = proxy_url {
            builder = builder.proxy(Proxy::all(with_remote_dns(proxy_url).as_ref())?);
        }
        let http = builder.build()?;
        let base_url = base_url.into();
        Ok(Self {
            http,
            request_timeout: timeout,
            base_url: normalize_base_url(&base_url),
            api_key: api_key.into(),
            model: model.into(),
        })
    }

    /// List the models the configured endpoint advertises (`GET /models`).
    pub async fn list_models(&self) -> Result<LlmEndpointDetectModelsResult, LlmError> {
        let url = format!("{}/models", self.base_url);
        let response = self
            .authorized(self.http.get(&url))
            .timeout(self.request_timeout)
            .send()
            .await?;
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
            tool_choice: None,
            stream: false,
            reasoning: reasoning_request(options),
        };

        let url = format!("{}/chat/completions", self.base_url);
        let response = self
            .send_with_retry(|| {
                self.authorized(self.http.post(&url))
                    .json(&body)
                    .timeout(self.request_timeout)
            })
            .await?;

        let body = response.text().await?;
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
            tool_choice: (options.forbid_tool_calls && !tools.is_empty()).then_some("none"),
            stream: true,
            reasoning: reasoning_request(options),
        };

        let url = format!("{}/chat/completions", self.base_url);
        let response = self
            .send_with_retry(|| self.authorized(self.http.post(&url)).json(&body))
            .await?;

        let mut stream = response.bytes_stream();
        let mut buffer: Vec<u8> = Vec::new();
        let mut state = ChatStreamState::default();

        while let Some(chunk) = stream.next().await {
            buffer.extend_from_slice(&chunk?);
            drain_complete_lines(&mut buffer, |line| {
                apply_chat_stream_line(line, &mut on_text, &mut state);
            });
        }
        if let Some(line) = take_remaining_line(&mut buffer) {
            apply_chat_stream_line(&line, &mut on_text, &mut state);
        }
        if let Some(error) = state.error {
            return Err(error);
        }
        if !state.done && state.finish_reason.is_none() {
            return Err(LlmError::Api {
                status: 200,
                message: "chat stream ended before the model finished its response".into(),
            });
        }

        let tool_names = tools
            .iter()
            .map(|tool| tool.name.as_str())
            .collect::<Vec<_>>();
        let tool_calls = state
            .tool_acc
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
            content: state.content,
            tool_calls,
            reasoning_details: state.reasoning_details,
            finish_reason: state.finish_reason,
        })
    }

    async fn send_with_retry(
        &self,
        build: impl Fn() -> reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, LlmError> {
        let mut attempt = 0;
        loop {
            let (delay, error) = match build().send().await {
                Ok(response) if response.status().is_success() => return Ok(response),
                Ok(response) => {
                    let status = response.status();
                    let headers = response.headers().clone();
                    let message = response.text().await.unwrap_or_default();
                    (
                        retry_delay(status, &headers, &message, attempt),
                        LlmError::Api {
                            status: status.as_u16(),
                            message,
                        },
                    )
                }
                Err(error) if error.is_connect() => (Some(backoff_delay(attempt)), error.into()),
                Err(error) => return Err(error.into()),
            };
            let Some(delay) = delay.filter(|_| attempt < MAX_RETRIES) else {
                return Err(error);
            };
            tracing::warn!(attempt, delay_ms = delay.as_millis(), %error, "assistant: retrying LLM request");
            tokio::time::sleep(delay).await;
            attempt += 1;
        }
    }
}

fn retry_delay(
    status: reqwest::StatusCode,
    headers: &reqwest::header::HeaderMap,
    body: &str,
    attempt: u32,
) -> Option<Duration> {
    let retryable = matches!(status.as_u16(), 408 | 409 | 429) || status.is_server_error();
    if !retryable {
        return None;
    }
    let body = body.to_ascii_lowercase();
    if QUOTA_EXHAUSTED_MARKERS
        .iter()
        .any(|marker| body.contains(marker))
    {
        return None;
    }
    match server_retry_delay(headers) {
        Some(delay) if delay > MAX_SERVER_RETRY_DELAY => None,
        Some(delay) => Some(delay),
        None => Some(backoff_delay(attempt)),
    }
}

fn server_retry_delay(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let header_secs = |name: &str, scale: f64| {
        headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.trim().parse::<f64>().ok())
            .and_then(|value| Duration::try_from_secs_f64(value / scale).ok())
    };
    header_secs("retry-after-ms", 1000.0).or_else(|| header_secs("retry-after", 1.0))
}

fn backoff_delay(attempt: u32) -> Duration {
    Duration::from_secs(1 << attempt.min(3))
}

pub fn transport_error_detail(error: &reqwest::Error) -> String {
    let kind = if error.is_timeout() {
        Some("timeout")
    } else if error.is_connect() {
        Some("connect")
    } else if error.is_body() {
        Some("body")
    } else if error.is_decode() {
        Some("decode")
    } else if error.is_request() {
        Some("request")
    } else {
        None
    };
    let mut chain = error.to_string();
    let mut source = std::error::Error::source(error);
    while let Some(cause) = source {
        let message = cause.to_string();
        if !message.is_empty() && !chain.contains(&message) {
            chain.push_str(": ");
            chain.push_str(&message);
        }
        source = cause.source();
    }
    match kind {
        Some(kind) => format!("{kind}: {chain}"),
        None => chain,
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

fn apply_chat_stream_line<F>(line: &str, on_text: &mut F, state: &mut ChatStreamState)
where
    F: FnMut(&str),
{
    let Some(data) = line.trim_end().strip_prefix("data:") else {
        return;
    };
    let data = data.trim();
    if data.is_empty() {
        return;
    }
    if data == "[DONE]" {
        state.done = true;
        return;
    }
    let Ok(parsed) = serde_json::from_str::<ChatChunk>(data) else {
        return;
    };
    if let Some(error) = parsed.error {
        state.error.get_or_insert_with(|| stream_error(&error));
        return;
    }
    for choice in parsed.choices {
        if let Some(text) = choice.delta.content {
            if !text.is_empty() {
                on_text(&text);
                state.content.push_str(&text);
            }
        }
        if let Some(details) = choice.delta.reasoning_details {
            state.reasoning_details.extend(details);
        }
        if let Some(reason) = choice.finish_reason.filter(|reason| !reason.is_empty()) {
            state.finish_reason = Some(reason);
        }
        if let Some(calls) = choice.delta.tool_calls {
            let tool_acc = &mut state.tool_acc;
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

fn stream_error(error: &Value) -> LlmError {
    let status = error
        .get("code")
        .and_then(Value::as_u64)
        .and_then(|code| u16::try_from(code).ok())
        .filter(|code| (400..600).contains(code))
        .unwrap_or(200);
    let message = error
        .get("message")
        .and_then(Value::as_str)
        .or_else(|| error.as_str())
        .map_or_else(|| error.to_string(), str::to_string);
    LlmError::Api { status, message }
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

fn drain_complete_lines(buffer: &mut Vec<u8>, mut handle_line: impl FnMut(&str)) {
    let Some(last_newline) = buffer.iter().rposition(|&byte| byte == b'\n') else {
        return;
    };
    let consumed = last_newline + 1;
    for line in buffer[..consumed].split_inclusive(|&byte| byte == b'\n') {
        let line = String::from_utf8_lossy(line);
        handle_line(line.as_ref());
    }
    buffer.drain(..consumed);
}

fn take_remaining_line(buffer: &mut Vec<u8>) -> Option<String> {
    if buffer.is_empty() {
        return None;
    }
    let remaining = std::mem::take(buffer);
    Some(
        String::from_utf8(remaining)
            .unwrap_or_else(|error| String::from_utf8_lossy(error.as_bytes()).into_owned()),
    )
}

#[cfg(test)]
mod tests;
