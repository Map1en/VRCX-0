use serde::Deserialize;
use vrcx_0_application::remote::{
    CalendarListParams, GroupCalendarEventMutation, InviteMessageType, ModerationReportType,
};

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatToolsCalendarListInput {
    #[serde(default)]
    pub(crate) params: CalendarListParams,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatToolsCalendarGroupInput {
    #[serde(default)]
    pub(crate) group_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatToolsCalendarEventInput {
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) event_id: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatToolsGroupEventCreateInput {
    pub(crate) group_id: String,
    pub(crate) event: GroupCalendarEventMutation,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatToolsGroupEventUpdateInput {
    pub(crate) group_id: String,
    pub(crate) event_id: String,
    pub(crate) event: GroupCalendarEventMutation,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatToolsFollowGroupEventInput {
    #[serde(default)]
    pub(crate) group_id: String,
    #[serde(default)]
    pub(crate) event_id: String,
    #[serde(default)]
    pub(crate) is_following: bool,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatToolsUserNoteSaveInput {
    #[serde(default)]
    pub(crate) target_user_id: String,
    #[serde(default)]
    pub(crate) note: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatToolsUserReportInput {
    pub(crate) user_id: String,
    pub(crate) category: String,
    pub(crate) reason: String,
    #[serde(default)]
    pub(crate) description: String,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatToolsModerationReportsInput {
    #[serde(default)]
    pub(crate) current_user_id: String,
    #[serde(default)]
    pub(crate) offset: i32,
    #[serde(default)]
    pub(crate) closed_only: bool,
    #[serde(default)]
    pub(crate) report_type: Option<ModerationReportType>,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatToolsInviteMessagesInput {
    #[serde(default)]
    pub(crate) current_user_id: String,
    pub(crate) message_type: InviteMessageType,
}

#[derive(Debug, Deserialize, specta::Type)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct VrchatToolsInviteMessageEditInput {
    #[serde(default)]
    pub(crate) current_user_id: String,
    pub(crate) message_type: InviteMessageType,
    pub(crate) slot: i32,
    #[serde(default)]
    pub(crate) message: String,
}
