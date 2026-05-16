import { recordErrorLog } from '../../services/errorLogService.js';
import { PlatformUnavailableError, normalizePlatformError } from './errors.js';

type InvokeArgs = Record<string, unknown> | number[] | ArrayBuffer | Uint8Array;
type InvokeFn = <TReturn = unknown>(
    command: string,
    args?: InvokeArgs
) => Promise<TReturn>;

export type BackendCommand<TReturn = unknown> = (
    ...args: unknown[]
) => Promise<TReturn>;

export interface BackendNamespace {
    [methodName: string]: BackendCommand;
}

const serviceMap: Record<string, string> = {
    app: 'app',
    web: 'web',
    storage: 'storage',
    sqlite: 'sqlite',
    logWatcher: 'log_watcher',
    discord: 'discord',
    assetBundle: 'asset_bundle'
};

const commandArgs: Record<string, string[]> = {
    storage__get: ['key'],
    storage__set: ['key', 'value'],
    storage__remove: ['key'],
    sqlite__begin_upgrade: ['fromVersion', 'toVersion'],
    sqlite__commit_upgrade: [],
    sqlite__fail_upgrade: ['reason'],
    sqlite__get_failed_upgrade: [],
    log_watcher__set_date_till: ['date'],
    web__set_cookies: ['cookies'],
    app__open_link: ['url'],
    app__open_discord_profile: ['discordId'],
    discord__set_active: ['active'],
    discord__set_assets: ['payload'],
    app__get_clipboard: [],
    app__current_culture: [],
    app__current_language: [],
    app__get_host_capabilities: [],
    app__backend_app_snapshot_get: [],
    app__backend_auth_scope_get: [],
    app__backend_auth_scope_set: ['input'],
    app__backend_auth_config_get: ['input'],
    app__backend_auth_current_user_get: ['input'],
    app__backend_auth_email_otp_verify: ['input'],
    app__backend_auth_file_analysis_get: ['input'],
    app__backend_auth_login_basic: ['input'],
    app__backend_auth_otp_verify: ['input'],
    app__backend_auth_session_get: ['input'],
    app__backend_auth_totp_verify: ['input'],
    app__backend_auth_visits_get: ['input'],
    app__backend_avatar_delete: ['input'],
    app__backend_avatar_file_get: ['input'],
    app__backend_avatar_gallery_get: ['input'],
    app__backend_avatar_get: ['input'],
    app__backend_avatar_impostor_create: ['input'],
    app__backend_avatar_impostor_delete: ['input'],
    app__backend_avatar_list_by_user_get: ['input'],
    app__backend_avatar_moderation_delete: ['input'],
    app__backend_avatar_moderations_get: ['input'],
    app__backend_avatar_moderation_send: ['input'],
    app__backend_avatar_save: ['input'],
    app__backend_avatar_select: ['input'],
    app__backend_avatar_select_fallback: ['input'],
    app__backend_avatar_styles_get: ['input'],
    app__backend_favorite_add: ['input'],
    app__backend_favorite_avatars_get: ['input'],
    app__backend_favorite_delete: ['input'],
    app__backend_favorite_groups_get: ['input'],
    app__backend_favorite_group_clear: ['input'],
    app__backend_favorite_group_save: ['input'],
    app__backend_favorite_limits_get: ['input'],
    app__backend_favorite_worlds_get: ['input'],
    app__backend_favorites_get: ['input'],
    app__backend_local_favorite_add: ['input'],
    app__backend_local_favorite_remove: ['input'],
    app__backend_local_favorite_group_create: ['input'],
    app__backend_local_favorite_group_rename: ['input'],
    app__backend_local_favorite_group_delete: ['input'],
    app__backend_friend_delete: ['input'],
    app__backend_friend_status_get: ['input'],
    app__backend_friend_request_send: ['input'],
    app__backend_friend_request_cancel: ['input'],
    app__backend_friends_get: ['input'],
    app__backend_group_audit_log_types_get: ['input'],
    app__backend_group_bans_get: ['input'],
    app__backend_group_block: ['input'],
    app__backend_group_gallery_get: ['input'],
    app__backend_group_get: ['input'],
    app__backend_group_instances_get: ['input'],
    app__backend_group_invite_delete: ['input'],
    app__backend_group_invite_send: ['input'],
    app__backend_group_invites_get: ['input'],
    app__backend_group_join: ['input'],
    app__backend_group_join_requests_get: ['input'],
    app__backend_group_join_request_respond: ['input'],
    app__backend_group_leave: ['input'],
    app__backend_group_logs_get: ['input'],
    app__backend_group_member_ban: ['input'],
    app__backend_group_member_kick: ['input'],
    app__backend_group_member_props_set: ['input'],
    app__backend_group_member_unban: ['input'],
    app__backend_group_members_get: ['input'],
    app__backend_group_members_search: ['input'],
    app__backend_group_post_create: ['input'],
    app__backend_group_post_delete: ['input'],
    app__backend_group_post_edit: ['input'],
    app__backend_group_posts_get: ['input'],
    app__backend_group_representation_set: ['input'],
    app__backend_group_request_cancel: ['input'],
    app__backend_group_unblock: ['input'],
    app__backend_group_user_groups_get: ['input'],
    app__backend_group_user_instances_get: ['input'],
    app__backend_instance_close: ['input'],
    app__backend_instance_create: ['input'],
    app__backend_instance_get: ['input'],
    app__backend_instance_self_invite: ['input'],
    app__backend_instance_short_name_get: ['input'],
    app__backend_media_avatar_gallery_image_upload: ['input'],
    app__backend_media_avatar_image_set: ['input'],
    app__backend_media_emoji_upload: ['input'],
    app__backend_media_file_delete: ['input'],
    app__backend_media_file_put: ['input'],
    app__backend_media_file_upload_finish: ['input'],
    app__backend_media_file_upload_start: ['input'],
    app__backend_media_file_version_create: ['input'],
    app__backend_media_files_get: ['input'],
    app__backend_media_gallery_image_upload: ['input'],
    app__backend_media_inventory_bundle_consume: ['input'],
    app__backend_media_inventory_item_update: ['input'],
    app__backend_media_inventory_items_get: ['input'],
    app__backend_media_print_delete: ['input'],
    app__backend_media_print_get: ['input'],
    app__backend_media_print_upload: ['input'],
    app__backend_media_prints_get: ['input'],
    app__backend_media_reward_redeem: ['input'],
    app__backend_media_sticker_upload: ['input'],
    app__backend_media_user_inventory_item_get: ['input'],
    app__backend_media_vrc_plus_icon_upload: ['input'],
    app__backend_media_world_image_set: ['input'],
    app__backend_background_job_record: ['input'],
    app__backend_background_jobs_snapshot_get: [],
    app__backend_diagnostics_get: [],
    app__backend_external_avatar_search_get: ['input'],
    app__backend_external_github_releases_get: ['input'],
    app__backend_external_image_data_url_get: ['input'],
    app__backend_external_translation_request: ['input'],
    app__backend_external_vrc_status_json_get: ['input'],
    app__backend_external_youtube_video_metadata_get: ['input'],
    app__backend_moderation_refresh: ['input'],
    app__backend_moderation_update: ['input'],
    app__backend_notification_mark_seen: ['input'],
    app__backend_notification_accept_friend_request: ['input'],
    app__backend_notification_hide_remote: ['input'],
    app__backend_notification_respond: ['input'],
    app__backend_invite_response_photo_send: ['input'],
    app__backend_invite_response_send: ['input'],
    app__backend_invite_send: ['input'],
    app__backend_request_invite_send: ['input'],
    app__backend_boop_send: ['input'],
    app__backend_search_config_get: ['input'],
    app__backend_search_groups_get: ['input'],
    app__backend_search_groups_strict_get: ['input'],
    app__backend_search_instance_short_name_get: ['input'],
    app__backend_search_users_get: ['input'],
    app__backend_search_worlds_get: ['input'],
    app__backend_favorites_baseline_get: ['input'],
    app__backend_friend_roster_baseline_get: ['input'],
    app__backend_tools_calendars_get: ['input'],
    app__backend_tools_featured_calendars_get: ['input'],
    app__backend_tools_following_calendars_get: ['input'],
    app__backend_tools_group_calendar_get: ['input'],
    app__backend_tools_group_calendar_ics_get: ['input'],
    app__backend_tools_group_event_follow: ['input'],
    app__backend_tools_invite_message_edit: ['input'],
    app__backend_tools_invite_messages_get: ['input'],
    app__backend_tools_user_note_save: ['input'],
    app__backend_tools_user_report: ['input'],
    app__backend_current_user_badge_update: ['input'],
    app__backend_current_user_tags_add: ['input'],
    app__backend_current_user_tags_remove: ['input'],
    app__backend_current_user_update: ['input'],
    app__backend_user_get: ['input'],
    app__backend_user_groups_get: ['input'],
    app__backend_user_mutual_counts_get: ['input'],
    app__backend_user_mutual_friends_get: ['input'],
    app__backend_user_represented_group_get: ['input'],
    app__backend_world_delete: ['input'],
    app__backend_world_get: ['input'],
    app__backend_world_list_by_user_get: ['input'],
    app__backend_world_persistent_data_delete: ['input'],
    app__backend_world_persistent_data_exists: ['input'],
    app__backend_world_publish: ['input'],
    app__backend_world_save: ['input'],
    app__backend_world_unpublish: ['input'],
    app__backend_runtime_snapshot_get: [],
    app__backend_sync_snapshot_get: [],
    app__activity_self_sessions_refresh: ['input'],
    app__set_user_agent: [],
    app__check_game_running: [],
    app__set_game_client_runtime_state: ['sessionActive', 'currentLocation'],
    app__start_realtime_transport: [
        'userId',
        'endpoint',
        'websocket',
        'clientRunId',
        'currentUserSnapshot',
        'friendsById'
    ],
    app__sync_realtime_friend_snapshot: [
        'userId',
        'endpoint',
        'websocket',
        'generation',
        'friendsById'
    ],
    app__sync_realtime_current_user_snapshot: [
        'userId',
        'endpoint',
        'websocket',
        'generation',
        'snapshot',
        'overlayPatch'
    ],
    app__expire_realtime_notification: ['userId', 'notificationId'],
    app__stop_realtime_transport: [
        'userId',
        'endpoint',
        'websocket',
        'clientRunId',
        'generation'
    ],
    app__get_file_base64: ['path'],
    app__sign_file: ['blob'],
    app__resize_image_to_fit_limits: ['base64data'],
    app__read_config_file: [],
    app__read_config_file_safe: [],
    app__write_config_file: ['json'],
    app__append_error_log: ['entry'],
    app__get_ugc_photo_location: ['path'],
    app__open_ugc_photos_folder: ['ugcPath'],
    app__open_folder_and_select_item: ['path', 'isFolder'],
    app__open_file_selector_dialog: [
        'defaultPath',
        'defaultExt',
        'defaultFilter'
    ],
    app__open_folder_selector_dialog: ['defaultPath'],
    app__quit_game: [],
    app__is_steamvr_running: [],
    app__start_game: ['arguments'],
    app__start_game_from_path: ['path', 'arguments'],
    app__change_theme: ['value'],
    app__restart_application: [],
    app__exit_application: [],
    app__set_tray_icon_notification: ['notify'],
    app__copy_image_to_clipboard: ['path'],
    app__set_startup: ['enabled'],
    app__get_vrchat_registry_key: ['key'],
    app__get_vrchat_registry_key_string: ['key'],
    app__has_vrchat_registry_folder: [],
    app__get_vrchat_registry: [],
    app__set_vrchat_registry_key: ['key', 'value', 'typeInt'],
    app__set_vrchat_registry: ['json'],
    app__read_vrc_reg_json_file: ['filepath'],
    app__save_vrc_reg_json_file: ['defaultPath', 'defaultName', 'json'],
    app__desktop_notification: ['boldText', 'text', 'image'],
    app__get_vrchat_moderations: ['currentUserId'],
    app__get_vrchat_user_moderation: ['currentUserId', 'userId'],
    app__set_vrchat_user_moderation: [
        'currentUserId',
        'userId',
        'moderationType'
    ],
    app__send_ipc: ['typeName', 'data'],
    app__ipc_announce_start: [],
    app__set_app_launcher_settings: ['enabled', 'killOnExit', 'runProcessOnce'],
    app__try_open_instance_in_vrc: ['launchUrl'],
    app__open_calendar_file: ['icsContent'],
    app__save_calendar_file: ['defaultName', 'icsContent'],
    app__save_image_file: ['defaultName', 'base64Data'],
    app__focus_window: [],
    app__flash_window: [],
    app__check_legacy_vrcx_available: [],
    app__get_legacy_vrcx_migration_status: [],
    app__get_legacy_vrcx_force_migration_status: [],
    app__request_legacy_migration: [],
    app__request_legacy_vrcx_force_migration: [],
    app__get_image: ['url', 'fileId', 'version'],
    app__get_extra_screenshot_data: ['path', 'carouselCache'],
    app__get_screenshot_metadata: ['path'],
    app__find_screenshots_by_search: ['searchQuery', 'searchType'],
    app__start_screenshot_library_scan: ['force'],
    app__get_screenshot_library_status: [],
    app__get_screenshot_folder_tree: [],
    app__get_screenshot_folder_images: ['folderPath'],
    app__get_world_screenshots: ['worldId'],
    app__ensure_screenshot_thumbnail: ['path'],
    app__delete_screenshot_metadata: ['path'],
    app__add_screenshot_metadata: [
        'path',
        'metadataString',
        'worldId',
        'changeFilename'
    ],
    app__crop_all_prints: ['ugcFolderPath'],
    app__crop_print_image: ['path'],
    app__save_print_to_file: [
        'url',
        'ugcFolderPath',
        'monthFolder',
        'fileName'
    ],
    app__save_sticker_to_file: [
        'url',
        'ugcFolderPath',
        'monthFolder',
        'fileName'
    ],
    app__save_emoji_to_file: [
        'url',
        'ugcFolderPath',
        'monthFolder',
        'fileName'
    ],
    asset_bundle__get_vrchat_cache_full_location: [
        'fileId',
        'fileVersion',
        'variant',
        'variantVersion'
    ],
    asset_bundle__check_vrchat_cache: [
        'fileId',
        'fileVersion',
        'variant',
        'variantVersion'
    ],
    asset_bundle__delete_cache: [
        'fileId',
        'fileVersion',
        'variant',
        'variantVersion'
    ]
};

let invokeFn: InvokeFn | null = null;

async function loadInvoke(): Promise<InvokeFn> {
    if (invokeFn) {
        return invokeFn;
    }

    try {
        const core = await import('@tauri-apps/api/core');
        invokeFn = core.invoke as InvokeFn;
        return invokeFn;
    } catch {
        throw new PlatformUnavailableError('Unable to load Tauri invoke API');
    }
}

const toSnake = (value: string): string =>
    value
        .replace(/VRChat/g, 'Vrchat')
        .replace(/SteamVR/g, 'Steamvr')
        .replace(/IPC/g, 'Ipc')
        .replace(/VRCX/g, 'Vrcx')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();

export function toCommandName(namespace: string, methodName: string): string {
    const prefix = serviceMap[namespace] ?? toSnake(namespace);
    return `${prefix}__${toSnake(methodName)}`;
}

export function toNamedArgs(
    commandName: string,
    args: unknown[]
): Record<string, unknown> {
    if (!args || args.length === 0) {
        return {};
    }

    const names = commandArgs[commandName];
    if (names) {
        const payload: Record<string, unknown> = {};
        for (let index = 0; index < args.length; index += 1) {
            if (names[index]) {
                payload[names[index]] = args[index];
            }
        }
        return payload;
    }

    if (
        args.length === 1 &&
        typeof args[0] === 'object' &&
        args[0] !== null &&
        !Array.isArray(args[0])
    ) {
        return args[0] as Record<string, unknown>;
    }

    const payload: Record<string, unknown> = {};
    for (let index = 0; index < args.length; index += 1) {
        payload[`arg${index}`] = args[index];
    }
    return payload;
}

export async function callBackendCommand<TReturn = unknown>(
    namespace: string,
    methodName: string,
    args: unknown[] = []
): Promise<TReturn> {
    const invoke = await loadInvoke();
    const commandName = toCommandName(namespace, methodName);

    try {
        return await invoke<TReturn>(
            commandName,
            toNamedArgs(commandName, args)
        );
    } catch (error) {
        const normalizedError = normalizePlatformError(
            error,
            `Backend command failed: ${commandName}`
        );

        if (commandName !== 'app__append_error_log') {
            void recordErrorLog('rust:command', [
                `command: ${commandName}`,
                normalizedError
            ]);
        }

        throw normalizedError;
    }
}

export function createBackendNamespace(namespace: string): BackendNamespace {
    return new Proxy(
        {},
        {
            get(_, methodName) {
                if (typeof methodName !== 'string') {
                    return undefined;
                }

                if (methodName === 'then') {
                    return undefined;
                }

                return (...args) =>
                    callBackendCommand(namespace, methodName, args);
            }
        }
    );
}
