use std::collections::HashSet;

use serde::Serialize;
use serde_json::{Map, Value};
use specta::Type;
use vrcx_0_contracts::llm::ToolDefinition;
use vrcx_0_mcp::ToolDescriptor;

use crate::pending::PendingReplies;

const DRY_RUN_ARGUMENT: &str = "dryRun";

/// A side-effecting tool call waiting for the user. `fields` are the exact
/// arguments the call runs with once approved.
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantApproval {
    pub id: String,
    pub tool_call_id: String,
    pub tool: String,
    pub fields: Vec<AssistantApprovalField>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantApprovalField {
    pub name: String,
    pub value: String,
}

pub(crate) type PendingApprovals = PendingReplies<bool>;

/// Tools that change something wait for the user's approval. Anything not
/// declared read-only counts, so a new tool without the annotation is gated.
#[derive(Default)]
pub(crate) struct ToolApprovalPolicy {
    gated: HashSet<String>,
    dry_run: HashSet<String>,
}

impl ToolApprovalPolicy {
    pub(crate) fn requires_approval(&self, tool: &str) -> bool {
        self.gated.contains(tool)
    }

    /// The approval card is the confirmation, so the model cannot turn an
    /// approved call into a dry run or skip the card with one.
    pub(crate) fn approved_arguments(
        &self,
        tool: &str,
        arguments: Option<Map<String, Value>>,
    ) -> Map<String, Value> {
        let mut arguments = arguments.unwrap_or_default();
        arguments.remove(DRY_RUN_ARGUMENT);
        if self.dry_run.contains(tool) {
            arguments.insert(DRY_RUN_ARGUMENT.into(), Value::Bool(false));
        }
        arguments
    }
}

pub(crate) fn tool_definitions(
    descriptors: Vec<ToolDescriptor>,
) -> (Vec<ToolDefinition>, ToolApprovalPolicy) {
    let mut policy = ToolApprovalPolicy::default();
    let definitions = descriptors
        .into_iter()
        .map(|tool| {
            let mut parameters = tool.parameters;
            if !tool.read_only {
                if strip_dry_run(&mut parameters) {
                    policy.dry_run.insert(tool.name.clone());
                }
                policy.gated.insert(tool.name.clone());
            }
            ToolDefinition {
                name: tool.name,
                description: tool.description,
                parameters,
            }
        })
        .collect();
    (definitions, policy)
}

fn strip_dry_run(parameters: &mut Value) -> bool {
    let removed = parameters
        .get_mut("properties")
        .and_then(Value::as_object_mut)
        .and_then(|properties| properties.remove(DRY_RUN_ARGUMENT))
        .is_some();
    if let Some(required) = parameters.get_mut("required").and_then(Value::as_array_mut) {
        required.retain(|field| field != DRY_RUN_ARGUMENT);
    }
    removed
}

pub(crate) fn approval_fields(arguments: &Map<String, Value>) -> Vec<AssistantApprovalField> {
    arguments
        .iter()
        .filter(|(name, value)| name.as_str() != DRY_RUN_ARGUMENT && !value.is_null())
        .map(|(name, value)| AssistantApprovalField {
            name: name.clone(),
            value: match value {
                Value::String(text) => text.clone(),
                other => serde_json::to_string_pretty(other).unwrap_or_default(),
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn descriptor(name: &str, read_only: bool, parameters: Value) -> ToolDescriptor {
        ToolDescriptor {
            name: name.into(),
            description: String::new(),
            parameters,
            read_only,
        }
    }

    fn write_schema() -> Value {
        json!({
            "type": "object",
            "properties": { "userId": { "type": "string" }, "dryRun": { "type": "boolean" } },
            "required": ["userId", "dryRun"],
        })
    }

    #[test]
    fn side_effecting_tools_are_gated_and_lose_their_dry_run_argument() {
        let (definitions, policy) = tool_definitions(vec![
            descriptor("get_friend_note", true, write_schema()),
            descriptor("set_friend_note", false, write_schema()),
            descriptor("send_chatbox_message", false, json!({ "type": "object" })),
        ]);

        assert!(!policy.requires_approval("get_friend_note"));
        assert!(policy.requires_approval("set_friend_note"));
        assert!(policy.requires_approval("send_chatbox_message"));
        assert!(definitions[0].parameters["properties"]
            .get("dryRun")
            .is_some());
        assert!(definitions[1].parameters["properties"]
            .get("dryRun")
            .is_none());
        assert_eq!(definitions[1].parameters["required"], json!(["userId"]));
    }

    #[test]
    fn approved_calls_always_run_for_real() {
        let (_, policy) = tool_definitions(vec![
            descriptor("set_friend_note", false, write_schema()),
            descriptor("send_chatbox_message", false, json!({ "type": "object" })),
        ]);
        let asked_for_dry_run = json!({ "userId": "usr_a", "dryRun": true });

        let note =
            policy.approved_arguments("set_friend_note", asked_for_dry_run.as_object().cloned());
        let chatbox = policy.approved_arguments(
            "send_chatbox_message",
            asked_for_dry_run.as_object().cloned(),
        );

        assert_eq!(
            Value::Object(note),
            json!({ "userId": "usr_a", "dryRun": false })
        );
        assert_eq!(Value::Object(chatbox), json!({ "userId": "usr_a" }));
    }

    #[test]
    fn approval_fields_show_what_runs_without_the_dry_run_switch() {
        let arguments = json!({
            "userId": "usr_a",
            "note": "met at the club",
            "limit": 3,
            "cursor": null,
            "dryRun": false,
        });

        let fields = approval_fields(arguments.as_object().unwrap());
        let names: Vec<&str> = fields.iter().map(|field| field.name.as_str()).collect();

        assert_eq!(names, ["limit", "note", "userId"]);
        assert_eq!(fields[1].value, "met at the club");
        assert_eq!(fields[0].value, "3");
    }
}
