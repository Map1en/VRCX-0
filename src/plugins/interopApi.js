// @ts-nocheck
import configRepository from '../services/config.js';

/** @type {Map<string, Function[]>} */
const eventHandlers = new Map();

/**
 * Register a handler for backend push events.
 * Works with both WebView2 (C#) and Tauri (Rust) backends.
 * @param {string} name
 * @param {Function} handler
 */
export function onBackendEvent(name, handler) {
    if (!eventHandlers.has(name)) {
        eventHandlers.set(name, []);
    }
    eventHandlers.get(name).push(handler);
}

// ---------------------------------------------------------------------------
// Environment detection
// ---------------------------------------------------------------------------

const isTauri = '__TAURI_INTERNALS__' in window;

// ---------------------------------------------------------------------------
// Tauri backend (Rust)
// ---------------------------------------------------------------------------

/**
 * Explicit mapping from frontend service names to Rust command prefixes.
 * Handles acronyms (VRCX, SQL) that generic camelCase→snake_case can't.
 */
const serviceMap = {
    AppApi: 'app',
    WebApi: 'web',
    VRCXStorage: 'storage',
    SQLite: 'sqlite',
    LogWatcher: 'log_watcher',
    Discord: 'discord',
    AssetBundleManager: 'asset_bundle',
};

/** @param {string} s */
const toSnake = (s) =>
    s
        .replace(/VRChat/g, 'Vrchat')
        .replace(/IPC/g, 'Ipc')
        .replace(/OVRT/g, 'Ovrt')
        .replace(/VRCX/g, 'Vrcx')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase();

/**
 * Convert "ServiceName.MethodName" → "service__method_name"
 * @param {string} method
 * @returns {string}
 */
function toTauriCommand(method) {
    const [service, fn] = method.split('.');
    const prefix = serviceMap[service] ?? toSnake(service);
    return `${prefix}__${toSnake(fn)}`;
}

/**
 * Argument name mapping for Tauri commands.
 * Tauri invoke() requires named parameters matching the Rust function signatures.
 * Keys are the Tauri command names (e.g. "storage__get"), values are ordered param name arrays.
 */
const commandArgs = {
    storage__get: ['key'],
    storage__set: ['key', 'value'],
    storage__remove: ['key'],
    // storage__get_all: no args
    sqlite__execute: ['sql', 'args'],
    sqlite__execute_non_query: ['sql', 'args'],
    // app__check_game_running: no args
    // app__is_game_running: no args
    // app__is_steamvr_running: no args
    // log_watcher__get: no args
    log_watcher__set_date_till: ['date'],
    // log_watcher__reset: no args
    // log_watcher__vrc_closed_gracefully: no args
    // web__clear_cookies: no args
    // web__get_cookies: no args
    web__set_cookies: ['cookies'],
    web__execute: ['options'],
    // App — simple
    app__open_link: ['url'],
    app__open_discord_profile: ['discordId'],
    app__get_file_base64: ['path'],
    app__md5_file: ['blob'],
    app__file_length: ['blob'],
    app__sign_file: ['blob'],
    app__resize_image_to_fit_limits: ['base64data'],
    // App — VRChat config
    app__write_config_file: ['json'],
    // App — folders
    app__get_ugc_photo_location: ['path'],
    app__open_ugc_photos_folder: ['ugcPath'],
    app__open_folder_and_select_item: ['path', 'isFolder'],
    app__open_file_selector_dialog: ['defaultPath', 'defaultExt', 'defaultFilter'],
    // App — game
    app__quit_game: [],
    app__start_game: ['arguments'],
    app__start_game_from_path: ['path', 'arguments'],
    // App — window/UI
    app__set_zoom: ['zoomLevel'],
    app__change_theme: ['value'],
    app__restart_application: ['isUpgrade'],
    app__set_tray_icon_notification: ['notify'],
    // App — clipboard
    app__copy_image_to_clipboard: ['path'],
    // App — startup/registry
    app__set_startup: ['enabled'],
    app__get_vrchat_registry_key: ['key'],
    app__get_vrchat_registry_key_string: ['key'],
    app__set_vrchat_registry_key: ['key', 'value', 'typeInt'],
    app__set_vrchat_registry: ['json'],
    app__read_vrc_reg_json_file: ['filepath'],
    // App — notifications
    app__desktop_notification: ['boldText', 'text', 'image'],
    app__xs_notification: ['title', 'content', 'timeout', 'opacity', 'image'],
    app__ovrt_notification: ['hudNotification', 'wristNotification', 'title', 'body', 'timeout', 'opacity', 'image'],
    // App — moderations
    app__get_vrchat_moderations: ['currentUserId'],
    app__get_vrchat_user_moderation: ['currentUserId', 'userId'],
    app__set_vrchat_user_moderation: ['currentUserId', 'userId', 'moderationType'],
    // App — IPC
    app__send_ipc: ['typeName', 'data'],
    app__ipc_announce_start: [],
    app__set_app_launcher_settings: ['enabled', 'killOnExit', 'runProcessOnce'],
    app__try_open_instance_in_vrc: ['launchUrl'],
    // App — calendar
    app__open_calendar_file: ['icsContent'],
    // App — images
    app__populate_image_hosts: ['json'],
    app__get_image: ['url', 'fileId', 'version'],
    // App — screenshots
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
    // App — updates
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

/**
 * Convert positional args to named args object for Tauri invoke.
 * Uses the commandArgs table when available, falls back to generic names.
 * @param {string} cmd - Tauri command name
 * @param {any[]} args
 * @returns {Record<string, any>}
 */
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
    // Fallback: single object arg passed as-is
    if (args.length === 1 && typeof args[0] === 'object' && args[0] !== null && !Array.isArray(args[0])) {
        return args[0];
    }
    // Generic positional → named mapping for unported commands
    const obj = {};
    for (let i = 0; i < args.length; i++) {
        obj[`arg${i}`] = args[i];
    }
    return obj;
}

/** @type {typeof import('@tauri-apps/api/core').invoke | null} */
let tauriInvoke = null;
/** @type {typeof import('@tauri-apps/api/event').listen | null} */
let tauriListen = null;

async function initTauri() {
    const core = await import('@tauri-apps/api/core');
    const event = await import('@tauri-apps/api/event');
    tauriInvoke = core.invoke;
    tauriListen = event.listen;
}

/**
 * Call a Tauri command. Falls back to WebView2 if command not found (dev transition).
 * @param {string} method - "ServiceName.MethodName" format
 * @param {any[]} args
 * @returns {Promise<any>}
 */
async function callTauri(method, args) {
    const cmd = toTauriCommand(method);
    try {
        return await tauriInvoke(cmd, toNamedArgs(cmd, args));
    } catch (e) {
        const msg = String(e);
        // If command not registered in Tauri yet, fall back to WebView2 during transition
        if (msg.includes('not found') || msg.includes('did_you_mean')) {
            console.warn(`[bridge] ${method} → ${cmd} not in Tauri, falling back to WebView2`);
            return callWebView2(method, args);
        }
        throw new Error(msg);
    }
}

function initTauriEventListener() {
    // Tauri events: listen for each registered event name
    // We re-listen whenever a new handler is added via onBackendEvent
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

// ---------------------------------------------------------------------------
// WebView2 backend (C# .NET) — original implementation
// ---------------------------------------------------------------------------

/** @type {Map<string, {resolve: Function, reject: Function}>} */
const pendingRequests = new Map();
let requestId = 0;

/**
 * @param {string} method
 * @param {any[]} args
 * @returns {Promise<any>}
 */
function callWebView2(method, args) {
    return new Promise((resolve, reject) => {
        const id = String(++requestId);
        pendingRequests.set(id, { resolve, reject });
        window.chrome.webview.postMessage({ id, method, args });
    });
}

function initWebView2MessageListener() {
    window.chrome.webview.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg) return;

        // Response to a pending request
        if (msg.id && pendingRequests.has(msg.id)) {
            const { resolve, reject } = pendingRequests.get(msg.id);
            pendingRequests.delete(msg.id);
            if (msg.error) {
                reject(new Error(msg.error));
            } else {
                resolve(msg.result);
            }
            return;
        }

        // Push event from C#
        if (msg.type === 'event' && msg.name) {
            const handlers = eventHandlers.get(msg.name);
            if (handlers) {
                for (const handler of handlers) {
                    try {
                        handler(msg.data);
                    } catch (e) {
                        console.error(
                            `Error in event handler for ${msg.name}:`,
                            e
                        );
                    }
                }
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Unified callBackend + init
// ---------------------------------------------------------------------------

/**
 * @param {string} method - "ServiceName.MethodName"
 * @param {any[]} args
 * @returns {Promise<any>}
 */
function callBackend(method, args) {
    if (isTauri) {
        return callTauri(method, args);
    }
    return callWebView2(method, args);
}

/**
 * Create a Proxy that wraps service calls into backend requests
 * @param {string} serviceName
 * @returns {any}
 */
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
    if (isTauri) {
        await initTauri();
        initTauriEventListener();
    } else {
        initWebView2MessageListener();
    }

    // Create service proxies and expose as globals (matching legacy interop behavior)
    window.AppApi = createServiceProxy('AppApi');
    window.WebApi = createServiceProxy('WebApi');
    window.VRCXStorage = createServiceProxy('VRCXStorage');
    window.SQLite = createServiceProxy('SQLite');
    window.LogWatcher = createServiceProxy('LogWatcher');
    window.Discord = createServiceProxy('Discord');
    window.AssetBundleManager = createServiceProxy('AssetBundleManager');

    await configRepository.init();

    AppApi.SetUserAgent();
}

