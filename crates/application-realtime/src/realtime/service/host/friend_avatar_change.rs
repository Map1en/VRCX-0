use std::sync::Arc;

use crate::realtime::avatar_change::resolve_avatar_feed_entry;
use crate::realtime::FriendIconChange;

use super::state::{ActiveRealtimeContext, RealtimeHostRuntime};

impl RealtimeHostRuntime {
    pub(super) fn schedule_friend_icon_changes(
        self: &Arc<Self>,
        generation: u64,
        changes: Vec<FriendIconChange>,
    ) {
        if changes.is_empty() {
            return;
        }
        let Some(active) = self
            .active_current_user_context()
            .filter(|active| active.generation == generation)
        else {
            return;
        };
        for change in changes {
            let runtime = Arc::clone(self);
            let active = active.clone();
            self.deps.tasks.spawn(async move {
                runtime.resolve_friend_icon_change(active, change).await;
            });
        }
    }

    async fn resolve_friend_icon_change(
        self: Arc<Self>,
        active: ActiveRealtimeContext,
        change: FriendIconChange,
    ) {
        let Some(entry) =
            resolve_avatar_feed_entry(&self.deps.file_cache, &active.session.endpoint, &change)
                .await
        else {
            return;
        };
        self.publish_friend_feed_entry_for(&active, entry);
    }
}
