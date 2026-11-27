use vrcx_0_application_core::Result;
use vrcx_0_contracts::vrchat_api::{VrchatResponse, VrchatScope};
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_vrchat_protocol::tools::{
    discover_calendars_get_input, following_calendars_get_input, group_calendar_event_get_input,
    group_calendar_get_input, group_calendar_ics_get_input, group_event_create_input,
    group_event_delete_input, group_event_follow_input, group_event_update_input,
    invite_message_edit_input, invite_messages_get_input, moderation_reports_get_input,
    user_note_save_input, user_report_input, CalendarDiscoverParams, CalendarListParams,
    GroupCalendarEventMutation, InviteMessageType, ModerationReportType,
};

use super::VrchatRemoteFacade;

impl VrchatRemoteFacade {
    pub async fn group_calendar(&self, group_id: String) -> Result<VrchatResponse> {
        let (group_id, request) =
            group_calendar_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), group_id)?;
        self.execute(
            "app__vrchat_tools_group_calendar_get",
            format!("Getting group calendar {group_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn following_calendars(&self, params: CalendarListParams) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_tools_following_calendars_get",
            "Getting followed group calendars.",
            following_calendars_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn discover_calendars(
        &self,
        params: CalendarDiscoverParams,
    ) -> Result<VrchatResponse> {
        self.execute(
            "app__vrchat_tools_calendar_discover_get",
            "Discovering calendar events.",
            discover_calendars_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn follow_group_event(
        &self,
        group_id: String,
        event_id: String,
        is_following: bool,
    ) -> Result<VrchatResponse> {
        let (event_id, request) = group_event_follow_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            group_id,
            event_id,
            is_following,
        )?;
        self.execute(
            "app__vrchat_tools_group_event_follow",
            format!("Updating follow state for event {event_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn create_group_event(
        &self,
        group_id: String,
        event: GroupCalendarEventMutation,
    ) -> Result<VrchatResponse> {
        let (group_id, request) =
            group_event_create_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), group_id, event)?;
        self.execute(
            "app__vrchat_tools_group_event_create",
            format!("Creating an event for group {group_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn update_group_event(
        &self,
        group_id: String,
        event_id: String,
        event: GroupCalendarEventMutation,
    ) -> Result<VrchatResponse> {
        let (event_id, request) = group_event_update_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            group_id,
            event_id,
            event,
        )?;
        self.execute(
            "app__vrchat_tools_group_event_update",
            format!("Updating group event {event_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn delete_group_event(
        &self,
        group_id: String,
        event_id: String,
    ) -> Result<VrchatResponse> {
        let (event_id, request) =
            group_event_delete_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), group_id, event_id)?;
        self.execute(
            "app__vrchat_tools_group_event_delete",
            format!("Deleting group event {event_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn group_calendar_event(
        &self,
        group_id: String,
        event_id: String,
    ) -> Result<VrchatResponse> {
        let (event_id, request) =
            group_calendar_event_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), group_id, event_id)?;
        self.execute(
            "app__vrchat_tools_group_calendar_event_get",
            format!("Getting group event {event_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn group_calendar_ics(
        &self,
        group_id: String,
        event_id: String,
    ) -> Result<VrchatResponse> {
        let (event_id, request) =
            group_calendar_ics_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), group_id, event_id)?;
        self.execute(
            "app__vrchat_tools_group_calendar_ics_get",
            format!("Getting calendar ICS for event {event_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn save_user_note(
        &self,
        target_user_id: String,
        note: String,
    ) -> Result<VrchatResponse> {
        let (target_user_id, request) =
            user_note_save_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), target_user_id, note)?;
        self.execute(
            "app__vrchat_tools_user_note_save",
            format!("Saving note for user {target_user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn report_user(
        &self,
        user_id: String,
        category: String,
        reason: String,
        description: String,
    ) -> Result<VrchatResponse> {
        let (user_id, request) = user_report_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            user_id,
            category,
            reason,
            description,
        )?;
        self.execute(
            "app__vrchat_tools_user_report",
            format!("Reporting user {user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn moderation_reports(
        &self,
        current_user_id: String,
        offset: i32,
        closed_only: bool,
        report_type: Option<ModerationReportType>,
    ) -> Result<VrchatResponse> {
        let (current_user_id, request) = moderation_reports_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            current_user_id,
            100,
            offset,
            closed_only,
            report_type,
        )?;
        self.execute(
            "app__vrchat_tools_moderation_reports_get",
            format!("Getting moderation reports submitted by {current_user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn invite_messages(
        &self,
        current_user_id: String,
        message_type: InviteMessageType,
    ) -> Result<VrchatResponse> {
        let (current_user_id, request) = invite_messages_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            current_user_id,
            message_type,
        )?;
        self.execute(
            "app__vrchat_tools_invite_messages_get",
            format!("Getting invite messages for {current_user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn edit_invite_message(
        &self,
        current_user_id: String,
        message_type: InviteMessageType,
        slot: i32,
        message: String,
    ) -> Result<VrchatResponse> {
        let (slot, request) = invite_message_edit_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            current_user_id,
            message_type,
            slot,
            message,
        )?;
        self.execute(
            "app__vrchat_tools_invite_message_edit",
            format!("Editing invite message {slot}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }
}
