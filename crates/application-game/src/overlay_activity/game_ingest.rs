use serde_json::{json, Value};
use vrcx_0_application_activity::{
    OverlayActivityCandidate, OverlayActivityEntry, OverlayActivityRuntime,
};
use vrcx_0_core::location::world_id_from_location as world_id_from_location_or_id;

use crate::game_log::{GameLogIngestOutput, GameLogSideEffect};

pub trait OverlayActivityGameIngestExt {
    fn ingest_game_log_output(&self, output: &GameLogIngestOutput) -> Vec<OverlayActivityEntry>;
}

impl OverlayActivityGameIngestExt for OverlayActivityRuntime {
    fn ingest_game_log_output(&self, output: &GameLogIngestOutput) -> Vec<OverlayActivityEntry> {
        let mut entries = Vec::new();
        for entry in &output.batch.join_leave {
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
                payload: json!({
                    "location": entry.location,
                    "worldId": world_id_from_location_or_id(&entry.location),
                    "worldName": entry.world_name,
                    "time": entry.time,
                }),
            };
            if let Some(entry) = self.ingest_candidate(candidate) {
                entries.push(entry);
            }
        }
        for side_effect in &output.side_effects {
            let GameLogSideEffect::Video(input) = side_effect else {
                continue;
            };
            let payload = json!({
                "location": input.location,
                "videoUrl": input.video_url,
                "videoId": input.video_id,
                "videoName": input.video_name,
                "worldId": world_id_from_location_or_id(&input.location),
                "worldName": input.world_name,
                "thumbnailUrl": input.thumbnail_url,
            });
            let candidate = OverlayActivityCandidate {
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
                payload,
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
                payload,
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
                payload,
            };
            if let Some(entry) = self.ingest_candidate(candidate) {
                entries.push(entry);
            }
        }
        entries
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
