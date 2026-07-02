#![allow(non_snake_case)]

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use serde_json::{json, Value};

use crate::common::{
    add_list_params, normalize_text, now_iso, parse_json_value, strict_row_i64, strict_row_string,
    value_as_string, DbParams, ParamsBuilder,
};
use crate::database::DatabaseService;
use crate::realtime::{ensure_realtime_tables, normalize_user_table_prefix};
use crate::Error;

use super::schema::{NOTIFICATION_V1_COLUMNS, NOTIFICATION_V2_COLUMNS};
use super::types::*;

fn notification_select_sql(table: &str, columns: &[&str], where_sql: &str, limit: bool) -> String {
    let limit_sql = if limit { " LIMIT @limit" } else { "" };
    format!(
        "SELECT {} FROM {table}{where_sql} ORDER BY created_at DESC, id DESC{limit_sql}",
        columns.join(", ")
    )
}

fn notification_unseen_v2_select_sql(table: &str) -> String {
    notification_select_sql(
        table,
        NOTIFICATION_V2_COLUMNS,
        " WHERE seen = 0 AND (expires_at IS NULL OR expires_at = '' OR expires_at > @now)",
        false,
    )
}

fn notification_filter_params(
    filters: &[String],
    search: &str,
    search_columns: &[&str],
) -> (String, DbParams) {
    let mut params = HashMap::new();
    let mut clauses = Vec::new();
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    let type_placeholders = add_list_params(&mut params, &filters, "notification_type");
    if !type_placeholders.is_empty() {
        clauses.push(format!("type IN ({})", type_placeholders.join(", ")));
    }

    let search = normalize_text(search).to_lowercase();
    if !search.is_empty() {
        params.insert("@search_like".into(), Value::String(format!("%{search}%")));
        clauses.push(format!(
            "({})",
            search_columns
                .iter()
                .map(|column| format!("LOWER(COALESCE({column}, '')) LIKE @search_like"))
                .collect::<Vec<_>>()
                .join(" OR ")
        ));
    }

    if clauses.is_empty() {
        (String::new(), params)
    } else {
        (format!(" WHERE {}", clauses.join(" AND ")), params)
    }
}

fn notification_date_millis(value: &str) -> i64 {
    DateTime::parse_from_rfc3339(value)
        .map(|date| date.timestamp_millis())
        .unwrap_or(0)
}

fn notification_expires_at_expired(value: &str, now: DateTime<Utc>) -> bool {
    if value.trim().is_empty() {
        return false;
    }
    DateTime::parse_from_rfc3339(value)
        .map(|date| date <= now)
        .unwrap_or(false)
}

fn notification_value_text(value: &Value, key: &str) -> String {
    value
        .as_object()
        .and_then(|object| object.get(key))
        .map(value_as_string)
        .unwrap_or_default()
}

fn notification_matches_search(notification: &NotificationListItemOutput, search: &str) -> bool {
    let search = normalize_text(search).to_lowercase();
    if search.is_empty() {
        return true;
    }

    [
        notification.r#type.clone(),
        notification.sender_username.clone(),
        notification.sender_user_id.clone(),
        notification.title.clone(),
        notification.message.clone(),
        notification.link_text.clone(),
        notification.link.clone(),
        notification_value_text(&notification.details, "worldName"),
        notification_value_text(&notification.details, "worldId"),
        notification_value_text(&notification.details, "inviteMessage"),
        notification_value_text(&notification.details, "requestMessage"),
        notification_value_text(&notification.details, "responseMessage"),
        notification_value_text(&notification.data, "groupName"),
    ]
    .iter()
    .any(|value| value.to_lowercase().contains(&search))
}

fn notification_matches_filters(
    notification: &NotificationListItemOutput,
    filters: &[String],
) -> bool {
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    filters.is_empty() || filters.iter().any(|filter| filter == &notification.r#type)
}

fn notification_v1_list_item(row: NotificationV1RowOutput) -> NotificationListItemOutput {
    let details = json!({
        "worldId": row.world_id,
        "worldName": row.world_name,
        "imageUrl": row.image_url,
        "inviteMessage": row.invite_message,
        "requestMessage": row.request_message,
        "responseMessage": row.response_message,
    });
    NotificationListItemOutput {
        id: row.id,
        version: 1,
        created_at: row.created_at.clone(),
        created_at_legacy: row.created_at,
        updated_at: String::new(),
        expires_at: String::new(),
        r#type: row.r#type,
        link: String::new(),
        link_text: String::new(),
        message: row.message,
        title: String::new(),
        image_url: row.image_url,
        seen: false,
        sender_user_id: row.sender_user_id,
        sender_username: row.sender_username,
        receiver_user_id: row.receiver_user_id,
        data: json!({}),
        responses: json!([]),
        details,
        expired: row.expired == 1,
    }
}

fn notification_v2_list_item(
    row: NotificationV2RowOutput,
    now: DateTime<Utc>,
) -> NotificationListItemOutput {
    let expires_at = row.expires_at;
    let expired = notification_expires_at_expired(&expires_at, now);
    let data = parse_json_value(&Value::String(row.data), json!({}));
    let responses = parse_json_value(&Value::String(row.responses), json!([]));
    let details = parse_json_value(&Value::String(row.details), json!({}));
    NotificationListItemOutput {
        id: row.id,
        version: 2,
        created_at: row.created_at.clone(),
        created_at_legacy: row.created_at,
        updated_at: row.updated_at,
        expires_at,
        r#type: row.r#type,
        link: row.link,
        link_text: row.link_text,
        message: row.message,
        title: row.title,
        image_url: row.image_url,
        seen: row.seen == 1,
        sender_user_id: row.sender_user_id,
        sender_username: row.sender_username,
        receiver_user_id: String::new(),
        data: if data.is_object() { data } else { json!({}) },
        responses: if responses.is_array() {
            responses
        } else {
            json!([])
        },
        details: if details.is_object() {
            details
        } else {
            json!({})
        },
        expired,
    }
}

fn notification_push_dedup(
    deduped: &mut HashMap<String, NotificationListItemOutput>,
    notification: NotificationListItemOutput,
) {
    if notification.id.trim().is_empty() {
        return;
    }
    let should_replace = deduped
        .get(&notification.id)
        .map(|existing| notification.version >= existing.version)
        .unwrap_or(true);
    if should_replace {
        deduped.insert(notification.id.clone(), notification);
    }
}

pub fn notification_rows_query(
    db: &DatabaseService,
    query: NotificationRowsQueryInput,
) -> Result<NotificationRowsOutput, Error> {
    let user_id = normalize_text(query.user_id);
    if user_id.is_empty() {
        return Ok(NotificationRowsOutput {
            v1_rows: Vec::new(),
            v2_rows: Vec::new(),
            unseen_v2_rows: Vec::new(),
        });
    }

    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let limit = if query.per_table_limit > 0 {
        query.per_table_limit
    } else {
        500
    };
    let (where_sql, mut params) = build_type_filter(&query.filters);
    params.insert("@limit".into(), Value::from(limit));

    let v1_rows = db
        .execute(
            &notification_select_sql(
                &format!("{user_prefix}_notifications"),
                NOTIFICATION_V1_COLUMNS,
                &where_sql,
                true,
            ),
            &params,
        )?
        .into_iter()
        .map(|row| notification_v1_from_row(&row))
        .collect::<Result<Vec<_>, _>>()?;
    let v2_rows = db
        .execute(
            &notification_select_sql(
                &format!("{user_prefix}_notifications_v2"),
                NOTIFICATION_V2_COLUMNS,
                &where_sql,
                true,
            ),
            &params,
        )?
        .into_iter()
        .map(|row| notification_v2_from_row(&row))
        .collect::<Result<Vec<_>, _>>()?;
    let unseen_v2_rows = if query.include_unseen {
        db.execute(
            &notification_unseen_v2_select_sql(&format!("{user_prefix}_notifications_v2")),
            &ParamsBuilder::new().set("now", now_iso()).build(),
        )?
        .into_iter()
        .map(|row| notification_v2_from_row(&row))
        .collect::<Result<Vec<_>, _>>()?
    } else {
        Vec::new()
    };

    Ok(NotificationRowsOutput {
        v1_rows,
        v2_rows,
        unseen_v2_rows,
    })
}

fn query_notification_list(
    db: &DatabaseService,
    query: NotificationListQueryInput,
) -> Result<Vec<NotificationListItemOutput>, Error> {
    let user_id = normalize_text(query.user_id);
    if user_id.is_empty() {
        return Ok(Vec::new());
    }

    let user_prefix = normalize_user_table_prefix(&user_id)?;
    ensure_realtime_tables(db, &user_prefix)?;
    let per_table_limit = if query.per_table_limit > 0 {
        query.per_table_limit
    } else {
        500
    };
    let final_limit = if query.limit > 0 { query.limit } else { 500 };
    let search = normalize_text(query.search);
    let now = Utc::now();

    let v1_search_columns = [
        "type",
        "sender_username",
        "sender_user_id",
        "message",
        "world_id",
        "world_name",
        "invite_message",
        "request_message",
        "response_message",
    ];
    let v2_search_columns = [
        "type",
        "sender_username",
        "sender_user_id",
        "title",
        "message",
        "link_text",
        "link",
        "data",
        "details",
    ];
    let (v1_where_sql, mut v1_params) =
        notification_filter_params(&query.filters, &search, &v1_search_columns);
    let (v2_where_sql, mut v2_params) =
        notification_filter_params(&query.filters, &search, &v2_search_columns);
    v1_params.insert("@limit".into(), Value::from(per_table_limit));
    v2_params.insert("@limit".into(), Value::from(per_table_limit));

    let v1_rows = db
        .execute(
            &notification_select_sql(
                &format!("{user_prefix}_notifications"),
                NOTIFICATION_V1_COLUMNS,
                &v1_where_sql,
                true,
            ),
            &v1_params,
        )?
        .into_iter()
        .map(|row| notification_v1_from_row(&row))
        .collect::<Result<Vec<_>, _>>()?;
    let v2_rows = db
        .execute(
            &notification_select_sql(
                &format!("{user_prefix}_notifications_v2"),
                NOTIFICATION_V2_COLUMNS,
                &v2_where_sql,
                true,
            ),
            &v2_params,
        )?
        .into_iter()
        .map(|row| notification_v2_from_row(&row))
        .collect::<Result<Vec<_>, _>>()?;
    let unseen_v2_rows = if query.include_unseen {
        db.execute(
            &notification_unseen_v2_select_sql(&format!("{user_prefix}_notifications_v2")),
            &ParamsBuilder::new().set("now", now_iso()).build(),
        )?
        .into_iter()
        .map(|row| notification_v2_from_row(&row))
        .collect::<Result<Vec<_>, _>>()?
    } else {
        Vec::new()
    };

    let mut deduped = HashMap::new();
    for row in v1_rows {
        notification_push_dedup(&mut deduped, notification_v1_list_item(row));
    }
    for row in v2_rows {
        notification_push_dedup(&mut deduped, notification_v2_list_item(row, now));
    }
    for row in unseen_v2_rows {
        notification_push_dedup(&mut deduped, notification_v2_list_item(row, now));
    }

    let mut notifications = deduped
        .into_values()
        .filter(|notification| notification_matches_filters(notification, &query.filters))
        .filter(|notification| notification_matches_search(notification, &search))
        .collect::<Vec<_>>();
    notifications.sort_by(|left, right| {
        notification_date_millis(&right.created_at)
            .cmp(&notification_date_millis(&left.created_at))
            .then_with(|| right.id.cmp(&left.id))
    });
    notifications.truncate(final_limit as usize);
    Ok(notifications)
}

pub fn notification_list_query(
    db: &DatabaseService,
    query: NotificationListQueryInput,
) -> Result<Vec<NotificationListItemOutput>, Error> {
    query_notification_list(db, query)
}

fn notification_v1_from_row(row: &[Value]) -> Result<NotificationV1RowOutput, Error> {
    Ok(NotificationV1RowOutput {
        id: strict_row_string(row, 0)?,
        created_at: strict_row_string(row, 1)?,
        r#type: strict_row_string(row, 2)?,
        sender_user_id: strict_row_string(row, 3)?,
        sender_username: strict_row_string(row, 4)?,
        receiver_user_id: strict_row_string(row, 5)?,
        message: strict_row_string(row, 6)?,
        world_id: strict_row_string(row, 7)?,
        world_name: strict_row_string(row, 8)?,
        image_url: strict_row_string(row, 9)?,
        invite_message: strict_row_string(row, 10)?,
        request_message: strict_row_string(row, 11)?,
        response_message: strict_row_string(row, 12)?,
        expired: strict_row_i64(row, 13)?,
    })
}
fn notification_v2_from_row(row: &[Value]) -> Result<NotificationV2RowOutput, Error> {
    Ok(NotificationV2RowOutput {
        id: strict_row_string(row, 0)?,
        created_at: strict_row_string(row, 1)?,
        updated_at: strict_row_string(row, 2)?,
        expires_at: strict_row_string(row, 3)?,
        r#type: strict_row_string(row, 4)?,
        link: strict_row_string(row, 5)?,
        link_text: strict_row_string(row, 6)?,
        message: strict_row_string(row, 7)?,
        title: strict_row_string(row, 8)?,
        image_url: strict_row_string(row, 9)?,
        seen: strict_row_i64(row, 10)?,
        sender_user_id: strict_row_string(row, 11)?,
        sender_username: strict_row_string(row, 12)?,
        data: strict_row_string(row, 13)?,
        responses: strict_row_string(row, 14)?,
        details: strict_row_string(row, 15)?,
    })
}
fn build_type_filter(filters: &[String]) -> (String, DbParams) {
    let mut params = HashMap::new();
    let filters = filters
        .iter()
        .map(normalize_text)
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if filters.is_empty() {
        return (String::new(), params);
    }
    let mut placeholders = Vec::with_capacity(filters.len());
    for (index, filter) in filters.into_iter().enumerate() {
        let key = format!("@type_{index}");
        params.insert(key.clone(), Value::String(filter));
        placeholders.push(key);
    }
    (
        format!(" WHERE type IN ({})", placeholders.join(", ")),
        params,
    )
}

#[cfg(test)]
mod tests {
    use chrono::{TimeZone, Utc};
    use serde_json::json;

    use super::*;

    fn v1_row() -> NotificationV1RowOutput {
        NotificationV1RowOutput {
            id: "notif_v1".into(),
            created_at: "2026-06-22T10:30:00Z".into(),
            r#type: "friendRequest".into(),
            sender_user_id: "usr_sender".into(),
            sender_username: "Sender Name".into(),
            receiver_user_id: "usr_receiver".into(),
            message: "Let's be friends".into(),
            world_id: "wrld_invite".into(),
            world_name: "Invite World".into(),
            image_url: "https://images.example/world.png".into(),
            invite_message: "Join here".into(),
            request_message: "Can I join?".into(),
            response_message: "Accepted".into(),
            expired: 1,
        }
    }

    fn v2_row() -> NotificationV2RowOutput {
        NotificationV2RowOutput {
            id: "notif_v2".into(),
            created_at: "2026-06-22T11:00:00Z".into(),
            updated_at: "2026-06-22T11:01:00Z".into(),
            expires_at: "2026-06-23T11:00:00Z".into(),
            r#type: "invite".into(),
            link: "https://vrchat.com/home/world/wrld_2".into(),
            link_text: "Open World".into(),
            message: "Meet at the portal".into(),
            title: "World Invite".into(),
            image_url: "https://images.example/invite.png".into(),
            seen: 1,
            sender_user_id: "usr_sender_v2".into(),
            sender_username: "Sender Two".into(),
            data: r#"{"groupName":"Group Alpha"}"#.into(),
            responses: r#"[{"responseType":"accept"}]"#.into(),
            details: r#"{"worldId":"wrld_2","worldName":"Second World"}"#.into(),
        }
    }

    #[test]
    fn builds_notification_select_sql_with_ordering_and_optional_limit() {
        assert_eq!(
            notification_select_sql(
                "usr_notifications",
                &["id", "created_at", "type"],
                " WHERE type IN (@type_0)",
                true,
            ),
            "SELECT id, created_at, type FROM usr_notifications WHERE type IN (@type_0) ORDER BY created_at DESC, id DESC LIMIT @limit"
        );
        assert_eq!(
            notification_select_sql("usr_notifications_v2", &["id"], "", false),
            "SELECT id FROM usr_notifications_v2 ORDER BY created_at DESC, id DESC"
        );
    }

    #[test]
    fn parses_notification_dates_and_expiration_boundaries() {
        let now = Utc.with_ymd_and_hms(2026, 6, 22, 10, 30, 0).unwrap();

        assert_eq!(
            notification_date_millis("2026-06-22T10:30:00Z"),
            1_782_124_200_000
        );
        assert_eq!(notification_date_millis("not-a-date"), 0);
        assert!(notification_expires_at_expired("2026-06-22T10:30:00Z", now));
        assert!(!notification_expires_at_expired(
            "2026-06-22T10:30:01Z",
            now
        ));
        assert!(!notification_expires_at_expired("", now));
        assert!(!notification_expires_at_expired("not-a-date", now));
    }

    #[test]
    fn maps_v1_rows_to_legacy_notification_list_items() {
        let item = notification_v1_list_item(v1_row());

        assert_eq!(item.id, "notif_v1");
        assert_eq!(item.version, 1);
        assert_eq!(item.created_at, "2026-06-22T10:30:00Z");
        assert_eq!(item.created_at_legacy, "2026-06-22T10:30:00Z");
        assert_eq!(item.r#type, "friendRequest");
        assert_eq!(item.message, "Let's be friends");
        assert!(!item.seen);
        assert_eq!(item.sender_user_id, "usr_sender");
        assert_eq!(item.sender_username, "Sender Name");
        assert_eq!(item.receiver_user_id, "usr_receiver");
        assert!(item.data.as_object().unwrap().is_empty());
        assert_eq!(item.responses, json!([]));
        assert_eq!(item.details["worldId"], "wrld_invite");
        assert_eq!(item.details["worldName"], "Invite World");
        assert_eq!(item.details["inviteMessage"], "Join here");
        assert!(item.expired);
    }

    #[test]
    fn maps_v2_rows_to_notification_list_items_and_sanitizes_json_shapes() {
        let now = Utc.with_ymd_and_hms(2026, 6, 22, 12, 0, 0).unwrap();
        let item = notification_v2_list_item(v2_row(), now);

        assert_eq!(item.id, "notif_v2");
        assert_eq!(item.version, 2);
        assert_eq!(item.updated_at, "2026-06-22T11:01:00Z");
        assert_eq!(item.expires_at, "2026-06-23T11:00:00Z");
        assert_eq!(item.r#type, "invite");
        assert_eq!(item.link_text, "Open World");
        assert!(item.seen);
        assert!(item.receiver_user_id.is_empty());
        assert_eq!(item.data["groupName"], "Group Alpha");
        assert_eq!(item.responses[0]["responseType"], "accept");
        assert_eq!(item.details["worldName"], "Second World");
        assert!(!item.expired);

        let dirty_item = notification_v2_list_item(
            NotificationV2RowOutput {
                data: "[]".into(),
                responses: "{}".into(),
                details: "not-json".into(),
                expires_at: "2026-06-22T10:00:00Z".into(),
                ..v2_row()
            },
            now,
        );

        assert!(dirty_item.data.as_object().unwrap().is_empty());
        assert_eq!(dirty_item.responses, json!([]));
        assert!(dirty_item.details.as_object().unwrap().is_empty());
        assert!(dirty_item.expired);
    }

    #[test]
    fn matches_notification_search_and_filters_across_projected_fields() {
        let item = notification_v2_list_item(v2_row(), Utc::now());

        assert!(notification_matches_search(&item, ""));
        assert!(notification_matches_search(&item, "sender two"));
        assert!(notification_matches_search(&item, "wrld_2"));
        assert!(notification_matches_search(&item, "second world"));
        assert!(notification_matches_search(&item, "group alpha"));
        assert!(!notification_matches_search(&item, "missing text"));

        assert!(notification_matches_filters(&item, &[]));
        assert!(notification_matches_filters(
            &item,
            &["".into(), "invite".into()]
        ));
        assert!(!notification_matches_filters(
            &item,
            &["friendRequest".into()]
        ));
    }

    #[test]
    fn extracts_text_from_json_values_for_known_keys() {
        let value = json!({
            "worldName": "World",
            "count": 7,
            "enabled": true,
            "missing": null
        });

        assert_eq!(notification_value_text(&value, "worldName"), "World");
        assert_eq!(notification_value_text(&value, "count"), "7");
        assert_eq!(notification_value_text(&value, "enabled"), "true");
        assert_eq!(notification_value_text(&value, "missing"), "");
        assert_eq!(
            notification_value_text(&json!("not-object"), "worldName"),
            ""
        );
    }
}
