use serde_json::{json, Value};
use vrcx_0_application_activity::{
    OverlayActivityCandidate, OverlayActivityEntry, OverlayActivityFavoriteSubject,
    OverlayActivityRuntime,
};
use vrcx_0_contracts::game_log::GameLogJoinLeaveEntry;
use vrcx_0_core::location::world_id_from_location as world_id_from_location_or_id;

use crate::game_log::video::VideoInput;
use crate::game_log::GameLogIngestOutput;

pub trait OverlayActivityGameIngestExt {
    fn ingest_game_log_output(&self, output: &GameLogIngestOutput) -> Vec<OverlayActivityEntry>;

    fn ingest_game_log_output_with_join_leave_filter<F>(
        &self,
        output: &GameLogIngestOutput,
        include_join_leave: F,
    ) -> Vec<OverlayActivityEntry>
    where
        F: FnMut(&GameLogJoinLeaveEntry) -> bool;
}

impl OverlayActivityGameIngestExt for OverlayActivityRuntime {
    fn ingest_game_log_output(&self, output: &GameLogIngestOutput) -> Vec<OverlayActivityEntry> {
        self.ingest_game_log_output_with_join_leave_filter(output, |_| true)
    }

    fn ingest_game_log_output_with_join_leave_filter<F>(
        &self,
        output: &GameLogIngestOutput,
        mut include_join_leave: F,
    ) -> Vec<OverlayActivityEntry>
    where
        F: FnMut(&GameLogJoinLeaveEntry) -> bool,
    {
        let mut entries = Vec::new();
        for entry in output
            .batch
            .join_leave
            .iter()
            .filter(|entry| include_join_leave(entry))
        {
            let candidate = OverlayActivityCandidate {
                source_id: format!(
                    "game-log:{}:{}:{}:{}",
                    entry.event_type, entry.user_id, entry.location, entry.created_at
                ),
                activity_type: entry.event_type.clone(),
                created_at: entry.created_at.clone(),
                actor_user_id: entry.user_id.clone(),
                actor_display_name: entry.display_name.clone(),
                current_instance: true,
                favorite_subject: OverlayActivityFavoriteSubject::UserId(entry.user_id.clone()),
                payload: json!({
                    "location": entry.location,
                    "worldId": world_id_from_location_or_id(&entry.location),
                    "worldName": entry.world_name,
                    "time": entry.time,
                })
                .into(),
            };
            if let Some(entry) = self.ingest_candidate(candidate) {
                entries.push(entry);
            }
        }
        for entry in &output.batch.events {
            let payload = json!({
                "data": entry.data,
            });
            let candidate = OverlayActivityCandidate {
                source_id: format!(
                    "game-log-event:{}:{}",
                    entry.created_at,
                    stable_json_hash(&payload)
                ),
                activity_type: "Event".to_string(),
                created_at: entry.created_at.clone(),
                actor_user_id: String::new(),
                actor_display_name: "Event".to_string(),
                current_instance: false,
                favorite_subject: OverlayActivityFavoriteSubject::None,
                payload: payload.into(),
            };
            if let Some(entry) = self.ingest_candidate(candidate) {
                entries.push(entry);
            }
        }
        for entry in &output.batch.externals {
            let payload = json!({
                "message": entry.message,
                "location": entry.location,
            });
            let candidate = OverlayActivityCandidate {
                source_id: format!(
                    "game-log-external:{}:{}:{}:{}",
                    entry.user_id,
                    entry.location,
                    entry.created_at,
                    stable_json_hash(&payload)
                ),
                activity_type: "External".to_string(),
                created_at: entry.created_at.clone(),
                actor_user_id: entry.user_id.clone(),
                actor_display_name: entry.display_name.clone(),
                current_instance: false,
                favorite_subject: OverlayActivityFavoriteSubject::UserId(entry.user_id.clone()),
                payload: payload.into(),
            };
            if let Some(entry) = self.ingest_candidate(candidate) {
                entries.push(entry);
            }
        }
        entries
    }
}

pub(crate) fn video_activity_candidate(input: &VideoInput) -> OverlayActivityCandidate {
    let payload = json!({
        "location": input.location,
        "videoUrl": input.video_url,
        "videoId": input.video_id,
        "videoName": input.video_name,
        "worldId": world_id_from_location_or_id(&input.location),
        "worldName": input.world_name,
        "thumbnailUrl": input.thumbnail_url,
    });
    OverlayActivityCandidate {
        source_id: format!(
            "video-play:{}:{}:{}:{}",
            input.location,
            input.display_name,
            input.created_at,
            stable_json_hash(&payload)
        ),
        activity_type: "VideoPlay".to_string(),
        created_at: input.created_at.clone(),
        actor_user_id: input.user_id.clone(),
        actor_display_name: input.display_name.clone(),
        current_instance: true,
        favorite_subject: OverlayActivityFavoriteSubject::UserId(input.user_id.clone()),
        payload: payload.into(),
    }
}

fn stable_json_hash(value: &Value) -> String {
    let payload = serde_json::to_string(value).unwrap_or_else(|_| value.to_string());
    let mut hash = 0xcbf29ce484222325u64;
    for byte in payload.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}
