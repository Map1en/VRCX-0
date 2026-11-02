use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use specta::Type;
use tokio::sync::oneshot;
use vrcx_0_mcp::UserChoiceRequest;

#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AssistantChoiceCandidate {
    pub user_id: String,
    pub display_name: String,
    pub is_friend: bool,
    pub encounter_count: i64,
    pub last_seen: String,
}

pub(crate) fn choice_candidates(request: &UserChoiceRequest) -> Vec<AssistantChoiceCandidate> {
    request
        .candidates
        .iter()
        .map(|row| AssistantChoiceCandidate {
            user_id: row.user_id.clone(),
            display_name: row.display_name.clone(),
            is_friend: row.is_friend,
            encounter_count: row.encounter_count,
            last_seen: row.last_seen.clone(),
        })
        .collect()
}

type PendingChoice = (String, oneshot::Sender<Option<String>>);

#[derive(Clone, Default)]
pub(crate) struct PendingChoices(Arc<Mutex<HashMap<String, PendingChoice>>>);

impl PendingChoices {
    pub(crate) fn register(
        &self,
        choice_id: String,
        session_id: String,
    ) -> oneshot::Receiver<Option<String>> {
        let (sender, receiver) = oneshot::channel();
        self.0
            .lock()
            .unwrap()
            .insert(choice_id, (session_id, sender));
        receiver
    }

    pub(crate) fn remove(&self, choice_id: &str) {
        self.0.lock().unwrap().remove(choice_id);
    }

    pub(crate) fn answer(&self, session_id: &str, choice_id: &str, user_id: Option<String>) {
        let mut pending = self.0.lock().unwrap();
        if pending
            .get(choice_id)
            .is_some_and(|(owner_session, _)| owner_session == session_id)
        {
            if let Some((_, sender)) = pending.remove(choice_id) {
                let _ = sender.send(user_id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn answer_reaches_only_the_session_that_asked() {
        let choices = PendingChoices::default();
        let mut receiver = choices.register("choice_1".into(), "session_a".into());

        choices.answer("session_b", "choice_1", Some("usr_x".into()));
        assert!(receiver.try_recv().is_err());

        choices.answer("session_a", "choice_1", Some("usr_a".into()));
        assert_eq!(receiver.await.unwrap().as_deref(), Some("usr_a"));
    }
}
