use std::collections::BTreeMap;

use rmcp::model::{
    CallToolRequestParams, ElicitRequest, ElicitRequestParams, ElicitResult, ElicitationAction,
    ElicitationSchema, InputRequest, InputRequests, InputRequiredResult,
};
use serde::Deserialize;
use serde_json::{json, Map, Value};
use vrcx_0_contracts::social_aggregates::ResolvedUserRow;

pub(crate) const PICK_USER_INPUT_KEY: &str = "vrcx-0/pick-user";

#[derive(Clone, Debug, Deserialize)]
pub struct UserChoiceRequest {
    pub query: String,
    pub candidates: Vec<ResolvedUserRow>,
}

impl UserChoiceRequest {
    pub fn from_structured(structured: Option<&Value>) -> Option<Self> {
        let structured = structured?;
        if structured
            .get("needsDisambiguation")
            .and_then(Value::as_bool)
            != Some(true)
        {
            return None;
        }
        serde_json::from_value::<Self>(structured.clone())
            .ok()
            .filter(|request| !request.candidates.is_empty())
    }

    pub fn accepts(&self, user_id: &str) -> bool {
        self.candidates
            .iter()
            .any(|candidate| candidate.user_id == user_id)
    }

    pub(crate) fn elicit_params(&self) -> ElicitRequestParams {
        let options: Vec<Value> = self
            .candidates
            .iter()
            .map(|candidate| json!({ "const": candidate.user_id, "title": candidate_title(candidate) }))
            .collect();
        let schema = json!({
            "type": "object",
            "properties": {
                "userId": { "type": "string", "title": "Person", "oneOf": options }
            },
            "required": ["userId"]
        });
        ElicitRequestParams::FormElicitationParams {
            meta: None,
            message: format!(
                "Several people in your history match \"{}\". Which one did you mean?",
                self.query.trim()
            ),
            requested_schema: serde_json::from_value::<ElicitationSchema>(schema)
                .expect("user choice schema is a valid elicitation schema"),
        }
    }

    pub(crate) fn input_required(&self, choices: &BTreeMap<String, String>) -> InputRequiredResult {
        let requests = InputRequests::from([(
            PICK_USER_INPUT_KEY.to_string(),
            InputRequest::Elicitation(ElicitRequest::new(self.elicit_params())),
        )]);
        let state = serde_json::to_string(choices).unwrap_or_default();
        InputRequiredResult::new(Some(requests), Some(state))
    }

    pub(crate) fn accepted_user_id(&self, reply: &Value) -> Option<String> {
        let reply = serde_json::from_value::<ElicitResult>(reply.clone()).ok()?;
        if reply.action != ElicitationAction::Accept {
            return None;
        }
        let user_id = reply.content?.get("userId")?.as_str()?.to_string();
        self.accepts(&user_id).then_some(user_id)
    }
}

fn candidate_title(candidate: &ResolvedUserRow) -> String {
    let friend = if candidate.is_friend { ", friend" } else { "" };
    let last_seen = candidate
        .last_seen
        .get(..10)
        .unwrap_or(&candidate.last_seen);
    format!(
        "{}{friend} — met {} times, last seen {last_seen}",
        candidate.display_name, candidate.encounter_count
    )
}

pub fn apply_user_choice(arguments: &mut Map<String, Value>, query: &str, user_id: &str) -> bool {
    let query = query.trim();
    let mut applied = false;
    for value in arguments.values_mut() {
        if value.as_str().is_some_and(|text| text.trim() == query) {
            *value = Value::String(user_id.to_string());
            applied = true;
        }
    }
    applied
}

pub(crate) fn choices_from_state(request: &CallToolRequestParams) -> BTreeMap<String, String> {
    request
        .request_state
        .as_deref()
        .and_then(|state| serde_json::from_str(state).ok())
        .unwrap_or_default()
}

pub(crate) fn with_choices(
    request: &CallToolRequestParams,
    choices: &BTreeMap<String, String>,
) -> CallToolRequestParams {
    let mut request = request.clone();
    request.input_responses = None;
    request.request_state = None;
    if let Some(arguments) = request.arguments.as_mut() {
        for (query, user_id) in choices {
            apply_user_choice(arguments, query, user_id);
        }
    }
    request
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(user_id: &str, display_name: &str) -> ResolvedUserRow {
        ResolvedUserRow {
            user_id: user_id.into(),
            display_name: display_name.into(),
            matched_name: display_name.into(),
            is_friend: false,
            encounter_count: 2,
            last_seen: "2026-10-01T12:00:00Z".into(),
        }
    }

    fn request() -> UserChoiceRequest {
        UserChoiceRequest {
            query: "Ali".into(),
            candidates: vec![row("usr_a", "Alice"), row("usr_b", "Alicia")],
        }
    }

    #[test]
    fn reads_choice_request_only_from_disambiguation_results() {
        let structured = json!({
            "needsDisambiguation": true,
            "query": "Ali",
            "candidates": [{
                "userId": "usr_a", "displayName": "Alice", "matchedName": "Alice",
                "isFriend": true, "encounterCount": 3, "lastSeen": "2026-10-01T12:00:00Z"
            }]
        });
        let choice = UserChoiceRequest::from_structured(Some(&structured)).unwrap();
        assert_eq!(choice.query, "Ali");
        assert!(choice.accepts("usr_a"));

        let missing_target = json!({ "needsDisambiguation": true, "summary": "Which person?" });
        assert!(UserChoiceRequest::from_structured(Some(&missing_target)).is_none());
        assert!(UserChoiceRequest::from_structured(Some(&json!({ "rows": [] }))).is_none());
    }

    #[test]
    fn accepts_only_a_listed_candidate_from_an_accepted_reply() {
        let choice = request();
        let accept =
            |user_id: &str| json!({ "action": "accept", "content": { "userId": user_id } });

        assert_eq!(
            choice.accepted_user_id(&accept("usr_b")).as_deref(),
            Some("usr_b")
        );
        assert_eq!(choice.accepted_user_id(&accept("usr_other")), None);
        assert_eq!(
            choice.accepted_user_id(&json!({ "action": "decline" })),
            None
        );
    }

    #[test]
    fn elicitation_lists_each_candidate_as_a_titled_option() {
        let ElicitRequestParams::FormElicitationParams {
            message,
            requested_schema,
            ..
        } = request().elicit_params()
        else {
            panic!("expected a form elicitation");
        };
        assert!(message.contains("\"Ali\""));
        let schema = serde_json::to_value(requested_schema).unwrap();
        let options = &schema["properties"]["userId"]["oneOf"];
        assert_eq!(options[0]["const"], "usr_a");
        assert_eq!(options[1]["const"], "usr_b");
        assert!(options[1]["title"]
            .as_str()
            .unwrap()
            .starts_with("Alicia — met 2 times, last seen 2026-10-01"));
    }

    #[test]
    fn chosen_ids_replace_the_ambiguous_argument_and_survive_request_state() {
        let mut arguments = Map::new();
        arguments.insert("user".into(), json!(" Ali "));
        arguments.insert("timeWindow".into(), json!("7d"));
        let mut original = CallToolRequestParams::new("get_friend_profile");
        original = original.with_arguments(arguments);

        let choices = BTreeMap::from([("Ali".to_string(), "usr_b".to_string())]);
        let state = request().input_required(&choices).request_state.unwrap();
        let restored = choices_from_state(&original.clone().with_request_state(state));
        let retried = with_choices(&original, &restored);

        let arguments = retried.arguments.unwrap();
        assert_eq!(arguments["user"], "usr_b");
        assert_eq!(arguments["timeWindow"], "7d");
        assert!(retried.request_state.is_none());
    }
}
