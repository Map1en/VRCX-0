use futures_util::StreamExt;
use serde_json::{json, Value};

use super::{
    drain_complete_lines, reasoning_request, stream_error, take_remaining_line, AssistantTurn,
    ChatMessage, FunctionCall, LlmClient, LlmError, LlmRequestOptions, ToolCall, ToolDefinition,
};

impl LlmClient {
    pub(super) fn uses_responses_api(&self) -> bool {
        self.base_url == "https://api.openai.com/v1"
    }

    pub(super) async fn stream_responses<F>(
        &self,
        messages: &[ChatMessage],
        tools: &[ToolDefinition],
        options: &LlmRequestOptions,
        mut on_text: F,
    ) -> Result<AssistantTurn, LlmError>
    where
        F: FnMut(&str),
    {
        let input = responses_input(messages);
        let definitions: Vec<Value> = tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.parameters,
                    "strict": false,
                })
            })
            .collect();
        let mut body = json!({
            "model": self.model,
            "input": input,
            "stream": true,
            "store": false,
        });
        if !definitions.is_empty() {
            body["tools"] = json!(definitions);
            if options.forbid_tool_calls {
                body["tool_choice"] = json!("none");
            }
        }
        if let Some(reasoning) = reasoning_request(options) {
            body["reasoning"] = json!({ "effort": reasoning.effort });
        }

        let url = format!("{}/responses", self.base_url);
        let response = self
            .send_with_retry(|| self.authorized(self.http.post(&url)).json(&body))
            .await?;
        let mut stream = response.bytes_stream();
        let mut buffer = Vec::new();
        let mut state = ResponsesStreamState::default();
        while let Some(chunk) = stream.next().await {
            buffer.extend_from_slice(&chunk?);
            drain_complete_lines(&mut buffer, |line| {
                apply_line(line, &mut on_text, &mut state)
            });
        }
        if let Some(line) = take_remaining_line(&mut buffer) {
            apply_line(&line, &mut on_text, &mut state);
        }
        if let Some(error) = state.error {
            return Err(error);
        }
        let response = state.response.ok_or_else(|| LlmError::Api {
            status: 200,
            message: "responses stream ended before the model finished its response".into(),
        })?;
        response_turn(response, state.text)
    }
}

fn responses_input(messages: &[ChatMessage]) -> Vec<Value> {
    let mut input = Vec::new();
    for message in messages {
        if message.role == "assistant" && !message.reasoning_details.is_empty() {
            input.extend(message.reasoning_details.iter().cloned());
            continue;
        }
        if message.role == "tool" {
            input.push(json!({
                "type": "function_call_output",
                "call_id": message.tool_call_id,
                "output": message.content.as_deref().unwrap_or_default(),
            }));
            continue;
        }
        if let Some(content) = &message.content {
            input.push(json!({ "role": message.role, "content": content }));
        }
        for call in &message.tool_calls {
            input.push(json!({
                "type": "function_call", "call_id": call.id,
                "name": call.function.name, "arguments": call.function.arguments,
            }));
        }
    }
    input
}

#[derive(Default)]
struct ResponsesStreamState {
    text: String,
    response: Option<Value>,
    error: Option<LlmError>,
}

fn apply_line<F: FnMut(&str)>(line: &str, on_text: &mut F, state: &mut ResponsesStreamState) {
    let Some(data) = line.trim_end().strip_prefix("data:").map(str::trim) else {
        return;
    };
    let Ok(event) = serde_json::from_str::<Value>(data) else {
        return;
    };
    match event.get("type").and_then(Value::as_str) {
        Some("response.output_text.delta") => {
            if let Some(delta) = event.get("delta").and_then(Value::as_str) {
                state.text.push_str(delta);
                on_text(delta);
            }
        }
        Some("response.completed" | "response.incomplete") => {
            state.response = event.get("response").cloned();
        }
        Some("response.failed") => {
            let error = event.pointer("/response/error").unwrap_or(&event);
            state.error = Some(stream_error(error));
        }
        Some("error") => state.error = Some(stream_error(&event)),
        _ => {}
    }
}

fn response_turn(response: Value, streamed_text: String) -> Result<AssistantTurn, LlmError> {
    let output = response
        .get("output")
        .and_then(Value::as_array)
        .ok_or_else(|| LlmError::Api {
            status: 200,
            message: "unexpected responses API response: missing output".into(),
        })?;
    let mut calls = Vec::new();
    for item in output {
        if item.get("type").and_then(Value::as_str) != Some("function_call") {
            continue;
        }
        let field = |name| {
            item.get(name)
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
        };
        let (Some(id), Some(name), Some(arguments)) =
            (field("call_id"), field("name"), field("arguments"))
        else {
            return Err(LlmError::Api {
                status: 200,
                message: "unexpected responses API response: incomplete function call".into(),
            });
        };
        calls.push(ToolCall {
            id: id.into(),
            kind: "function".into(),
            function: FunctionCall {
                name: name.into(),
                arguments: arguments.into(),
            },
        });
    }
    let content = if streamed_text.is_empty() {
        output
            .iter()
            .filter(|item| item.get("type").and_then(Value::as_str) == Some("message"))
            .filter_map(|item| item.get("content").and_then(Value::as_array))
            .flatten()
            .filter(|part| part.get("type").and_then(Value::as_str) == Some("output_text"))
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect()
    } else {
        streamed_text
    };
    let finish_reason = if response.get("status").and_then(Value::as_str) == Some("incomplete") {
        if response
            .pointer("/incomplete_details/reason")
            .and_then(Value::as_str)
            == Some("max_output_tokens")
        {
            "length"
        } else {
            return Err(LlmError::Api {
                status: 200,
                message: format!(
                    "responses API returned an incomplete response: {}",
                    response["incomplete_details"]
                ),
            });
        }
    } else if !calls.is_empty() {
        "tool_calls"
    } else {
        "stop"
    };
    Ok(AssistantTurn {
        content,
        tool_calls: calls,
        reasoning_details: output.clone(),
        finish_reason: Some(finish_reason.into()),
    })
}

#[cfg(test)]
mod tests;
