use serde::Serialize;
use specta::Type;
use vrcx_0_mcp::UserChoiceRequest;

use crate::pending::PendingReplies;

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

pub(crate) type PendingChoices = PendingReplies<Option<String>>;
