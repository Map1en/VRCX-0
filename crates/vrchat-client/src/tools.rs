use std::collections::HashMap;

use serde_json::{json, Value};

use crate::http_api::{
    api_input, encode_path_segment, get_input, require_text, HttpApiError, HttpApiRequestInput,
};
use crate::query::serialize_query;

pub use vrcx_0_contracts::vrchat_requests::{
    CalendarListParams, GroupCalendarEventAccessType, GroupCalendarEventMutation,
    GroupCalendarRecurrence, GroupCalendarRecurrenceEnd, GroupCalendarRecurrenceFrequency,
    InviteMessageType, ModerationReportType,
};

pub fn calendars_get_input(endpoint: String, params: CalendarListParams) -> HttpApiRequestInput {
    get_input(endpoint, "calendar", serialize_query(&params))
}

pub fn group_calendar_get_input(
    endpoint: String,
    group_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatToolsGroupCalendarGet requires groupId.")?;
    Ok((
        group_id.clone(),
        get_input(
            endpoint,
            format!("calendar/{}", encode_path_segment(&group_id)),
            HashMap::new(),
        ),
    ))
}

pub fn following_calendars_get_input(
    endpoint: String,
    params: CalendarListParams,
) -> HttpApiRequestInput {
    get_input(endpoint, "calendar/following", serialize_query(&params))
}

pub fn featured_calendars_get_input(
    endpoint: String,
    params: CalendarListParams,
) -> HttpApiRequestInput {
    get_input(endpoint, "calendar/featured", serialize_query(&params))
}

pub fn group_event_follow_input(
    endpoint: String,
    group_id: String,
    event_id: String,
    is_following: bool,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatToolsGroupEventFollow requires groupId.")?;
    let event_id = require_text(event_id, "VrchatToolsGroupEventFollow requires eventId.")?;
    Ok((
        event_id.clone(),
        api_input(
            endpoint,
            "POST",
            format!(
                "calendar/{}/{}/follow",
                encode_path_segment(&group_id),
                encode_path_segment(&event_id)
            ),
            Some(json!({ "isFollowing": is_following })),
        ),
    ))
}

fn group_event_body(event: GroupCalendarEventMutation) -> Result<Value, HttpApiError> {
    let event = GroupCalendarEventMutation {
        title: require_text(event.title, "VrchatToolsGroupEvent requires title.")?,
        starts_at: require_text(event.starts_at, "VrchatToolsGroupEvent requires startsAt.")?,
        ends_at: require_text(event.ends_at, "VrchatToolsGroupEvent requires endsAt.")?,
        ..event
    };
    let is_series = event.recurrence.is_some();
    let mut body =
        serde_json::to_value(event).map_err(|error| HttpApiError::Custom(error.to_string()))?;
    if is_series {
        body["occurrenceKind"] = json!("series");
    }
    Ok(body)
}

pub fn group_event_create_input(
    endpoint: String,
    group_id: String,
    event: GroupCalendarEventMutation,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatToolsGroupEventCreate requires groupId.")?;
    let body = group_event_body(event)?;
    Ok((
        group_id.clone(),
        api_input(
            endpoint,
            "POST",
            format!("calendar/{}/event", encode_path_segment(&group_id)),
            Some(body),
        ),
    ))
}

pub fn group_event_update_input(
    endpoint: String,
    group_id: String,
    event_id: String,
    event: GroupCalendarEventMutation,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatToolsGroupEventUpdate requires groupId.")?;
    let event_id = require_text(event_id, "VrchatToolsGroupEventUpdate requires eventId.")?;
    let body = group_event_body(event)?;
    Ok((
        event_id.clone(),
        api_input(
            endpoint,
            "PUT",
            format!(
                "calendar/{}/{}/event",
                encode_path_segment(&group_id),
                encode_path_segment(&event_id)
            ),
            Some(body),
        ),
    ))
}

pub fn group_event_delete_input(
    endpoint: String,
    group_id: String,
    event_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatToolsGroupEventDelete requires groupId.")?;
    let event_id = require_text(event_id, "VrchatToolsGroupEventDelete requires eventId.")?;
    Ok((
        event_id.clone(),
        api_input(
            endpoint,
            "DELETE",
            format!(
                "calendar/{}/{}",
                encode_path_segment(&group_id),
                encode_path_segment(&event_id)
            ),
            None,
        ),
    ))
}

pub fn group_calendar_event_get_input(
    endpoint: String,
    group_id: String,
    event_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(
        group_id,
        "VrchatToolsGroupCalendarEventGet requires groupId.",
    )?;
    let event_id = require_text(
        event_id,
        "VrchatToolsGroupCalendarEventGet requires eventId.",
    )?;
    Ok((
        event_id.clone(),
        get_input(
            endpoint,
            format!(
                "calendar/{}/{}",
                encode_path_segment(&group_id),
                encode_path_segment(&event_id)
            ),
            HashMap::new(),
        ),
    ))
}

pub fn group_calendar_ics_get_input(
    endpoint: String,
    group_id: String,
    event_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let group_id = require_text(group_id, "VrchatToolsGroupCalendarIcsGet requires groupId.")?;
    let event_id = require_text(event_id, "VrchatToolsGroupCalendarIcsGet requires eventId.")?;
    Ok((
        event_id.clone(),
        get_input(
            endpoint,
            format!(
                "calendar/{}/{}.ics",
                encode_path_segment(&group_id),
                encode_path_segment(&event_id)
            ),
            HashMap::new(),
        ),
    ))
}

pub fn user_note_save_input(
    endpoint: String,
    target_user_id: String,
    note: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let target_user_id = require_text(
        target_user_id,
        "VrchatToolsUserNoteSave requires targetUserId.",
    )?;
    Ok((
        target_user_id.clone(),
        api_input(
            endpoint,
            "POST",
            "userNotes",
            Some(json!({ "targetUserId": target_user_id, "note": note })),
        ),
    ))
}

pub fn user_report_input(
    endpoint: String,
    user_id: String,
    category: String,
    reason: String,
    description: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let user_id = require_text(user_id, "VrchatToolsUserReport requires userId.")?;
    let category = require_text(category, "VrchatToolsUserReport requires category.")?;
    let reason = require_text(reason, "VrchatToolsUserReport requires reason.")?;
    let mut body = json!({
        "type": "user",
        "category": category,
        "reason": reason,
        "contentId": user_id,
    });
    let description = description.trim();
    if !description.is_empty() {
        body["description"] = json!(description);
    }
    Ok((
        user_id,
        api_input(endpoint, "POST", "moderationReports", Some(body)),
    ))
}

pub fn moderation_reports_get_input(
    endpoint: String,
    reporting_user_id: String,
    n: i32,
    offset: i32,
    closed_only: bool,
    report_type: Option<ModerationReportType>,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let reporting_user_id = require_text(
        reporting_user_id,
        "VrchatToolsModerationReportsGet requires currentUserId.",
    )?;
    let mut query_params = HashMap::from([
        ("reportingUserId".into(), json!(reporting_user_id)),
        ("n".into(), json!(n)),
        ("offset".into(), json!(offset)),
    ]);
    if closed_only {
        query_params.insert("status".into(), json!("closed"));
    }
    if let Some(report_type) = report_type {
        query_params.insert("type".into(), json!(report_type.as_str()));
    }
    Ok((
        reporting_user_id.clone(),
        get_input(endpoint, "moderationReports", query_params),
    ))
}

pub fn moderation_report_delete_input(
    endpoint: String,
    report_id: String,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let report_id = require_text(
        report_id,
        "VrchatToolsModerationReportDelete requires reportId.",
    )?;
    Ok((
        report_id.clone(),
        api_input(
            endpoint,
            "DELETE",
            format!("moderationReports/{}", encode_path_segment(&report_id)),
            None,
        ),
    ))
}

pub fn invite_messages_get_input(
    endpoint: String,
    current_user_id: String,
    message_type: InviteMessageType,
) -> Result<(String, HttpApiRequestInput), HttpApiError> {
    let current_user_id = require_text(
        current_user_id,
        "VrchatToolsInviteMessagesGet requires currentUserId.",
    )?;
    let message_type = message_type.as_str();
    Ok((
        current_user_id.clone(),
        get_input(
            endpoint,
            format!(
                "message/{}/{}",
                encode_path_segment(&current_user_id),
                encode_path_segment(message_type)
            ),
            HashMap::new(),
        ),
    ))
}

pub fn invite_message_edit_input(
    endpoint: String,
    current_user_id: String,
    message_type: InviteMessageType,
    slot: i32,
    message: String,
) -> Result<(i32, HttpApiRequestInput), HttpApiError> {
    let current_user_id = require_text(
        current_user_id,
        "VrchatToolsInviteMessageEdit requires currentUserId.",
    )?;
    let message_type = message_type.as_str();
    Ok((
        slot,
        api_input(
            endpoint,
            "PUT",
            format!(
                "message/{}/{}/{}",
                encode_path_segment(&current_user_id),
                encode_path_segment(message_type),
                slot
            ),
            Some(json!({ "message": message })),
        ),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json_body(request: &HttpApiRequestInput) -> &Value {
        request.body.as_json().expect("expected JSON request body")
    }

    #[test]
    fn calendar_reads_keep_query_params_and_encode_identity_segments() {
        let params = CalendarListParams {
            n: Some(100),
            offset: Some(200),
            date: None,
        };
        let expected_params =
            HashMap::from([("n".into(), json!(100)), ("offset".into(), json!(200))]);
        for (name, request, path) in [
            (
                "all",
                calendars_get_input("endpoint".into(), params.clone()),
                "calendar",
            ),
            (
                "following",
                following_calendars_get_input("endpoint".into(), params.clone()),
                "calendar/following",
            ),
            (
                "featured",
                featured_calendars_get_input("endpoint".into(), params.clone()),
                "calendar/featured",
            ),
        ] {
            assert_eq!(request.method.as_deref(), Some("GET"), "{name}");
            assert_eq!(request.path.as_deref(), Some(path), "{name}");
            assert_eq!(
                request.query_params,
                Some(expected_params.clone()),
                "{name}"
            );
        }

        let (group_id, group) =
            group_calendar_get_input("endpoint".into(), " grp/雪 ".into()).unwrap();
        assert_eq!(group_id, "grp/雪");
        assert_eq!(group.path.as_deref(), Some("calendar/grp%2F%E9%9B%AA"));

        let (event_id, ics) =
            group_calendar_ics_get_input("endpoint".into(), " grp/1 ".into(), " evt 雪 ".into())
                .unwrap();
        assert_eq!(event_id, "evt 雪");
        assert_eq!(
            ics.path.as_deref(),
            Some("calendar/grp%2F1/evt%20%E9%9B%AA.ics")
        );
    }

    #[test]
    fn tool_mutations_build_the_original_request_bodies() {
        let (event_id, follow) =
            group_event_follow_input("endpoint".into(), " grp/1 ".into(), " evt 雪 ".into(), true)
                .unwrap();
        assert_eq!(event_id, "evt 雪");
        assert_eq!(follow.method.as_deref(), Some("POST"));
        assert_eq!(
            follow.path.as_deref(),
            Some("calendar/grp%2F1/evt%20%E9%9B%AA/follow")
        );
        assert_eq!(json_body(&follow), &json!({ "isFollowing": true }));

        let (target_user_id, note) = user_note_save_input(
            "endpoint".into(),
            " usr/1 ".into(),
            "  keep note whitespace  ".into(),
        )
        .unwrap();
        assert_eq!(target_user_id, "usr/1");
        assert_eq!(note.method.as_deref(), Some("POST"));
        assert_eq!(note.path.as_deref(), Some("userNotes"));
        assert_eq!(
            json_body(&note),
            &json!({ "targetUserId": "usr/1", "note": "  keep note whitespace  " })
        );

        let (_, report) = user_report_input(
            "endpoint".into(),
            " usr/1 ".into(),
            "behavior".into(),
            "hacking".into(),
            "  ".into(),
        )
        .unwrap();
        assert_eq!(report.method.as_deref(), Some("POST"));
        assert_eq!(report.path.as_deref(), Some("moderationReports"));
        assert_eq!(
            json_body(&report),
            &json!({
                "type": "user",
                "category": "behavior",
                "reason": "hacking",
                "contentId": "usr/1",
            })
        );

        let (_, described) = user_report_input(
            "endpoint".into(),
            "usr_1".into(),
            "chat".into(),
            "harassing".into(),
            "  spam in chat  ".into(),
        )
        .unwrap();
        assert_eq!(json_body(&described)["description"], json!("spam in chat"));

        let (slot, edit) = invite_message_edit_input(
            "endpoint".into(),
            " usr/1 ".into(),
            InviteMessageType::Request,
            2,
            "Message".into(),
        )
        .unwrap();
        assert_eq!(slot, 2);
        assert_eq!(edit.method.as_deref(), Some("PUT"));
        assert_eq!(edit.path.as_deref(), Some("message/usr%2F1/request/2"));
        assert_eq!(json_body(&edit), &json!({ "message": "Message" }));
    }

    #[test]
    fn moderation_report_requests_scope_to_the_reporting_user() {
        let (user_id, list) = moderation_reports_get_input(
            "endpoint".into(),
            " usr_1 ".into(),
            100,
            200,
            false,
            None,
        )
        .unwrap();
        assert_eq!(user_id, "usr_1");
        assert_eq!(list.method.as_deref(), Some("GET"));
        assert_eq!(list.path.as_deref(), Some("moderationReports"));
        assert_eq!(
            list.query_params,
            Some(HashMap::from([
                ("reportingUserId".into(), json!("usr_1")),
                ("n".into(), json!(100)),
                ("offset".into(), json!(200)),
            ]))
        );

        let (_, closed) = moderation_reports_get_input(
            "endpoint".into(),
            "usr_1".into(),
            100,
            0,
            true,
            Some(ModerationReportType::World),
        )
        .unwrap();
        assert_eq!(
            closed.query_params,
            Some(HashMap::from([
                ("reportingUserId".into(), json!("usr_1")),
                ("n".into(), json!(100)),
                ("offset".into(), json!(0)),
                ("status".into(), json!("closed")),
                ("type".into(), json!("world")),
            ]))
        );

        let (report_id, delete) =
            moderation_report_delete_input("endpoint".into(), " mrpt/1 ".into()).unwrap();
        assert_eq!(report_id, "mrpt/1");
        assert_eq!(delete.method.as_deref(), Some("DELETE"));
        assert_eq!(delete.path.as_deref(), Some("moderationReports/mrpt%2F1"));
    }

    #[test]
    fn invite_message_read_trims_and_encodes_both_segments() {
        let (user_id, request) = invite_messages_get_input(
            "endpoint".into(),
            " usr/1 ".into(),
            InviteMessageType::RequestResponse,
        )
        .unwrap();

        assert_eq!(user_id, "usr/1");
        assert_eq!(request.method.as_deref(), Some("GET"));
        assert_eq!(
            request.path.as_deref(),
            Some("message/usr%2F1/requestResponse")
        );
    }

    fn sample_event() -> GroupCalendarEventMutation {
        GroupCalendarEventMutation {
            title: "Meetup".into(),
            description: "Hang out".into(),
            starts_at: "2026-10-22T10:00:00.000Z".into(),
            ends_at: "2026-10-22T12:00:00.000Z".into(),
            category: "hangout".into(),
            access_type: GroupCalendarEventAccessType::Group,
            tags: vec!["chill".into()],
            languages: vec!["eng".into()],
            platforms: Vec::new(),
            role_ids: Vec::new(),
            image_id: None,
            send_creation_notification: true,
            host_early_join_minutes: 60,
            guest_early_join_minutes: 5,
            close_instance_after_end_minutes: 5,
            recurrence: None,
        }
    }

    #[test]
    fn group_event_mutations_use_calendar_event_paths_and_bodies() {
        let (_, create) =
            group_event_create_input("endpoint".into(), "grp/1".into(), sample_event()).unwrap();
        assert_eq!(create.method.as_deref(), Some("POST"));
        assert_eq!(create.path.as_deref(), Some("calendar/grp%2F1/event"));
        let body = json_body(&create);
        assert_eq!(body["accessType"], json!("group"));
        assert_eq!(body["sendCreationNotification"], json!(true));
        assert_eq!(body["imageId"], Value::Null);
        assert!(body.get("occurrenceKind").is_none());

        let mut series = sample_event();
        series.recurrence = Some(GroupCalendarRecurrence {
            frequency: GroupCalendarRecurrenceFrequency::Weekly,
            interval: 1,
            timezone: "Asia/Tokyo".into(),
            days_of_week: vec!["SA".into()],
            end: Some(GroupCalendarRecurrenceEnd::AfterOccurrences { count: 4 }),
        });
        let (event_id, update) =
            group_event_update_input("endpoint".into(), "grp_1".into(), "gcal_1".into(), series)
                .unwrap();
        assert_eq!(event_id, "gcal_1");
        assert_eq!(update.method.as_deref(), Some("PUT"));
        assert_eq!(
            update.path.as_deref(),
            Some("calendar/grp%5F1/gcal%5F1/event")
        );
        let body = json_body(&update);
        assert_eq!(body["occurrenceKind"], json!("series"));
        assert_eq!(
            body["recurrence"],
            json!({
                "frequency": "weekly",
                "interval": 1,
                "timezone": "Asia/Tokyo",
                "daysOfWeek": ["SA"],
                "end": { "type": "afterOccurrences", "count": 4 },
            })
        );

        let (_, event) =
            group_calendar_event_get_input("endpoint".into(), "grp_1".into(), "gcal_1".into())
                .unwrap();
        assert_eq!(event.method.as_deref(), Some("GET"));
        assert_eq!(event.path.as_deref(), Some("calendar/grp%5F1/gcal%5F1"));

        let (_, delete) =
            group_event_delete_input("endpoint".into(), "grp_1".into(), "gcal_1".into()).unwrap();
        assert_eq!(delete.method.as_deref(), Some("DELETE"));
        assert_eq!(delete.path.as_deref(), Some("calendar/grp%5F1/gcal%5F1"));

        let mut untitled = sample_event();
        untitled.title = " ".into();
        assert!(group_event_create_input("endpoint".into(), "grp_1".into(), untitled).is_err());
    }

    #[test]
    fn group_events_send_their_title_and_times_trimmed() {
        let mut padded = sample_event();
        padded.title = " Meetup ".into();
        padded.starts_at = " 2026-10-22T10:00:00.000Z ".into();
        padded.ends_at = " 2026-10-22T12:00:00.000Z ".into();

        let (_, create) =
            group_event_create_input("endpoint".into(), "grp_1".into(), padded).unwrap();

        let body = json_body(&create);
        assert_eq!(body["title"], json!("Meetup"));
        assert_eq!(body["startsAt"], json!("2026-10-22T10:00:00.000Z"));
        assert_eq!(body["endsAt"], json!("2026-10-22T12:00:00.000Z"));
    }

    #[test]
    fn tool_requests_reject_blank_required_ids() {
        assert!(group_calendar_get_input("".into(), " ".into()).is_err());
        assert!(group_event_follow_input("".into(), "group".into(), " ".into(), false,).is_err());
        assert!(group_calendar_ics_get_input("".into(), " ".into(), "event".into()).is_err());
        assert!(user_note_save_input("".into(), " ".into(), "note".into()).is_err());
        assert!(user_report_input(
            "".into(),
            " ".into(),
            "behavior".into(),
            "hacking".into(),
            String::new(),
        )
        .is_err());
        assert!(user_report_input(
            "".into(),
            "usr_1".into(),
            "behavior".into(),
            " ".into(),
            String::new(),
        )
        .is_err());
        assert!(moderation_reports_get_input("".into(), " ".into(), 100, 0, false, None).is_err());
        assert!(moderation_report_delete_input("".into(), " ".into()).is_err());
        assert!(serde_json::from_str::<InviteMessageType>(r#""invite""#).is_err());
    }
}
