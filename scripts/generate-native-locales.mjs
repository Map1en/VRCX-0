import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const languageCodesPath = path.join(
    repoRoot,
    'src',
    'localization',
    'languageCodes.json'
);
const overlayOutputPath = path.join(
    repoRoot,
    'crates',
    'runtime-host',
    'src',
    'vr_overlay',
    'localization',
    'overlay_notifications.json'
);
const shellOutputPath = path.join(
    repoRoot,
    'src-tauri',
    'src',
    'localization',
    'shell_strings.json'
);

const languageCodes = JSON.parse(fs.readFileSync(languageCodesPath, 'utf8'));
if (
    !Array.isArray(languageCodes) ||
    languageCodes.some((code) => typeof code !== 'string')
) {
    throw new Error(
        `${languageCodesPath} must be a JSON array of locale codes`
    );
}

// Overlay notification copy currently exists only for the core UI locales.
const overlayLocales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'];
const notificationKeys = [
    'has_joined',
    'has_left',
    'is_joining',
    'gps',
    'online',
    'online_location',
    'offline',
    'status_update',
    'avatar_change',
    'friend',
    'unfriend',
    'display_name',
    'trust_level',
    'invite',
    'request_invite',
    'invite_response',
    'request_invite_response',
    'friend_request',
    'group_announcement_title',
    'group_informative_title',
    'group_invite_title',
    'group_join_request_title',
    'group_transfer_request_title',
    'group_queue_ready_title',
    'instance_closed_title',
    'blocked',
    'unblocked',
    'muted',
    'unmuted',
    'blocked_player_joined',
    'blocked_player_left',
    'muted_player_joined',
    'muted_player_left'
];
const overlayPathKeys = [
    ['overlay.footer.players', ['overlay', 'footer', 'players']],
    [
        'overlay.footer.instance_duration',
        ['overlay', 'footer', 'instance_duration']
    ],
    [
        'overlay.generic_instance_location',
        ['overlay', 'generic_instance_location']
    ],
    ['overlay.access.public', ['dialog', 'new_instance', 'access_type_public']],
    ['overlay.access.invite', ['dialog', 'new_instance', 'access_type_invite']],
    [
        'overlay.access.invite_plus',
        ['dialog', 'new_instance', 'access_type_invite_plus']
    ],
    [
        'overlay.access.friends',
        ['dialog', 'new_instance', 'access_type_friend']
    ],
    [
        'overlay.access.friends_plus',
        ['dialog', 'new_instance', 'access_type_friend_plus']
    ],
    ['overlay.access.group', ['dialog', 'new_instance', 'access_type_group']],
    [
        'overlay.access.group_public',
        ['dialog', 'new_instance', 'group_access_type_public']
    ],
    [
        'overlay.access.group_plus',
        ['dialog', 'new_instance', 'group_access_type_plus']
    ],
    ['overlay.status.active', ['dialog', 'user', 'status', 'online']],
    ['overlay.status.join_me', ['dialog', 'user', 'status', 'join_me']],
    ['overlay.status.ask_me', ['dialog', 'user', 'status', 'ask_me']],
    ['overlay.status.busy', ['dialog', 'user', 'status', 'busy']],
    ['overlay.discord.title.invite', ['overlay', 'discord', 'title', 'invite']],
    [
        'overlay.discord.title.request_invite',
        ['overlay', 'discord', 'title', 'request_invite']
    ],
    [
        'overlay.discord.title.invite_response',
        ['overlay', 'discord', 'title', 'invite_response']
    ],
    [
        'overlay.discord.title.request_invite_response',
        ['overlay', 'discord', 'title', 'request_invite_response']
    ],
    ['overlay.discord.title.gps', ['overlay', 'discord', 'title', 'gps']],
    ['overlay.discord.title.status', ['overlay', 'discord', 'title', 'status']],
    [
        'overlay.discord.title.avatar_change',
        ['overlay', 'discord', 'title', 'avatar_change']
    ],
    ['overlay.discord.title.online', ['overlay', 'discord', 'title', 'online']],
    [
        'overlay.discord.title.offline',
        ['overlay', 'discord', 'title', 'offline']
    ]
];
const shellPathKeys = pathKeysFromDottedKeys([
    'nativeShell.tray.open',
    'nativeShell.tray.backgroundMode',
    'nativeShell.tray.rebuildUi',
    'nativeShell.tray.disableTheme',
    'nativeShell.tray.exit',
    'nativeShell.notification.backgroundModeStarted.title',
    'nativeShell.notification.backgroundModeStarted.body',
    'nativeShell.notification.authFailure.title',
    'nativeShell.notification.authFailure.body',
    'nativeShell.menu.app.title',
    'nativeShell.menu.app.about',
    'nativeShell.menu.app.settings',
    'nativeShell.menu.app.checkUpdates',
    'nativeShell.menu.app.restart',
    'nativeShell.menu.app.startBackgroundMode',
    'nativeShell.menu.app.logout',
    'nativeShell.menu.app.quit',
    'nativeShell.menu.view.title',
    'nativeShell.menu.view.notificationCenter',
    'nativeShell.menu.view.quickSearch',
    'nativeShell.menu.view.directAccess',
    'nativeShell.menu.view.toggleNav',
    'nativeShell.menu.view.toggleFriendsSidebar',
    'nativeShell.menu.view.customNav',
    'nativeShell.menu.view.themes',
    'nativeShell.menu.view.zoomIn',
    'nativeShell.menu.view.zoomOut',
    'nativeShell.menu.view.resetZoom',
    'nativeShell.menu.tools.title',
    'nativeShell.menu.tools.allTools',
    'nativeShell.menu.help.title',
    'nativeShell.menu.help.changelog',
    'nativeShell.menu.help.keyboardShortcuts',
    'nativeShell.menu.help.reportIssue',
    'nativeShell.menu.help.github',
    'nativeShell.menu.help.discord',
    'nativeShell.menu.help.qqGroup',
    'nativeShell.menu.help.openDevtools',
    'nativeShell.menu.help.supportVrcx'
]);

const overlayCatalog = buildOverlayCatalog();
assertCatalogCoverage(
    overlayCatalog,
    overlayLocales,
    [
        ...notificationKeys.map((key) => `notifications.${key}`),
        ...overlayPathKeys.map(([key]) => key)
    ],
    overlayOutputPath
);
writeCatalog(overlayOutputPath, overlayCatalog);

const shellCatalog = buildPathCatalog(languageCodes, shellPathKeys);
assertCatalogCoverage(
    shellCatalog,
    languageCodes,
    shellPathKeys.map(([key]) => key),
    shellOutputPath
);
writeCatalog(shellOutputPath, shellCatalog);

function buildOverlayCatalog() {
    const catalog = createCatalog();

    for (const locale of overlayLocales) {
        const source = readLocale(locale);
        const notifications = source.notifications || {};
        const entries = {};

        for (const key of notificationKeys) {
            const value = notifications[key];
            if (typeof value !== 'string') {
                throw new Error(
                    `${localePath(locale)} is missing notifications.${key}`
                );
            }
            entries[`notifications.${key}`] = value;
        }
        Object.assign(
            entries,
            extractPathEntries(locale, source, overlayPathKeys)
        );

        catalog.locales[locale] = entries;
    }

    return catalog;
}

function buildPathCatalog(locales, pathKeys) {
    const catalog = createCatalog();

    for (const locale of locales) {
        catalog.locales[locale] = extractPathEntries(
            locale,
            readLocale(locale),
            pathKeys
        );
    }

    return catalog;
}

function extractPathEntries(locale, source, pathKeys) {
    const entries = {};
    const inputPath = localePath(locale);
    for (const [outputKey, sourcePath] of pathKeys) {
        const value = readPath(source, sourcePath);
        if (typeof value !== 'string') {
            throw new Error(`${inputPath} is missing ${outputKey}`);
        }
        entries[outputKey] = value;
    }
    return entries;
}

function pathKeysFromDottedKeys(keys) {
    return keys.map((key) => [key, key.split('.')]);
}

function readLocale(locale) {
    return JSON.parse(fs.readFileSync(localePath(locale), 'utf8'));
}

function localePath(locale) {
    return path.join(repoRoot, 'src', 'localization', `${locale}.json`);
}

function readPath(source, sourcePath) {
    return sourcePath.reduce((value, key) => {
        if (value && typeof value === 'object') {
            return value[key];
        }
        return undefined;
    }, source);
}

function createCatalog() {
    return {
        version: 1,
        fallbackLocale: 'en',
        locales: {}
    };
}

function assertCatalogCoverage(catalog, locales, keys, outputPath) {
    for (const locale of locales) {
        const entries = catalog.locales[locale];
        if (!entries) {
            throw new Error(`${outputPath} is missing locale ${locale}`);
        }
        for (const key of keys) {
            const value = entries[key];
            if (typeof value !== 'string' || value.trim() === '') {
                throw new Error(`${localePath(locale)} has empty ${key}`);
            }
            if (value.trim() === key) {
                throw new Error(`${localePath(locale)} uses raw key ${key}`);
            }
        }
    }
}

function writeCatalog(outputPath, catalog) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 4)}\n`);
    console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
}
