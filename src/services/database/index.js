import sqliteService from '../../repositories/sqliteRepository.js';
import { activityV2 } from './activityV2.js';
import { avatarFavorites } from './avatarFavorites.js';
import { avatarTags } from './avatarTags.js';
import { feed } from './feed.js';
import { friendFavorites } from './friendFavorites.js';
import { friendLogCurrent } from './friendLogCurrent.js';
import { friendLogHistory } from './friendLogHistory.js';
import { gameLog } from './gameLog.js';
import { memos } from './memos.js';
import { moderation } from './moderation.js';
import { mutualGraph } from './mutualGraph.js';
import { notifications } from './notifications.js';
import { tableAlter } from './tableAlter.js';
import { tableFixes } from './tableFixes.js';
import { tableSize } from './tableSize.js';
import {
    buildInitUserTableStatements,
    normalizeUserTablePrefix
} from './userTables.js';
import { worldFavorites } from './worldFavorites.js';

const dbVars = {
    userId: '',
    userPrefix: '',
    maxTableSize: 500,
    searchTableSize: 5000
};

const database = {
    ...feed,
    ...activityV2,
    ...gameLog,
    ...notifications,
    ...moderation,
    ...friendLogHistory,
    ...friendLogCurrent,
    ...memos,
    ...avatarFavorites,
    ...avatarTags,
    ...friendFavorites,
    ...worldFavorites,
    ...tableAlter,
    ...tableFixes,
    ...tableSize,
    ...mutualGraph,

    setMaxTableSize(limit) {
        dbVars.maxTableSize = limit;
    },

    setSearchTableSize(limit) {
        dbVars.searchTableSize = limit;
    },

    async initUserTables(userId) {
        dbVars.userId =
            typeof userId === 'string'
                ? userId.trim()
                : String(userId ?? '').trim();
        dbVars.userPrefix = normalizeUserTablePrefix(dbVars.userId);
        for (const sql of buildInitUserTableStatements(dbVars.userPrefix)) {
            await sqliteService.executeNonQuery(sql);
        }
    },

    async initTables() {
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_location (id INTEGER PRIMARY KEY, created_at TEXT, location TEXT, world_id TEXT, world_name TEXT, time INTEGER, group_name TEXT, UNIQUE(created_at, location))`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS gamelog_location_created_at_idx ON gamelog_location (created_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS idx_gamelog_location_world_created ON gamelog_location (world_id, created_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_join_leave (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, display_name TEXT, location TEXT, user_id TEXT, time INTEGER, UNIQUE(created_at, type, display_name))`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS idx_gamelog_jl_location ON gamelog_join_leave (location)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS idx_gamelog_jl_user_created ON gamelog_join_leave (user_id, created_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE INDEX IF NOT EXISTS idx_gamelog_jl_display_created ON gamelog_join_leave (display_name, created_at)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_portal_spawn (id INTEGER PRIMARY KEY, created_at TEXT, display_name TEXT, location TEXT, user_id TEXT, instance_id TEXT, world_name TEXT, UNIQUE(created_at, display_name))`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_video_play (id INTEGER PRIMARY KEY, created_at TEXT, video_url TEXT, video_name TEXT, video_id TEXT, location TEXT, display_name TEXT, user_id TEXT, UNIQUE(created_at, video_url))`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_resource_load (id INTEGER PRIMARY KEY, created_at TEXT, resource_url TEXT, resource_type TEXT, location TEXT, UNIQUE(created_at, resource_url))`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_event (id INTEGER PRIMARY KEY, created_at TEXT, data TEXT, UNIQUE(created_at, data))`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS gamelog_external (id INTEGER PRIMARY KEY, created_at TEXT, message TEXT, display_name TEXT, user_id TEXT, location TEXT, UNIQUE(created_at, message))`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS cache_avatar (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS cache_world (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_world (id INTEGER PRIMARY KEY, created_at TEXT, world_id TEXT, group_name TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_avatar (id INTEGER PRIMARY KEY, created_at TEXT, avatar_id TEXT, group_name TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS favorite_friend (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, group_name TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS memos (user_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS world_memos (world_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS avatar_memos (avatar_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)`
        );
        await sqliteService.executeNonQuery(
            `CREATE TABLE IF NOT EXISTS avatar_tags (avatar_id TEXT NOT NULL, tag TEXT NOT NULL, color TEXT, PRIMARY KEY (avatar_id, tag))`
        );
    },

    begin() {
        sqliteService.executeNonQuery('BEGIN');
    },

    commit() {
        sqliteService.executeNonQuery('COMMIT');
    },

    async vacuum() {
        await sqliteService.executeNonQuery('VACUUM');
    },

    async optimize() {
        await sqliteService.executeNonQuery('PRAGMA optimize');
    }
};

window.database = database;
export { database, dbVars };
