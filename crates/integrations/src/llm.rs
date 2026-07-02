use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, thiserror::Error)]
pub enum LlmError {
    #[error("LLM transport error: {0}")]
    Http(#[from] reqwest::Error),
    #[error("LLM API error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("LLM not configured")]
    NotConfigured,
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
            tool_call_id: Some(tool_call_id.into()),
        }
    }

    fn text(role: &str, content: impl Into<String>) -> Self {
        Self {
            role: role.into(),
            content: Some(content.into()),
            tool_calls: Vec::new(),
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
}

impl AssistantTurn {
    pub fn into_message(self) -> ChatMessage {
        ChatMessage {
            role: "assistant".into(),
            content: (!self.content.is_empty()).then_some(self.content),
            tool_calls: self.tool_calls,
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
struct ChatRequestBody<'a> {
    model: &'a str,
    messages: &'a [ChatMessage],
    #[serde(skip_serializing_if = "Vec::is_empty")]
    tools: Vec<RequestTool<'a>>,
    stream: bool,
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
    name: String,
    arguments: String,
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
}

impl LlmClient {
    pub fn new(
        base_url: impl Into<String>,
        api_key: impl Into<String>,
        model: impl Into<String>,
    ) -> Self {
        let http = Client::builder()
            .timeout(Duration::from_secs(180))
            .build()
            .unwrap_or_default();
        Self {
            http,
            base_url: normalize_base_url(base_url.into()),
            api_key: api_key.into(),
            model: model.into(),
        }
    }

    /// List the model ids the configured endpoint advertises (`GET /models`).
    pub async fn list_models(&self) -> Result<Vec<String>, LlmError> {
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
        let payload: ModelsResponse = serde_json::from_str(&body).map_err(|error| {
            tracing::warn!(url = %url, error = %error, body = %body, "assistant: model list parse failed");
            LlmError::Api {
                status: status.as_u16(),
                message: format!("unexpected /models response: {error}"),
            }
        })?;
        let mut models: Vec<String> = payload
            .data
            .into_iter()
            .filter_map(|model| model.id)
            .collect();
        models.sort();
        Ok(models)
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
    pub async fn complete_chat(&self, messages: &[ChatMessage]) -> Result<String, LlmError> {
        let body = ChatRequestBody {
            model: &self.model,
            messages,
            tools: Vec::new(),
            stream: false,
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

        while let Some(chunk) = stream.next().await {
            buffer.extend_from_slice(&chunk?);
            for line in drain_complete_lines(&mut buffer) {
                let Some(data) = line.trim_end().strip_prefix("data:") else {
                    continue;
                };
                let data = data.trim();
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                let Ok(parsed) = serde_json::from_str::<ChatChunk>(data) else {
                    continue;
                };
                for choice in parsed.choices {
                    if let Some(text) = choice.delta.content {
                        if !text.is_empty() {
                            on_text(&text);
                            content.push_str(&text);
                        }
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
                                    acc.name.push_str(&name);
                                }
                                if let Some(arguments) = function.arguments {
                                    acc.arguments.push_str(&arguments);
                                }
                            }
                        }
                    }
                }
            }
        }

        let tool_calls = tool_acc
            .into_iter()
            .enumerate()
            .filter(|(_, acc)| !acc.name.is_empty())
            .map(|(index, acc)| ToolCall {
                // Some local models omit the id; fall back to the index (not the
                // name) so two calls to the same tool keep distinct ids.
                id: if acc.id.is_empty() {
                    format!("call_{index}")
                } else {
                    acc.id
                },
                kind: "function".into(),
                function: FunctionCall {
                    name: acc.name,
                    arguments: acc.arguments,
                },
            })
            .collect();

        Ok(AssistantTurn {
            content,
            tool_calls,
        })
    }
}

fn normalize_base_url(raw: String) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
