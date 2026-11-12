use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use tokio::sync::oneshot;

type PendingReply<T> = (String, oneshot::Sender<T>);

/// Replies a running turn is waiting on from the UI, keyed by request id and
/// bound to the session that asked.
pub(crate) struct PendingReplies<T>(Arc<Mutex<HashMap<String, PendingReply<T>>>>);

impl<T> Clone for PendingReplies<T> {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}

impl<T> Default for PendingReplies<T> {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(HashMap::new())))
    }
}

impl<T> PendingReplies<T> {
    pub(crate) fn register(&self, request_id: String, session_id: String) -> oneshot::Receiver<T> {
        let (sender, receiver) = oneshot::channel();
        self.0
            .lock()
            .unwrap()
            .insert(request_id, (session_id, sender));
        receiver
    }

    pub(crate) fn remove(&self, request_id: &str) {
        self.0.lock().unwrap().remove(request_id);
    }

    pub(crate) fn answer(&self, session_id: &str, request_id: &str, reply: T) {
        let mut pending = self.0.lock().unwrap();
        if pending
            .get(request_id)
            .is_some_and(|(owner_session, _)| owner_session == session_id)
        {
            if let Some((_, sender)) = pending.remove(request_id) {
                let _ = sender.send(reply);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn answer_reaches_only_the_session_that_asked() {
        let replies = PendingReplies::<Option<String>>::default();
        let mut receiver = replies.register("choice_1".into(), "session_a".into());

        replies.answer("session_b", "choice_1", Some("usr_x".into()));
        assert!(receiver.try_recv().is_err());

        replies.answer("session_a", "choice_1", Some("usr_a".into()));
        assert_eq!(receiver.await.unwrap().as_deref(), Some("usr_a"));
    }

    #[tokio::test]
    async fn a_removed_request_drops_its_waiter() {
        let replies = PendingReplies::<bool>::default();
        let receiver = replies.register("approval_1".into(), "session_a".into());

        replies.remove("approval_1");
        replies.answer("session_a", "approval_1", true);

        assert!(receiver.await.is_err());
    }
}
