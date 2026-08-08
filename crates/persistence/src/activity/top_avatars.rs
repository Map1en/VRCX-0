use chrono::{Duration, TimeZone, Utc};

use crate::common::{normalize_text, row_i64, row_string, ParamsBuilder};
use crate::database::schema::{ensure_global_store_tables, ensure_user_store_tables};
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::{DatabaseService, Error};

use super::types::{
    ActivityTopAvatarMetric, ActivityTopAvatarOutput, ActivityTopAvatarsQueryInput,
};

fn normalized_limit(limit: i64) -> i64 {
    if limit <= 0 {
        5
    } else {
        limit.min(50)
    }
}

fn cutoff_iso(range_days: i64, now_ms: i64) -> Option<String> {
    if range_days <= 0 {
        return None;
    }
    let now = Utc
        .timestamp_millis_opt(now_ms)
        .single()
        .unwrap_or_else(Utc::now);
    Some(
        (now - Duration::days(range_days.min(36_500)))
            .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    )
}

fn query_self_top_avatars(
    db: &DatabaseService,
    owner_user_id: &str,
    cutoff: Option<&str>,
    limit: i64,
) -> Result<Vec<ActivityTopAvatarOutput>, Error> {
    let user_prefix = normalize_user_table_prefix(owner_user_id)?;
    ensure_user_store_tables(db, &user_prefix)?;
    ensure_global_store_tables(db)?;
    let range_sql = cutoff
        .map(|_| "AND history.created_at >= @cutoff")
        .unwrap_or_default();
    let params = ParamsBuilder::new()
        .set("cutoff", cutoff.unwrap_or_default())
        .set("limit", limit)
        .build();
    Ok(db
        .execute(
            &format!(
                "SELECT history.avatar_id,
                        COALESCE(cache.name, ''),
                        COALESCE(cache.author_id, ''),
                        COALESCE(cache.image_url, ''),
                        COALESCE(cache.thumbnail_image_url, ''),
                        COALESCE(history.created_at, ''),
                        COALESCE(history.time, 0)
                   FROM {user_prefix}_avatar_history AS history
              LEFT JOIN cache_avatar AS cache ON cache.id = history.avatar_id
                  WHERE TRIM(COALESCE(history.avatar_id, '')) != '' {range_sql}
               ORDER BY COALESCE(history.time, 0) DESC,
                        history.created_at DESC,
                        history.avatar_id ASC
                  LIMIT @limit"
            ),
            &params,
        )?
        .into_iter()
        .map(|row| {
            let avatar_id = row_string(&row, 0);
            ActivityTopAvatarOutput {
                avatar_id: Some(avatar_id.clone()),
                avatar_key: avatar_id,
                avatar_name: row_string(&row, 1),
                author_id: row_string(&row, 2),
                image_url: row_string(&row, 3),
                thumbnail_image_url: row_string(&row, 4),
                last_used_at: row_string(&row, 5),
                use_count: 0,
                total_time: row_i64(&row, 6).max(0),
                metric: ActivityTopAvatarMetric::TotalTime,
                approximate: false,
            }
        })
        .collect())
}

fn query_friend_top_avatars(
    db: &DatabaseService,
    owner_user_id: &str,
    target_user_id: &str,
    cutoff: Option<&str>,
    limit: i64,
) -> Result<Vec<ActivityTopAvatarOutput>, Error> {
    let user_prefix = normalize_user_table_prefix(owner_user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let range_sql = cutoff
        .map(|_| "AND created_at >= @cutoff")
        .unwrap_or_default();
    let params = ParamsBuilder::new()
        .set("target_user_id", target_user_id)
        .set("cutoff", cutoff.unwrap_or_default())
        .set("limit", limit)
        .build();
    Ok(db
        .execute(
            &format!(
                "WITH actual_changes AS (
                     SELECT id,
                            created_at,
                            COALESCE(avatar_name, '') AS avatar_name,
                            COALESCE(owner_id, '') AS owner_id,
                            COALESCE(current_avatar_image_url, '') AS image_url,
                            COALESCE(current_avatar_thumbnail_image_url, '') AS thumbnail_image_url,
                            CASE
                                WHEN TRIM(COALESCE(current_avatar_image_url, '')) != ''
                                THEN TRIM(current_avatar_image_url)
                                ELSE TRIM(COALESCE(current_avatar_thumbnail_image_url, ''))
                            END AS avatar_key
                       FROM {user_prefix}_feed_avatar
                      WHERE user_id = @target_user_id
                        {range_sql}
                        AND (
                            COALESCE(current_avatar_image_url, '') != COALESCE(previous_current_avatar_image_url, '')
                            OR COALESCE(current_avatar_thumbnail_image_url, '') != COALESCE(previous_current_avatar_thumbnail_image_url, '')
                        )
                        AND (
                            TRIM(COALESCE(current_avatar_image_url, '')) != ''
                            OR TRIM(COALESCE(current_avatar_thumbnail_image_url, '')) != ''
                        )
                 ), ranked AS (
                     SELECT *,
                            COUNT(*) OVER (PARTITION BY avatar_key) AS use_count,
                            ROW_NUMBER() OVER (
                                PARTITION BY avatar_key
                                ORDER BY created_at DESC, id DESC
                            ) AS row_number
                       FROM actual_changes
                 )
                 SELECT avatar_key,
                        avatar_name,
                        owner_id,
                        image_url,
                        thumbnail_image_url,
                        created_at,
                        use_count
                   FROM ranked
                  WHERE row_number = 1
               ORDER BY use_count DESC, created_at DESC, avatar_key ASC
                  LIMIT @limit"
            ),
            &params,
        )?
        .into_iter()
        .map(|row| ActivityTopAvatarOutput {
            avatar_id: None,
            avatar_key: row_string(&row, 0),
            avatar_name: row_string(&row, 1),
            author_id: row_string(&row, 2),
            image_url: row_string(&row, 3),
            thumbnail_image_url: row_string(&row, 4),
            last_used_at: row_string(&row, 5),
            use_count: row_i64(&row, 6).max(0),
            total_time: 0,
            metric: ActivityTopAvatarMetric::ObservedChanges,
            approximate: true,
        })
        .collect())
}

pub fn activity_top_avatars_query(
    db: &DatabaseService,
    owner_user_id: &str,
    input: ActivityTopAvatarsQueryInput,
) -> Result<Vec<ActivityTopAvatarOutput>, Error> {
    let owner_user_id = normalize_text(owner_user_id);
    let target_user_id = normalize_text(input.target_user_id);
    if owner_user_id.is_empty() || target_user_id.is_empty() {
        return Err(Error::InvalidData(
            "Top avatar activity requires an owner and target user id.".into(),
        ));
    }
    let cutoff = cutoff_iso(input.range_days, input.now_ms);
    let limit = normalized_limit(input.limit);
    if owner_user_id == target_user_id {
        query_self_top_avatars(db, &owner_user_id, cutoff.as_deref(), limit)
    } else {
        query_friend_top_avatars(
            db,
            &owner_user_id,
            &target_user_id,
            cutoff.as_deref(),
            limit,
        )
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use serde_json::json;

    use super::*;
    use crate::avatars::avatar_cache_upsert;
    use crate::cache_entities::CacheEntityInput;

    struct TestDir(PathBuf);

    impl TestDir {
        fn new(name: &str) -> Self {
            let nonce = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "vrcx-0-top-avatars-{name}-{}-{nonce}",
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

    fn test_db(name: &str) -> (TestDir, DatabaseService) {
        let dir = TestDir::new(name);
        let db = DatabaseService::new(&dir.0.join("VRCX-0.sqlite3")).unwrap();
        (dir, db)
    }

    fn avatar(id: &str, name: &str) -> CacheEntityInput {
        CacheEntityInput {
            id: json!(id),
            author_id: json!("usr_author"),
            author_name: json!("Author"),
            created_at: json!("2026-01-01T00:00:00.000Z"),
            description: json!(""),
            image_url: json!(format!("https://avatar.test/{id}.png")),
            name: json!(name),
            release_status: json!("public"),
            thumbnail_image_url: json!(format!("https://avatar.test/{id}-thumb.png")),
            updated_at: json!("2026-01-01T00:00:00.000Z"),
            version: json!(1),
        }
    }

    fn input(target_user_id: &str, range_days: i64) -> ActivityTopAvatarsQueryInput {
        ActivityTopAvatarsQueryInput {
            target_user_id: target_user_id.into(),
            range_days,
            now_ms: 1_769_904_000_000,
            limit: 5,
        }
    }

    #[test]
    fn self_query_uses_owner_history_and_filters_by_last_used_date() -> Result<(), Error> {
        let (_dir, db) = test_db("self-owner-range");
        avatar_cache_upsert(&db, avatar("avtr_recent", "Recent"))?;
        avatar_cache_upsert(&db, avatar("avtr_old", "Old"))?;
        for (owner, avatar_id, created_at, time) in [
            (
                "usr_owner_a",
                "avtr_recent",
                "2026-01-25T00:00:00.000Z",
                100,
            ),
            ("usr_owner_a", "avtr_old", "2025-12-01T00:00:00.000Z", 999),
            ("usr_owner_b", "avtr_old", "2026-01-26T00:00:00.000Z", 5_000),
        ] {
            let prefix = normalize_user_table_prefix(owner)?;
            ensure_user_store_tables(&db, &prefix)?;
            db.execute_non_query(
                &format!("INSERT INTO {prefix}_avatar_history (avatar_id, created_at, time) VALUES (@avatar_id, @created_at, @time)"),
                &ParamsBuilder::new()
                    .set("avatar_id", avatar_id)
                    .set("created_at", created_at)
                    .set("time", time)
                    .build(),
            )?;
        }

        let rows = activity_top_avatars_query(&db, "usr_owner_a", input("usr_owner_a", 30))?;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].avatar_id.as_deref(), Some("avtr_recent"));
        assert_eq!(rows[0].total_time, 100);
        assert_eq!(rows[0].metric, ActivityTopAvatarMetric::TotalTime);
        assert!(!rows[0].approximate);
        Ok(())
    }

    #[test]
    fn self_query_preserves_history_when_avatar_cache_is_missing() -> Result<(), Error> {
        let (_dir, db) = test_db("self-missing-cache");
        let prefix = normalize_user_table_prefix("usr_owner")?;
        ensure_user_store_tables(&db, &prefix)?;
        db.execute_non_query(
            &format!("INSERT INTO {prefix}_avatar_history (avatar_id, created_at, time) VALUES ('avtr_missing', '2026-01-25T00:00:00.000Z', 42)"),
            &Default::default(),
        )?;

        let rows = activity_top_avatars_query(&db, "usr_owner", input("usr_owner", 30))?;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].avatar_key, "avtr_missing");
        assert!(rows[0].avatar_name.is_empty());
        assert_eq!(rows[0].total_time, 42);
        Ok(())
    }

    fn insert_friend_avatar(
        db: &DatabaseService,
        owner: &str,
        created_at: &str,
        target: &str,
        name: &str,
        current_image: &str,
        previous_image: &str,
    ) -> Result<(), Error> {
        let prefix = normalize_user_table_prefix(owner)?;
        ensure_realtime_tables(db, &prefix)?;
        db.execute_non_query(
            &format!("INSERT INTO {prefix}_feed_avatar (created_at, user_id, display_name, owner_id, avatar_name, current_avatar_image_url, current_avatar_thumbnail_image_url, previous_current_avatar_image_url, previous_current_avatar_thumbnail_image_url) VALUES (@created_at, @user_id, 'Friend', 'usr_author', @avatar_name, @current_image, '', @previous_image, '')"),
            &ParamsBuilder::new()
                .set("created_at", created_at)
                .set("user_id", target)
                .set("avatar_name", name)
                .set("current_image", current_image)
                .set("previous_image", previous_image)
                .build(),
        )?;
        Ok(())
    }

    #[test]
    fn friend_query_counts_only_observed_image_changes_in_the_owner_scope() -> Result<(), Error> {
        let (_dir, db) = test_db("friend-owner-changes");
        insert_friend_avatar(
            &db,
            "usr_owner_a",
            "2026-01-20T00:00:00.000Z",
            "usr_friend",
            "First",
            "https://avatar.test/a.png",
            "https://avatar.test/old.png",
        )?;
        insert_friend_avatar(
            &db,
            "usr_owner_a",
            "2026-01-21T00:00:00.000Z",
            "usr_friend",
            "Latest",
            "https://avatar.test/a.png",
            "https://avatar.test/b.png",
        )?;
        insert_friend_avatar(
            &db,
            "usr_owner_a",
            "2026-01-22T00:00:00.000Z",
            "usr_friend",
            "Tag only",
            "https://avatar.test/a.png",
            "https://avatar.test/a.png",
        )?;
        insert_friend_avatar(
            &db,
            "usr_owner_b",
            "2026-01-23T00:00:00.000Z",
            "usr_friend",
            "Other owner",
            "https://avatar.test/a.png",
            "https://avatar.test/c.png",
        )?;
        insert_friend_avatar(
            &db,
            "usr_owner_a",
            "2025-01-01T00:00:00.000Z",
            "usr_friend",
            "Too old",
            "https://avatar.test/a.png",
            "https://avatar.test/d.png",
        )?;

        let rows = activity_top_avatars_query(&db, "usr_owner_a", input("usr_friend", 30))?;
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].avatar_id, None);
        assert_eq!(rows[0].avatar_name, "Latest");
        assert_eq!(rows[0].use_count, 2);
        assert_eq!(rows[0].metric, ActivityTopAvatarMetric::ObservedChanges);
        assert!(rows[0].approximate);
        Ok(())
    }
}
