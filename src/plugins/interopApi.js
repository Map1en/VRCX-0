// @ts-nocheck
import configRepository from '../services/config.js';

const eventHandlers = new Map();

export function onBackendEvent(name, handler) {
    if (!eventHandlers.has(name)) {
        eventHandlers.set(name, []);
    }
    eventHandlers.get(name).push(handler);
}

const serviceMap = {
    AppApi: 'app',
    WebApi: 'web',
    VRCXStorage: 'storage',
    SQLite: 'sqlite',
    LogWatcher: 'log_watcher',
    Discord: 'discord',
    AssetBundleManager: 'asset_bundle',
};

const toSnake = (s) =>
    s
        .replace(/VRChat/g, 'Vrchat')
        .replace(/IPC/g, 'Ipc')
        .replace(/OVRT/g, 'Ovrt')
        .replace(/VRCX/g, 'Vrcx')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();

function toTauriCommand(method) {
    const [service, fn] = method.split('.');
    const prefix = serviceMap[service] ?? toSnake(service);
    return `${prefix}__${toSnake(fn)}`;
}

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
    app__get_file_base64: ['path'],
    app__sign_file: ['blob'],
    app__resize_image_to_fit_limits: ['base64data'],
    app__write_config_file: ['json'],
    app__get_ugc_photo_location: ['path'],
    app__open_ugc_photos_folder: ['ugcPath'],
    app__open_folder_and_select_item: ['path', 'isFolder'],
    app__open_file_selector_dialog: ['defaultPath', 'defaultExt', 'defaultFilter'],
    app__quit_game: [],
    app__start_game: ['arguments'],
    app__start_game_from_path: ['path', 'arguments'],
    app__change_theme: ['value'],
    app__restart_application: ['isUpgrade'],
    app__set_tray_icon_notification: ['notify'],
    app__copy_image_to_clipboard: ['path'],
    app__set_startup: ['enabled'],
    app__get_vrchat_registry_key: ['key'],
    app__get_vrchat_registry_key_string: ['key'],
    app__set_vrchat_registry_key: ['key', 'value', 'typeInt'],
    app__set_vrchat_registry: ['json'],
    app__read_vrc_reg_json_file: ['filepath'],
    app__desktop_notification: ['boldText', 'text', 'image'],
    app__xs_notification: ['title', 'content', 'timeout', 'opacity', 'image'],
    app__ovrt_notification: ['hudNotification', 'wristNotification', 'title', 'body', 'timeout', 'opacity', 'image'],
    app__get_vrchat_moderations: ['currentUserId'],
    app__get_vrchat_user_moderation: ['currentUserId', 'userId'],
    app__set_vrchat_user_moderation: ['currentUserId', 'userId', 'moderationType'],
    app__send_ipc: ['typeName', 'data'],
    app__ipc_announce_start: [],
    app__set_app_launcher_settings: ['enabled', 'killOnExit', 'runProcessOnce'],
    app__try_open_instance_in_vrc: ['launchUrl'],
    app__open_calendar_file: ['icsContent'],
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
    ],
};

function toNamedArgs(cmd, args) {
    if (args.length === 0) return {};
    const names = commandArgs[cmd];
    if (names) {
        const obj = {};
        for (let i = 0; i < args.length; i++) {
            if (names[i]) obj[names[i]] = args[i];
        }
        return obj;
    }
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
        return args[0];
    }
    const obj = {};
    for (let i = 0; i < args.length; i++) {
        obj[`arg${i}`] = args[i];
    }
    return obj;
}

let tauriInvoke = null;
let tauriListen = null;

async function initTauri() {
    const core = await import('@tauri-apps/api/core');
    const event = await import('@tauri-apps/api/event');
    tauriInvoke = core.invoke;
    tauriListen = event.listen;
}

async function callTauri(method, args) {
    const cmd = toTauriCommand(method);
    try {
        return await tauriInvoke(cmd, toNamedArgs(cmd, args));
    } catch (e) {
        throw new Error(String(e));
    }
}

function initTauriEventListener() {
    const listened = new Set();
    const originalSet = eventHandlers.set.bind(eventHandlers);
    eventHandlers.set = function (name, handlers) {
        originalSet(name, handlers);
        if (!listened.has(name) && tauriListen) {
            listened.add(name);
            tauriListen(name, (event) => {
                const currentHandlers = eventHandlers.get(name);
                if (currentHandlers) {
                    for (const handler of currentHandlers) {
                        try {
                            handler(event.payload);
                        } catch (err) {
                            console.error(`Error in event handler for ${name}:`, err);
                        }
                    }
                }
            });
        }
        return this;
    };
}

function callBackend(method, args) {
    return callTauri(method, args);
}

function createServiceProxy(serviceName) {
    return new Proxy(
        {},
        {
            get(_, methodName) {
                if (typeof methodName !== 'string') return undefined;
                return (...args) =>
                    callBackend(`${serviceName}.${methodName}`, args);
            }
        }
    );
}

export async function initInteropApi() {
    await initTauri();
    initTauriEventListener();

    window.AppApi = createServiceProxy('AppApi');
    window.WebApi = createServiceProxy('WebApi');
    window.VRCXStorage = createServiceProxy('VRCXStorage');
    window.SQLite = createServiceProxy('SQLite');
    window.LogWatcher = createServiceProxy('LogWatcher');
    window.Discord = createServiceProxy('Discord');
    window.AssetBundleManager = createServiceProxy('AssetBundleManager');

    await configRepository.init();

    AppApi.SetUserAgent();

    const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const saved = await configRepository.getString('VRCX-0_ZoomLevel', null);
    if (saved) {
        const step = Number(saved) / 10 - 10;
        await getCurrentWebviewWindow().setZoom(Math.pow(1.2, step));
    }
}
