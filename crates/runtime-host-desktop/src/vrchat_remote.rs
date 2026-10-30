use vrcx_0_application::remote::VrchatApiRuntime;
use vrcx_0_application_core::vrchat_api::{VrchatApiRequest, VrchatApiResponse, VrchatScope};
use vrcx_0_application_core::Result;
use vrcx_0_core::vrchat_endpoints::VRCHAT_API_DEFAULT_ENDPOINT;
use vrcx_0_vrchat_client::auth::{
    current_user_get_input, file_analysis_get_input, visits_get_input,
};
use vrcx_0_vrchat_client::avatars::{
    avatar_gallery_get_input, avatar_list_by_user_get_input, avatar_styles_get_input,
    AvatarListByUserGetInput,
};
use vrcx_0_vrchat_client::economy::{
    balance_get_input, licensed_avatars_get_input, purchases_get_input, store_get_input,
    transactions_get_input,
};
use vrcx_0_vrchat_client::favorites::{favorite_groups_get_input, favorite_worlds_get_input};
use vrcx_0_vrchat_client::friends::friend_status_get_input;
use vrcx_0_vrchat_client::instances::{
    instance_calendar_link_input, instance_close_input, instance_count_get_input,
    instance_create_input, instance_display_name_input, instance_get_input,
    instance_self_invite_input, instance_short_name_get_input, InstanceCreateRequest,
};
use vrcx_0_vrchat_client::media::{
    asset_upload_input, avatar_gallery_image_upload_input, file_delete_input, files_get_input,
    gallery_file_order_input, image_upload_input, inventory_bundle_consume_input,
    inventory_item_equip_input, inventory_item_update_input, inventory_items_get_input,
    inventory_slot_unequip_input, inventory_template_get_input, print_delete_input,
    print_get_input, print_upload_input, prints_get_input, reward_redeem_input,
    sticker_upload_input, tagged_image_upload_input, user_inventory_item_get_input,
    EmojiUploadParams, InventoryItemUpdateRequest, InventoryListParams, MediaAssetUploadRequest,
    MediaFileListParams, PrintUploadParams, ProfileDecorationEquipSlot,
};
use vrcx_0_vrchat_client::notifications::{
    boop_send_input, request_invite_photo_input, request_invite_send_input, RequestInviteRequest,
};
use vrcx_0_vrchat_client::query::{AvatarListSort, QueryOrder, ReleaseStatusFilter};
use vrcx_0_vrchat_client::search::{
    search_groups_get_input, search_groups_strict_get_input, search_instance_short_name_get_input,
    search_users_get_input, search_worlds_get_input, GroupSearchParams, UserSearchParams,
    WorldSearchParams,
};
use vrcx_0_vrchat_client::tools::{
    following_calendars_get_input, group_calendar_event_get_input, group_calendar_get_input,
    group_calendar_ics_get_input, group_event_create_input, group_event_delete_input,
    group_event_follow_input, group_event_update_input, invite_message_edit_input,
    invite_messages_get_input, moderation_reports_get_input, user_note_save_input,
    user_report_input, CalendarListParams, GroupCalendarEventMutation, InviteMessageType,
    ModerationReportType,
};
use vrcx_0_vrchat_client::users::{
    account_standing_get_input, profile_get_input, user_represented_group_get_input,
};

use crate::profile_bio::ProfileBioObserver;
use crate::DesktopMediaRuntime;

#[derive(Clone)]
pub struct DesktopVrchatRemoteFacade {
    api: VrchatApiRuntime,
    media: DesktopMediaRuntime,
    profile_bio: ProfileBioObserver,
}

impl DesktopVrchatRemoteFacade {
    pub(crate) fn new(
        api: VrchatApiRuntime,
        media: DesktopMediaRuntime,
        profile_bio: ProfileBioObserver,
    ) -> Self {
        Self {
            api,
            media,
            profile_bio,
        }
    }

    pub async fn current_user(&self) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_auth_current_user_get",
            "Getting current VRChat user.",
            current_user_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn visits(&self) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_auth_visits_get",
            "Getting online visits.",
            visits_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn file_analysis(
        &self,
        file_id: String,
        version: i64,
        variant: String,
    ) -> Result<VrchatApiResponse> {
        let (file_id, request) = file_analysis_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            file_id,
            version,
            variant,
        )?;
        self.execute(
            "app__vrchat_auth_file_analysis_get",
            format!("Getting file analysis for {file_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn user_profile(&self, user_id: String, as_self: bool) -> Result<VrchatApiResponse> {
        let (user_id, request) =
            profile_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), user_id, as_self)?;
        let response = self
            .execute(
                "app__vrchat_user_profile_get",
                format!("Getting profile for user {user_id}."),
                request,
                VrchatScope::Vrchat,
            )
            .await?;
        self.profile_bio.observe(&response);
        Ok(response)
    }

    pub async fn licensed_avatars(&self, n: i32, offset: i32) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_economy_licensed_avatars_get",
            "Getting licensed avatars.",
            licensed_avatars_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), n, offset),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn economy_purchases(
        &self,
        buyer_id: String,
        n: i32,
        offset: i32,
    ) -> Result<VrchatApiResponse> {
        let (buyer_id, request) =
            purchases_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), buyer_id, n, offset)?;
        self.execute(
            "app__vrchat_economy_purchases_get",
            format!("Getting purchases for {buyer_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn economy_transactions(&self, user_id: String, n: i32) -> Result<VrchatApiResponse> {
        let (user_id, request) =
            transactions_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), user_id, n)?;
        self.execute(
            "app__vrchat_economy_transactions_get",
            format!("Getting credit transactions for {user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn economy_balance(&self, user_id: String) -> Result<VrchatApiResponse> {
        let (user_id, request) = balance_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), user_id)?;
        self.execute(
            "app__vrchat_economy_balance_get",
            format!("Getting credit balance for {user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn economy_store(&self, store_id: String) -> Result<VrchatApiResponse> {
        let (store_id, request) = store_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), store_id)?;
        self.execute(
            "app__vrchat_economy_store_get",
            format!("Getting store {store_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn account_standing(&self) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_current_user_account_standing_get",
            "Getting current user account standing.",
            account_standing_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn user_represented_group(&self, user_id: String) -> Result<VrchatApiResponse> {
        let (user_id, request) =
            user_represented_group_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), user_id)?;
        self.execute(
            "app__vrchat_user_represented_group_get",
            format!("Getting represented group for user {user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn friend_status(&self, user_id: String) -> Result<VrchatApiResponse> {
        let (user_id, request) =
            friend_status_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), user_id)?;
        self.execute(
            "app__vrchat_friend_status_get",
            format!("Getting friend status for {user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn favorite_worlds(
        &self,
        n: i32,
        offset: i32,
        owner_id: String,
        user_id: String,
        tag: String,
    ) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_favorite_worlds_get",
            format!("Getting favorite worlds offset {offset}."),
            favorite_worlds_get_input(
                VRCHAT_API_DEFAULT_ENDPOINT.into(),
                n,
                offset,
                owner_id,
                user_id,
                tag,
            ),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn favorite_groups(
        &self,
        n: i32,
        offset: i32,
        owner_id: String,
    ) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_favorite_groups_get",
            format!("Getting favorite groups offset {offset}."),
            favorite_groups_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), n, offset, owner_id),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn avatar_gallery(&self, avatar_id: String) -> Result<VrchatApiResponse> {
        let (avatar_id, request) =
            avatar_gallery_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), avatar_id)?;
        self.execute(
            "app__vrchat_avatar_gallery_get",
            format!("Getting avatar gallery for {avatar_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn avatars_by_user(
        &self,
        user_id: String,
        user: String,
        n: i32,
        offset: i32,
        sort: AvatarListSort,
        order: QueryOrder,
        release_status: ReleaseStatusFilter,
    ) -> Result<VrchatApiResponse> {
        let (display_user, request) = avatar_list_by_user_get_input(AvatarListByUserGetInput {
            endpoint: VRCHAT_API_DEFAULT_ENDPOINT.into(),
            user_id,
            user,
            n,
            offset,
            sort,
            order,
            release_status,
        })?;
        self.execute(
            "app__vrchat_avatar_list_by_user_get",
            format!("Getting avatars for {display_user}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn avatar_styles(&self) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_avatar_styles_get",
            "Getting avatar styles.",
            avatar_styles_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_get(
        &self,
        world_id: String,
        instance_id: String,
    ) -> Result<VrchatApiResponse> {
        let (world_id, instance_id, request) =
            instance_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), world_id, instance_id)?;
        self.execute(
            "app__vrchat_instance_get",
            format!("Getting instance {world_id}:{instance_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_short_name(
        &self,
        world_id: String,
        instance_id: String,
        short_name: String,
    ) -> Result<VrchatApiResponse> {
        let (world_id, instance_id, request) = instance_short_name_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            world_id,
            instance_id,
            short_name,
        )?;
        self.execute(
            "app__vrchat_instance_short_name_get",
            format!("Getting short name for instance {world_id}:{instance_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_create(
        &self,
        params: InstanceCreateRequest,
    ) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_instance_create",
            "Creating instance.",
            instance_create_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params)?,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_self_invite(
        &self,
        world_id: String,
        instance_id: String,
        short_name: String,
    ) -> Result<VrchatApiResponse> {
        let (world_id, instance_id, request) = instance_self_invite_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            world_id,
            instance_id,
            short_name,
        )?;
        self.execute(
            "app__vrchat_instance_self_invite",
            format!("Sending self invite for {world_id}:{instance_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_close(
        &self,
        location: String,
        hard_close: bool,
    ) -> Result<VrchatApiResponse> {
        let (location, request) =
            instance_close_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), location, hard_close)?;
        self.execute(
            "app__vrchat_instance_close",
            format!("Closing instance {location}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_calendar_link(
        &self,
        location: String,
        calendar_entry_id: Option<String>,
    ) -> Result<VrchatApiResponse> {
        let (location, request) = instance_calendar_link_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            location,
            calendar_entry_id,
        )?;
        self.execute(
            "app__vrchat_instance_calendar_link_set",
            format!("Updating the calendar event of instance {location}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_display_name(
        &self,
        location: String,
        display_name: Option<String>,
    ) -> Result<VrchatApiResponse> {
        let (location, request) = instance_display_name_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            location,
            display_name,
        )?;
        self.execute(
            "app__vrchat_instance_display_name_set",
            format!("Renaming instance {location}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn instance_count(&self) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_instance_count_get",
            "Getting the active instance count.",
            instance_count_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into()),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn search_worlds(
        &self,
        params: WorldSearchParams,
        option: Option<String>,
    ) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_search_worlds_get",
            "Searching worlds.",
            search_worlds_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params, option),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn search_users(&self, params: UserSearchParams) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_search_users_get",
            "Searching users.",
            search_users_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn search_groups(&self, params: GroupSearchParams) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_search_groups_get",
            "Searching groups.",
            search_groups_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn search_groups_strict(
        &self,
        params: GroupSearchParams,
    ) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_search_groups_strict_get",
            "Strict searching groups.",
            search_groups_strict_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn search_instance_short_name(
        &self,
        short_name: String,
    ) -> Result<VrchatApiResponse> {
        let (short_name, request) =
            search_instance_short_name_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), short_name)?;
        self.execute(
            "app__vrchat_search_instance_short_name_get",
            format!("Resolving instance short name {short_name}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn group_calendar(&self, group_id: String) -> Result<VrchatApiResponse> {
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

    pub async fn following_calendars(
        &self,
        params: CalendarListParams,
    ) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_tools_following_calendars_get",
            "Getting followed group calendars.",
            following_calendars_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn follow_group_event(
        &self,
        group_id: String,
        event_id: String,
        is_following: bool,
    ) -> Result<VrchatApiResponse> {
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
    ) -> Result<VrchatApiResponse> {
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
    ) -> Result<VrchatApiResponse> {
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
    ) -> Result<VrchatApiResponse> {
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
    ) -> Result<VrchatApiResponse> {
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
    ) -> Result<VrchatApiResponse> {
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
    ) -> Result<VrchatApiResponse> {
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
    ) -> Result<VrchatApiResponse> {
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
    ) -> Result<VrchatApiResponse> {
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
    ) -> Result<VrchatApiResponse> {
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
    ) -> Result<VrchatApiResponse> {
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

    pub async fn request_invite(
        &self,
        receiver_user_id: String,
        params: RequestInviteRequest,
    ) -> Result<VrchatApiResponse> {
        let (receiver_user_id, request) = request_invite_send_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            receiver_user_id,
            params,
        )?;
        self.execute(
            "app__vrchat_request_invite_send",
            format!("Sending invite request to {receiver_user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn request_invite_photo(
        &self,
        receiver_user_id: String,
        params: RequestInviteRequest,
        image_data: String,
    ) -> Result<VrchatApiResponse> {
        let (receiver_user_id, request) = request_invite_photo_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            receiver_user_id,
            params,
            image_data,
        )?;
        let request = self.media.prepare_media_upload_request(request)?;
        self.execute(
            "app__vrchat_request_invite_photo_send",
            format!("Sending invite request photo to {receiver_user_id}."),
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn boop(
        &self,
        user_id: String,
        emoji_id: String,
        inventory_item_id: String,
    ) -> Result<VrchatApiResponse> {
        let (user_id, request) = boop_send_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            user_id,
            emoji_id,
            inventory_item_id,
        )?;
        self.execute(
            "app__vrchat_boop_send",
            format!("Sending boop to {user_id}."),
            request,
            VrchatScope::Vrchat,
        )
        .await
    }

    pub async fn media_files(&self, params: MediaFileListParams) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_media_files_get",
            "Getting media files.",
            files_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn delete_media_file(&self, file_id: String) -> Result<VrchatApiResponse> {
        let detail = format!("Deleting media file {file_id}.");
        let request = file_delete_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), file_id)?;
        self.execute(
            "app__vrchat_media_file_delete",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn set_avatar_gallery_order(
        &self,
        avatar_id: String,
        file_ids: Vec<String>,
    ) -> Result<VrchatApiResponse> {
        let detail = format!("Reordering avatar gallery {avatar_id}.");
        let request =
            gallery_file_order_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), avatar_id, file_ids)?;
        self.execute(
            "app__vrchat_media_avatar_gallery_order_set",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn upload_gallery_image(&self, image_data: String) -> Result<VrchatApiResponse> {
        let request = tagged_image_upload_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            image_data,
            "gallery",
            false,
        )?;
        self.execute_media_upload(
            "app__vrchat_media_gallery_image_upload",
            "Uploading gallery image.",
            request,
        )
        .await
    }

    pub async fn upload_avatar_gallery_image(
        &self,
        image_data: String,
        avatar_id: String,
    ) -> Result<VrchatApiResponse> {
        let request = avatar_gallery_image_upload_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            image_data,
            avatar_id,
        )?;
        self.execute_media_upload(
            "app__vrchat_media_avatar_gallery_image_upload",
            "Uploading avatar gallery image.",
            request,
        )
        .await
    }

    pub async fn upload_vrc_plus_icon(&self, image_data: String) -> Result<VrchatApiResponse> {
        let request = tagged_image_upload_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            image_data,
            "icon",
            true,
        )?;
        self.execute_media_upload(
            "app__vrchat_media_vrc_plus_icon_upload",
            "Uploading VRC+ icon.",
            request,
        )
        .await
    }

    pub async fn upload_emoji(
        &self,
        image_data: String,
        params: EmojiUploadParams,
    ) -> Result<VrchatApiResponse> {
        let request = image_upload_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            "file/image",
            image_data,
            params,
            true,
        )?;
        self.execute_media_upload(
            "app__vrchat_media_emoji_upload",
            "Uploading emoji.",
            request,
        )
        .await
    }

    pub async fn upload_sticker(&self, image_data: String) -> Result<VrchatApiResponse> {
        let request = sticker_upload_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), image_data)?;
        self.execute_media_upload(
            "app__vrchat_media_sticker_upload",
            "Uploading sticker.",
            request,
        )
        .await
    }

    pub async fn upload_print(
        &self,
        image_data: String,
        crop_white_border: bool,
        params: PrintUploadParams,
    ) -> Result<VrchatApiResponse> {
        let request = print_upload_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            image_data,
            crop_white_border,
            params,
        )?;
        self.execute_media_upload(
            "app__vrchat_media_print_upload",
            "Uploading print.",
            request,
        )
        .await
    }

    pub async fn upload_media_asset(
        &self,
        input: MediaAssetUploadRequest,
    ) -> Result<VrchatApiResponse> {
        let (asset_kind, request) = asset_upload_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), input)?;
        self.execute_media_upload(
            "app__vrchat_media_asset_upload",
            format!("Uploading media asset {asset_kind}."),
            request,
        )
        .await
    }

    pub async fn prints(&self, user_id: String, n: i32) -> Result<VrchatApiResponse> {
        let detail = format!("Getting prints for user {user_id}.");
        let request = prints_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), user_id, n)?;
        self.execute(
            "app__vrchat_media_prints_get",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn print(&self, print_id: String) -> Result<VrchatApiResponse> {
        let detail = format!("Getting print {print_id}.");
        let request = print_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), print_id)?;
        self.execute(
            "app__vrchat_media_print_get",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn delete_print(&self, print_id: String) -> Result<VrchatApiResponse> {
        self.media.ensure_print_deletable(&print_id)?;
        let detail = format!("Deleting print {print_id}.");
        let request = print_delete_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), print_id)?;
        self.execute(
            "app__vrchat_media_print_delete",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn inventory_items(&self, params: InventoryListParams) -> Result<VrchatApiResponse> {
        self.execute(
            "app__vrchat_media_inventory_items_get",
            "Getting inventory items.",
            inventory_items_get_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), params),
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn inventory_template(
        &self,
        inventory_template_id: String,
    ) -> Result<VrchatApiResponse> {
        let detail = format!("Getting inventory template {inventory_template_id}.");
        let request = inventory_template_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            inventory_template_id,
        )?;
        self.execute(
            "app__vrchat_media_inventory_template_get",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn equip_profile_decoration(
        &self,
        inventory_id: String,
        equip_slot: ProfileDecorationEquipSlot,
    ) -> Result<VrchatApiResponse> {
        let detail = format!("Equipping profile decoration {inventory_id}.");
        let request = inventory_item_equip_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            inventory_id,
            equip_slot,
        )?;
        self.execute(
            "app__vrchat_media_profile_decoration_equip",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn unequip_profile_decoration(
        &self,
        equip_slot: ProfileDecorationEquipSlot,
    ) -> Result<VrchatApiResponse> {
        let detail = format!(
            "Unequipping profile decoration slot {}.",
            equip_slot.as_str()
        );
        let request = inventory_slot_unequip_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), equip_slot)?;
        self.execute(
            "app__vrchat_media_profile_decoration_unequip",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn user_inventory_item(
        &self,
        user_id: String,
        inventory_id: String,
    ) -> Result<VrchatApiResponse> {
        let detail = format!("Getting inventory item {inventory_id}.");
        let request = user_inventory_item_get_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            user_id,
            inventory_id,
        )?;
        self.execute(
            "app__vrchat_media_user_inventory_item_get",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn update_inventory_item(
        &self,
        inventory_id: String,
        params: InventoryItemUpdateRequest,
    ) -> Result<VrchatApiResponse> {
        let detail = format!("Updating inventory item {inventory_id}.");
        let request = inventory_item_update_input(
            VRCHAT_API_DEFAULT_ENDPOINT.into(),
            inventory_id,
            InventoryItemUpdateRequest {
                is_archived: params.is_archived,
            },
        )?;
        self.execute(
            "app__vrchat_media_inventory_item_update",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn consume_inventory_bundle(
        &self,
        inventory_id: String,
    ) -> Result<VrchatApiResponse> {
        let detail = format!("Consuming inventory bundle {inventory_id}.");
        let request =
            inventory_bundle_consume_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), inventory_id)?;
        self.execute(
            "app__vrchat_media_inventory_bundle_consume",
            detail,
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    pub async fn redeem_reward(&self, code: String) -> Result<VrchatApiResponse> {
        let request = reward_redeem_input(VRCHAT_API_DEFAULT_ENDPOINT.into(), code)?;
        self.execute(
            "app__vrchat_media_reward_redeem",
            "Redeeming reward.",
            request,
            VrchatScope::VrchatMedia,
        )
        .await
    }

    async fn execute_media_upload(
        &self,
        command: &str,
        detail: impl Into<String>,
        request: VrchatApiRequest,
    ) -> Result<VrchatApiResponse> {
        let request = self.media.prepare_media_upload_request(request)?;
        self.execute(command, detail, request, VrchatScope::VrchatMedia)
            .await
    }

    async fn execute(
        &self,
        command: &str,
        detail: impl Into<String>,
        request: VrchatApiRequest,
        scope: VrchatScope,
    ) -> Result<VrchatApiResponse> {
        self.api.execute(command, detail, request, scope).await
    }
}
