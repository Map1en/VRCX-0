use vrcx_0_persistence::DatabaseService;

use crate::diagnostics::RuntimeDiagnostics;
use crate::sync::RuntimeSyncEngine;
use crate::web_client::WebClient;
use crate::Result;

pub type VrchatApiRequest = vrcx_0_vrchat_client::http_api::HttpApiRequestInput;
pub type VrchatApiResponse = vrcx_0_vrchat_client::http_api::HttpApiExecuteResponse;
pub type VrchatScope = vrcx_0_vrchat_client::http_api::ApiScope;

pub mod auth {
    pub use vrcx_0_vrchat_client::auth::{
        config_get_input, current_user_get_input, email_otp_verify_input, file_analysis_get_input,
        login_basic_input, otp_verify_input, session_get_input, totp_verify_input,
        visits_get_input,
    };
}

pub mod avatars {
    pub use vrcx_0_vrchat_client::avatars::{
        avatar_delete_input, avatar_file_get_input, avatar_gallery_get_input, avatar_get_input,
        avatar_impostor_create_input, avatar_impostor_delete_input, avatar_list_by_user_get_input,
        avatar_moderation_delete_input, avatar_moderation_send_input, avatar_moderations_get_input,
        avatar_save_input, avatar_select_fallback_input, avatar_select_input,
        avatar_styles_get_input, AvatarListByUserGetInput,
    };
}

pub mod favorites {
    pub use vrcx_0_vrchat_client::favorites::{
        favorite_add_input, favorite_avatars_get_input, favorite_delete_input,
        favorite_group_clear_input, favorite_group_save_input, favorite_groups_get_input,
        favorite_limits_get_input, favorite_worlds_get_input, favorites_get_input,
    };
}

pub mod friends {
    pub use vrcx_0_vrchat_client::friends::{
        friend_delete_input, friend_request_cancel_input, friend_request_send_input,
        friend_status_get_input, friends_get_input,
    };
}

pub mod groups {
    pub use vrcx_0_vrchat_client::groups::{
        current_user_group_instances_get_input, gallery_get_input, group_block_input,
        group_get_no_params_input, group_paged_get_input, invite_delete_input, invite_send_input,
        join_input, join_request_respond_input, join_requests_get_input, leave_input,
        logs_get_input, member_ban_input, member_get_input, member_kick_input,
        member_props_set_input, member_role_add_input, member_role_remove_input,
        member_unban_input, members_get_input, members_search_input, post_create_input,
        post_delete_input, post_edit_input, profile_get_input, representation_set_input,
        request_cancel_input, unblock_input, user_group_instances_get_input,
        user_group_permissions_get_input, user_groups_get_input,
    };
}

pub mod instances {
    pub use vrcx_0_vrchat_client::instances::{
        instance_close_input, instance_create_input, instance_get_input,
        instance_self_invite_input, instance_short_name_get_input,
    };
}

pub mod media {
    pub use vrcx_0_vrchat_client::media::{
        asset_upload_input, avatar_gallery_image_upload_input, avatar_image_set_input,
        file_delete_input, file_put_input, file_upload_finish_input, file_upload_stage_path,
        file_upload_start_input, file_version_create_input, files_get_input, image_upload_input,
        inventory_bundle_consume_input, inventory_item_update_input, inventory_items_get_input,
        print_delete_input, print_get_input, print_upload_input, prints_get_input,
        reward_redeem_input, sticker_upload_input, tagged_image_upload_input,
        user_inventory_item_get_input, world_image_set_input,
    };
}

pub mod notifications {
    pub use vrcx_0_vrchat_client::notifications::{
        boop_send_input, invite_photo_input, invite_response_photo_input,
        invite_response_send_input, invite_send_input, notification_accept_friend_request_input,
        notification_hide_remote_input, notification_mark_seen_input, notification_respond_input,
        request_invite_photo_input, request_invite_send_input,
    };
}

pub mod search {
    pub use vrcx_0_vrchat_client::search::{
        search_config_get_input, search_groups_get_input, search_groups_strict_get_input,
        search_instance_short_name_get_input, search_users_get_input, search_worlds_get_input,
    };
}

pub mod tools {
    pub use vrcx_0_vrchat_client::tools::{
        calendars_get_input, featured_calendars_get_input, following_calendars_get_input,
        group_calendar_get_input, group_calendar_ics_get_input, group_event_follow_input,
        invite_message_edit_input, invite_messages_get_input, user_note_save_input,
        user_report_input,
    };
}

pub mod users {
    pub use vrcx_0_vrchat_client::users::{
        current_user_badge_update_input, current_user_tags_add_input,
        current_user_tags_remove_input, current_user_update_input, user_groups_get_input,
        user_mutual_counts_get_input, user_mutual_friends_get_input,
        user_represented_group_get_input,
    };
}

pub mod worlds {
    pub use vrcx_0_vrchat_client::worlds::{
        world_delete_input, world_get_input, world_list_by_user_get_input,
        world_persistent_data_delete_input, world_persistent_data_exists_input,
        world_publish_input, world_save_input, world_unpublish_input,
    };
}

pub use vrcx_0_vrchat_client::http_api::{classify_api_response, normalize_text, require_text};

pub async fn execute_api_command(
    web: &WebClient,
    db: &DatabaseService,
    diagnostics: &RuntimeDiagnostics,
    sync: &RuntimeSyncEngine,
    command: (&str, impl Into<String>),
    input: VrchatApiRequest,
    scope: VrchatScope,
) -> Result<VrchatApiResponse> {
    let (command, detail) = command;
    diagnostics.record_command(command, "running", detail);
    let result = web.execute_api(input, scope, db).await;
    match &result {
        Ok(response) => {
            let policy_class =
                vrcx_0_vrchat_client::http_api::classify_api_response(response.status).class;
            diagnostics.record_command(
                command,
                "ok",
                format!("status={}, class={policy_class}", response.status),
            );
            sync.record(
                "api",
                "ready",
                format!("{command} completed with status {}.", response.status),
                0,
            );
        }
        Err(error) => {
            diagnostics.record_command(command, "error", error.to_string());
            sync.record_failure("api", error.to_string());
        }
    }
    result
}
