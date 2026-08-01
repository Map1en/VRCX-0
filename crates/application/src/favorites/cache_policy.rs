use serde::{Deserialize, Serialize};
use serde_json::Value;
use vrcx_0_core::json::RawJson;
use vrcx_0_persistence::{
    avatars::{avatar_cache_get, avatar_cache_upsert},
    cache_entities::CacheEntityInput,
    worlds::{world_cache_get, world_cache_upsert},
    DatabaseService,
};
use vrcx_0_vrchat_client::http_api::normalize_text;

use crate::Result;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub enum FavoriteCacheKind {
    Avatar,
    World,
}

#[derive(Clone, Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteCacheSnapshotInput {
    pub kind: FavoriteCacheKind,
    pub entity: RawJson,
    #[serde(default)]
    pub fallback_entity_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CacheWriteDecision {
    Upsert,
    InsertIfMissing,
    Skip,
}

pub fn persist_favorite_cache_snapshot(
    db: &DatabaseService,
    input: FavoriteCacheSnapshotInput,
) -> Result<bool> {
    let entity = input.entity.as_value();
    let decision = cache_write_decision(input.kind, entity);
    if decision == CacheWriteDecision::Skip {
        return Ok(false);
    }
    let entry = cache_entry_from_entity(entity, &input.fallback_entity_id);
    let id = entry.id.as_str().unwrap_or_default().trim().to_string();
    if id.is_empty() {
        return Ok(false);
    }
    if decision == CacheWriteDecision::InsertIfMissing {
        let exists = match input.kind {
            FavoriteCacheKind::Avatar => avatar_cache_get(db, id)?.is_some(),
            FavoriteCacheKind::World => world_cache_get(db, id)?.is_some(),
        };
        if exists {
            return Ok(false);
        }
    }
    match input.kind {
        FavoriteCacheKind::Avatar => avatar_cache_upsert(db, entry)?,
        FavoriteCacheKind::World => world_cache_upsert(db, entry)?,
    };
    Ok(true)
}

pub(super) fn cache_write_decision(kind: FavoriteCacheKind, entity: &Value) -> CacheWriteDecision {
    if !has_complete_snapshot(entity) {
        return CacheWriteDecision::Skip;
    }
    match (kind, release_status(entity).as_str()) {
        (_, "public") => CacheWriteDecision::Upsert,
        (FavoriteCacheKind::Avatar, _) | (FavoriteCacheKind::World, "private") => {
            CacheWriteDecision::InsertIfMissing
        }
        (FavoriteCacheKind::World, _) => CacheWriteDecision::Skip,
    }
}

pub(super) fn release_status(entity: &Value) -> String {
    field_text(entity, &["releaseStatus"]).trim().to_lowercase()
}

pub(super) fn entity_id(entity: &Value) -> String {
    entity_field_id(entity, "id")
}

pub(super) fn cache_entry_from_entity(entity: &Value, fallback_id: &str) -> CacheEntityInput {
    let id = entity_id(entity);
    let id = if id.is_empty() {
        normalize_text(fallback_id)
    } else {
        id
    };
    CacheEntityInput {
        id: Value::String(id),
        author_id: Value::String(entity_field_id(entity, "authorId")),
        author_name: Value::String(field_text(entity, &["authorName"])),
        created_at: Value::String(field_text(entity, &["created_at", "createdAt"])),
        description: Value::String(field_text(entity, &["description"])),
        image_url: Value::String(field_text(entity, &["imageUrl"])),
        name: Value::String(field_text(entity, &["name"])),
        release_status: Value::String(field_text(entity, &["releaseStatus"])),
        thumbnail_image_url: Value::String(field_text(entity, &["thumbnailImageUrl"])),
        updated_at: Value::String(field_text(entity, &["updated_at", "updatedAt"])),
        version: Value::Number(entity_version(entity).into()),
    }
}

fn has_complete_snapshot(entity: &Value) -> bool {
    let name = field_text(entity, &["name"]);
    let thumbnail = field_text(entity, &["thumbnailImageUrl"]);
    let image_url = if thumbnail.trim().is_empty() {
        field_text(entity, &["imageUrl"])
    } else {
        thumbnail
    };
    !name.trim().is_empty() && !image_url.trim().is_empty()
}

fn entity_field_id(entity: &Value, key: &str) -> String {
    normalize_text(field_text(entity, &[key]))
}

fn field_text(entity: &Value, keys: &[&str]) -> String {
    for key in keys {
        match entity.get(*key) {
            Some(Value::String(text)) => return text.clone(),
            Some(Value::Null) | None => continue,
            Some(other) => return other.to_string(),
        }
    }
    String::new()
}

fn entity_version(entity: &Value) -> i64 {
    match entity.get("version") {
        Some(Value::Number(number)) => number.as_i64().unwrap_or(0),
        Some(Value::String(text)) => text.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;
    use vrcx_0_persistence::worlds::world_cache_get;

    use super::*;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-favorite-cache-{name}-{}-{nonce}",
                std::process::id()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn world_policy_upserts_public_and_preserves_existing_private_details() {
        let public = json!({
            "name": "Public",
            "releaseStatus": "public",
            "imageUrl": "https://example.test/public.png"
        });
        let private = json!({
            "name": "Private",
            "releaseStatus": "private",
            "imageUrl": "https://example.test/private.png"
        });

        assert_eq!(
            cache_write_decision(FavoriteCacheKind::World, &public),
            CacheWriteDecision::Upsert
        );
        assert_eq!(
            cache_write_decision(FavoriteCacheKind::World, &private),
            CacheWriteDecision::InsertIfMissing
        );
    }

    #[test]
    fn avatar_policy_preserves_any_complete_non_public_snapshot() {
        let unavailable = json!({
            "name": "Unavailable",
            "releaseStatus": "unavailable",
            "thumbnailImageUrl": "https://example.test/avatar.png"
        });

        assert_eq!(
            cache_write_decision(FavoriteCacheKind::Avatar, &unavailable),
            CacheWriteDecision::InsertIfMissing
        );
    }

    #[test]
    fn policy_rejects_incomplete_snapshots_and_unknown_world_statuses() {
        let incomplete = json!({"name": "No image", "releaseStatus": "public"});
        let unknown = json!({
            "name": "Unknown",
            "releaseStatus": "unavailable",
            "imageUrl": "https://example.test/world.png"
        });

        assert_eq!(
            cache_write_decision(FavoriteCacheKind::Avatar, &incomplete),
            CacheWriteDecision::Skip
        );
        assert_eq!(
            cache_write_decision(FavoriteCacheKind::World, &unknown),
            CacheWriteDecision::Skip
        );
    }

    #[test]
    fn private_world_snapshot_does_not_overwrite_existing_public_cache() {
        let dir = TestDir::new("private-world-preserves-public");
        let db = DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap();
        let public = json!({
            "id": "wrld_test",
            "name": "Public name",
            "releaseStatus": "public",
            "imageUrl": "https://example.test/public.png"
        });
        let private = json!({
            "id": "wrld_test",
            "name": "Private name",
            "releaseStatus": "private",
            "imageUrl": "https://example.test/private.png"
        });

        assert!(persist_favorite_cache_snapshot(
            &db,
            FavoriteCacheSnapshotInput {
                kind: FavoriteCacheKind::World,
                entity: RawJson::from(public),
                fallback_entity_id: String::new(),
            },
        )
        .unwrap());
        assert!(!persist_favorite_cache_snapshot(
            &db,
            FavoriteCacheSnapshotInput {
                kind: FavoriteCacheKind::World,
                entity: RawJson::from(private),
                fallback_entity_id: String::new(),
            },
        )
        .unwrap());

        let cached = world_cache_get(&db, "wrld_test".into()).unwrap().unwrap();
        assert_eq!(cached.name, "Public name");
        assert_eq!(cached.release_status, "public");
        assert_eq!(cached.image_url, "https://example.test/public.png");
    }
}
