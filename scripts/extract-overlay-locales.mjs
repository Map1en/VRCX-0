import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputPath = path.join(
    repoRoot,
    'crates',
    'runtime-host',
    'src',
    'vr_overlay',
    'localization',
    'overlay_notifications.json'
);

const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko'];
const keys = [
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
const pathKeys = [
    ['overlay.footer.players', ['overlay', 'footer', 'players']],
    ['overlay.footer.instance_duration', ['overlay', 'footer', 'instance_duration']]
];

const catalog = {
    version: 1,
    fallbackLocale: 'en',
    locales: {}
};

for (const locale of locales) {
    const inputPath = path.join(repoRoot, 'src', 'localization', `${locale}.json`);
    const source = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
    const notifications = source.notifications || {};
    const entries = {};

    for (const key of keys) {
        const value = notifications[key];
        if (typeof value !== 'string') {
            throw new Error(`${inputPath} is missing notifications.${key}`);
        }
        entries[`notifications.${key}`] = value;
    }
    for (const [outputKey, sourcePath] of pathKeys) {
        const value = readPath(source, sourcePath);
        if (typeof value !== 'string') {
            throw new Error(`${inputPath} is missing ${outputKey}`);
        }
        entries[outputKey] = value;
    }

    catalog.locales[locale] = entries;
}

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);

function readPath(source, sourcePath) {
    return sourcePath.reduce((value, key) => {
        if (value && typeof value === 'object') {
            return value[key];
        }
        return undefined;
    }, source);
}
