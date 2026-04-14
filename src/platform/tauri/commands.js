import { PlatformUnavailableError, normalizePlatformError } from './errors.js';

const serviceMap = {
    app: 'app',
    web: 'web',
    storage: 'storage',
    sqlite: 'sqlite',
    logWatcher: 'log_watcher',
    discord: 'discord',
    assetBundle: 'asset_bundle'
};

const commandArgs = {
    storage__get: ['key'],
    storage__set: ['key', 'value'],
    storage__remove: ['key'],
    sqlite__execute: ['sql', 'args'],
    sqlite__execute_non_query: ['sql', 'args'],
    log_watcher__set_date_till: ['date'],
    web__set_cookies: ['cookies'],
    web__execute: ['options'],
    app__open_link: ['url'],
    app__open_discord_profile: ['discordId'],
    discord__set_active: ['active'],
    discord__set_assets: ['payload'],
    app__get_clipboard: [],
    app__current_culture: [],
    app__current_language: [],
    app__set_user_agent: [],
    app__check_game_running: [],
    app__get_file_base64: ['path'],
    app__sign_file: ['blob'],
    app__resize_image_to_fit_limits: ['base64data'],
    app__read_config_file: [],
    app__read_config_file_safe: [],
    app__write_config_file: ['json'],
    app__get_ugc_photo_location: ['path'],
    app__open_ugc_photos_folder: ['ugcPath'],
    app__open_folder_and_select_item: ['path', 'isFolder'],
    app__open_file_selector_dialog: ['defaultPath', 'defaultExt', 'defaultFilter'],
    app__open_folder_selector_dialog: ['defaultPath'],
    app__quit_game: [],
    app__is_steamvr_running: [],
    app__start_game: ['arguments'],
    app__start_game_from_path: ['path', 'arguments'],
    app__change_theme: ['value'],
    app__restart_application: ['isUpgrade'],
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
    app__set_vrchat_user_moderation: ['currentUserId', 'userId', 'moderationType'],
    app__send_ipc: ['typeName', 'data'],
    app__ipc_announce_start: [],
    app__set_app_launcher_settings: ['enabled', 'killOnExit', 'runProcessOnce'],
    app__try_open_instance_in_vrc: ['launchUrl'],
    app__open_calendar_file: ['icsContent'],
    app__focus_window: [],
    app__flash_window: [],
    app__show_dev_tools: [],
    app__check_for_update_exe: [],
    app__check_legacy_vrcx_available: [],
    app__request_legacy_migration: [],
    app__populate_image_hosts: ['json'],
    app__get_image: ['url', 'fileId', 'version'],
    app__get_extra_screenshot_data: ['path', 'carouselCache'],
    app__get_screenshot_metadata: ['path'],
    app__find_screenshots_by_search: ['searchQuery', 'searchType'],
    app__delete_screenshot_metadata: ['path'],
    app__add_screenshot_metadata: ['path', 'metadataString', 'worldId', 'changeFilename'],
    app__crop_all_prints: ['ugcFolderPath'],
    app__crop_print_image: ['path'],
    app__save_print_to_file: ['url', 'ugcFolderPath', 'monthFolder', 'fileName'],
    app__save_sticker_to_file: ['url', 'ugcFolderPath', 'monthFolder', 'fileName'],
    app__save_emoji_to_file: ['url', 'ugcFolderPath', 'monthFolder', 'fileName'],
    app__download_update: ['fileUrl', 'hashString', 'downloadSize'],
    app__cancel_update: [],
    app__check_update_progress: [],
    asset_bundle__get_vrchat_cache_full_location: ['fileId', 'fileVersion', 'variant', 'variantVersion'],
    asset_bundle__check_vrchat_cache: ['fileId', 'fileVersion', 'variant', 'variantVersion'],
    asset_bundle__delete_cache: ['fileId', 'fileVersion', 'variant', 'variantVersion']
};

let invokeFn = null;

async function loadInvoke() {
    if (invokeFn) {
        return invokeFn;
    }

    try {
        const core = await import('@tauri-apps/api/core');
        invokeFn = core.invoke;
        return invokeFn;
    } catch {
        throw new PlatformUnavailableError('Unable to load Tauri invoke API');
    }
}

const toSnake = (value) =>
    value
        .replace(/VRChat/g, 'Vrchat')
        .replace(/SteamVR/g, 'Steamvr')
        .replace(/IPC/g, 'Ipc')
        .replace(/VRCX/g, 'Vrcx')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();

export function toCommandName(namespace, methodName) {
    const prefix = serviceMap[namespace] ?? toSnake(namespace);
    return `${prefix}__${toSnake(methodName)}`;
}

export function toNamedArgs(commandName, args) {
    if (!args || args.length === 0) {
        return {};
    }

    const names = commandArgs[commandName];
    if (names) {
        const payload = {};
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
        return args[0];
    }

    const payload = {};
    for (let index = 0; index < args.length; index += 1) {
        payload[`arg${index}`] = args[index];
    }
    return payload;
}

export async function callBackendCommand(namespace, methodName, args = []) {
    const invoke = await loadInvoke();
    const commandName = toCommandName(namespace, methodName);

    try {
        return await invoke(commandName, toNamedArgs(commandName, args));
    } catch (error) {
        throw normalizePlatformError(error, `Backend command failed: ${commandName}`);
    }
}

export function createBackendNamespace(namespace) {
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

                return (...args) => callBackendCommand(namespace, methodName, args);
            }
        }
    );
}
