use serde::Serialize;
use specta::Type;
use vrcx_0_application_core::{RuntimeEventBus, RuntimeEventPayload};

use crate::charts::AssistantChart;
use crate::choices::AssistantChoiceCandidate;
use crate::entities::Entity;
use crate::screenshots::AssistantScreenshots;
use vrcx_0_core::OwnerId;

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantDeltaEvent {
    pub owner_user_id: OwnerId,
    pub session_id: String,
    pub turn_id: String,
    pub text: String,
    pub replace: bool,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantToolCallEvent {
    pub owner_user_id: OwnerId,
    pub session_id: String,
    pub turn_id: String,
    pub tool_call_id: String,
    pub name: String,
    pub args: String,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantToolResultEvent {
    pub owner_user_id: OwnerId,
    pub session_id: String,
    pub turn_id: String,
    pub tool_call_id: String,
    pub ok: bool,
    pub summary: String,
    pub entities: Vec<Entity>,
    pub charts: Vec<AssistantChart>,
    pub screenshots: Option<AssistantScreenshots>,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantChoiceRequestEvent {
    pub owner_user_id: OwnerId,
    pub session_id: String,
    pub turn_id: String,
    pub tool_call_id: String,
    pub choice_id: String,
    pub query: String,
    pub candidates: Vec<AssistantChoiceCandidate>,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantTurnEntitiesEvent {
    pub owner_user_id: OwnerId,
    pub session_id: String,
    pub turn_id: String,
    pub entities: Vec<Entity>,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantDoneEvent {
    pub owner_user_id: OwnerId,
    pub session_id: String,
    pub turn_id: String,
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantErrorEvent {
    pub owner_user_id: OwnerId,
    pub session_id: String,
    pub turn_id: String,
    pub code: String,
    pub message: String,
}

impl RuntimeEventPayload for AssistantDeltaEvent {
    const EVENT_NAME: &'static str = "assistantDelta";
}

impl RuntimeEventPayload for AssistantToolCallEvent {
    const EVENT_NAME: &'static str = "assistantToolCall";
}

impl RuntimeEventPayload for AssistantToolResultEvent {
    const EVENT_NAME: &'static str = "assistantToolResult";
}

impl RuntimeEventPayload for AssistantChoiceRequestEvent {
    const EVENT_NAME: &'static str = "assistantChoiceRequest";
}

impl RuntimeEventPayload for AssistantTurnEntitiesEvent {
    const EVENT_NAME: &'static str = "assistantTurnEntities";
}

impl RuntimeEventPayload for AssistantDoneEvent {
    const EVENT_NAME: &'static str = "assistantDone";
}

impl RuntimeEventPayload for AssistantErrorEvent {
    const EVENT_NAME: &'static str = "assistantError";
}

#[derive(Clone)]
pub struct AssistantEmitter {
    bus: RuntimeEventBus,
    owner_user_id: OwnerId,
    session_id: String,
    turn_id: String,
}

impl AssistantEmitter {
    pub fn new(
        bus: RuntimeEventBus,
        owner_user_id: OwnerId,
        session_id: String,
        turn_id: String,
    ) -> Self {
        Self {
            bus,
            owner_user_id,
            session_id,
            turn_id,
        }
    }

    pub fn delta(&self, text: &str) {
        self.bus.emit(AssistantDeltaEvent {
            owner_user_id: self.owner_user_id.clone(),
            session_id: self.session_id.clone(),
            turn_id: self.turn_id.clone(),
            text: text.to_string(),
            replace: false,
        });
    }

    pub fn answer(&self, text: &str) {
        self.bus.emit(AssistantDeltaEvent {
            owner_user_id: self.owner_user_id.clone(),
            session_id: self.session_id.clone(),
            turn_id: self.turn_id.clone(),
            text: text.to_string(),
            replace: true,
        });
    }

    pub fn tool_call(&self, tool_call_id: &str, name: &str, args: &str) {
        self.bus.emit(AssistantToolCallEvent {
            owner_user_id: self.owner_user_id.clone(),
            session_id: self.session_id.clone(),
            turn_id: self.turn_id.clone(),
            tool_call_id: tool_call_id.to_string(),
            name: name.to_string(),
            args: args.to_string(),
        });
    }

    pub fn tool_result(
        &self,
        tool_call_id: &str,
        ok: bool,
        summary: &str,
        entities: &[Entity],
        charts: &[AssistantChart],
        screenshots: Option<&AssistantScreenshots>,
    ) {
        self.bus.emit(AssistantToolResultEvent {
            owner_user_id: self.owner_user_id.clone(),
            session_id: self.session_id.clone(),
            turn_id: self.turn_id.clone(),
            tool_call_id: tool_call_id.to_string(),
            ok,
            summary: summary.to_string(),
            entities: entities.to_vec(),
            charts: charts.to_vec(),
            screenshots: screenshots.cloned(),
        });
    }

    pub fn choice_request(
        &self,
        tool_call_id: &str,
        choice_id: &str,
        query: &str,
        candidates: Vec<AssistantChoiceCandidate>,
    ) {
        self.bus.emit(AssistantChoiceRequestEvent {
            owner_user_id: self.owner_user_id.clone(),
            session_id: self.session_id.clone(),
            turn_id: self.turn_id.clone(),
            tool_call_id: tool_call_id.to_string(),
            choice_id: choice_id.to_string(),
            query: query.trim().to_string(),
            candidates,
        });
    }

    pub fn turn_entities(&self, entities: &[Entity]) {
        self.bus.emit(AssistantTurnEntitiesEvent {
            owner_user_id: self.owner_user_id.clone(),
            session_id: self.session_id.clone(),
            turn_id: self.turn_id.clone(),
            entities: entities.to_vec(),
        });
    }

    pub fn done(&self) {
        self.bus.emit(AssistantDoneEvent {
            owner_user_id: self.owner_user_id.clone(),
            session_id: self.session_id.clone(),
            turn_id: self.turn_id.clone(),
        });
    }

    pub fn error(&self, code: &str, message: &str) {
        self.bus.emit(AssistantErrorEvent {
            owner_user_id: self.owner_user_id.clone(),
            session_id: self.session_id.clone(),
            turn_id: self.turn_id.clone(),
            code: code.to_string(),
            message: message.to_string(),
        });
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use serde_json::Value;
    use vrcx_0_application_core::{RuntimeEventBus, RuntimeEventSink};
    use vrcx_0_core::OwnerId;

    use super::AssistantEmitter;

    #[derive(Clone, Default)]
    struct CapturingSink(Arc<Mutex<Vec<(String, Value)>>>);

    impl RuntimeEventSink for CapturingSink {
        fn emit(&self, event: &str, payload: Value) {
            self.0.lock().unwrap().push((event.to_string(), payload));
        }
    }

    #[test]
    fn final_answer_event_replaces_streamed_draft() {
        let bus = RuntimeEventBus::new();
        let sink = CapturingSink::default();
        bus.set_sink(sink.clone());
        let emitter = AssistantEmitter::new(
            bus.clone(),
            OwnerId::new("usr_self"),
            "session-1".into(),
            "turn-1".into(),
        );

        emitter.delta("draft");
        emitter.answer("final");

        let events = sink.0.lock().unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(events[0].1["replace"], false);
        assert_eq!(events[0].1["ownerUserId"], "usr_self");
        assert_eq!(events[0].1["text"], "draft");
        assert_eq!(events[1].1["replace"], true);
        assert_eq!(events[1].1["text"], "final");
    }
}
