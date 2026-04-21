function normalizeUserTablePrefix(userId) {
    const normalizedUserId =
        typeof userId === 'string'
            ? userId.trim()
            : String(userId ?? '').trim();
    if (!normalizedUserId) {
        throw new Error('User table prefix requires a user id.');
    }

    let userPrefix = normalizedUserId.replaceAll('-', '').replaceAll('_', '');
    if (!/^[A-Za-z0-9]+$/.test(userPrefix)) {
        throw new Error('User table prefix contains invalid characters.');
    }
    if (/^\d/.test(userPrefix)) {
        userPrefix = `_${userPrefix}`;
    }

    return userPrefix;
}

function buildUserTableName(userIdOrPrefix, suffix) {
    const value =
        typeof userIdOrPrefix === 'string'
            ? userIdOrPrefix.trim()
            : String(userIdOrPrefix ?? '').trim();
    const tablePrefix =
        /^[A-Za-z][A-Za-z0-9]*$/.test(value) || /^_[A-Za-z0-9]+$/.test(value)
            ? value
            : normalizeUserTablePrefix(value);
    if (!/^[A-Za-z_][A-Za-z0-9]*$/.test(tablePrefix)) {
        throw new Error('User table prefix contains invalid characters.');
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(suffix)) {
        throw new Error('User table suffix contains invalid characters.');
    }
    return `${tablePrefix}_${suffix}`;
}

function buildInitUserTableStatements(userPrefix) {
    if (!/^[A-Za-z_][A-Za-z0-9]*$/.test(userPrefix)) {
        throw new Error('User table prefix contains invalid characters.');
    }

    return [
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_feed_gps (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, location TEXT, world_name TEXT, previous_location TEXT, time INTEGER, group_name TEXT)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_feed_status (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, status TEXT, status_description TEXT, previous_status TEXT, previous_status_description TEXT)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_feed_bio (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, bio TEXT, previous_bio TEXT)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_feed_avatar (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, owner_id TEXT, avatar_name TEXT, current_avatar_image_url TEXT, current_avatar_thumbnail_image_url TEXT, previous_current_avatar_image_url TEXT, previous_current_avatar_thumbnail_image_url TEXT)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_feed_online_offline (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, display_name TEXT, type TEXT, location TEXT, world_name TEXT, time INTEGER, group_name TEXT)`,
        `CREATE INDEX IF NOT EXISTS ${userPrefix}_feed_online_offline_user_created_idx ON ${userPrefix}_feed_online_offline (user_id, created_at)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_activity_sync_state_v2 (
            user_id TEXT PRIMARY KEY,
            updated_at TEXT NOT NULL DEFAULT '',
            is_self INTEGER NOT NULL DEFAULT 0,
            source_last_created_at TEXT NOT NULL DEFAULT '',
            pending_session_start_at INTEGER,
            cached_range_days INTEGER NOT NULL DEFAULT 0
        )`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_activity_sessions_v2 (
            session_id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            start_at INTEGER NOT NULL,
            end_at INTEGER NOT NULL,
            is_open_tail INTEGER NOT NULL DEFAULT 0,
            source_revision TEXT NOT NULL DEFAULT ''
        )`,
        `CREATE INDEX IF NOT EXISTS ${userPrefix}_activity_sessions_v2_user_start_idx ON ${userPrefix}_activity_sessions_v2 (user_id, start_at)`,
        `CREATE INDEX IF NOT EXISTS ${userPrefix}_activity_sessions_v2_user_end_idx ON ${userPrefix}_activity_sessions_v2 (user_id, end_at)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_activity_bucket_cache_v2 (
            user_id TEXT NOT NULL,
            target_user_id TEXT NOT NULL DEFAULT '',
            range_days INTEGER NOT NULL,
            view_kind TEXT NOT NULL,
            exclude_key TEXT NOT NULL DEFAULT '',
            bucket_version INTEGER NOT NULL DEFAULT 1,
            raw_buckets_json TEXT NOT NULL DEFAULT '[]',
            normalized_buckets_json TEXT NOT NULL DEFAULT '[]',
            built_from_cursor TEXT NOT NULL DEFAULT '',
            summary_json TEXT NOT NULL DEFAULT '{}',
            built_at TEXT NOT NULL DEFAULT '',
            PRIMARY KEY (user_id, target_user_id, range_days, view_kind, exclude_key)
        )`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_friend_log_current (user_id TEXT PRIMARY KEY, display_name TEXT, trust_level TEXT, friend_number INTEGER)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_friend_log_history (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, user_id TEXT, display_name TEXT, previous_display_name TEXT, trust_level TEXT, previous_trust_level TEXT, friend_number INTEGER)`,
        `CREATE INDEX IF NOT EXISTS ${userPrefix}_friend_log_history_user_id_idx ON ${userPrefix}_friend_log_history (user_id)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_notifications (id TEXT PRIMARY KEY, created_at TEXT, type TEXT, sender_user_id TEXT, sender_username TEXT, receiver_user_id TEXT, message TEXT, world_id TEXT, world_name TEXT, image_url TEXT, invite_message TEXT, request_message TEXT, response_message TEXT, expired INTEGER)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_notifications_v2 (id TEXT PRIMARY KEY, created_at TEXT, updated_at TEXT, expires_at TEXT, type TEXT, link TEXT, link_text TEXT, message TEXT, title TEXT, image_url TEXT, seen INTEGER, sender_user_id TEXT, sender_username TEXT, data TEXT, responses TEXT, details TEXT)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_moderation (user_id TEXT PRIMARY KEY, updated_at TEXT, display_name TEXT, block INTEGER, mute INTEGER)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_avatar_history (avatar_id TEXT PRIMARY KEY, created_at TEXT, time INTEGER)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_notes (user_id TEXT PRIMARY KEY, display_name TEXT, note TEXT, created_at TEXT)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_mutual_graph_friends (friend_id TEXT PRIMARY KEY)`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_mutual_graph_links (friend_id TEXT NOT NULL, mutual_id TEXT NOT NULL, PRIMARY KEY(friend_id, mutual_id))`,
        `CREATE TABLE IF NOT EXISTS ${userPrefix}_mutual_graph_meta (friend_id TEXT PRIMARY KEY, last_fetched_at TEXT, opted_out INTEGER DEFAULT 0)`
    ];
}

const GLOBAL_TABLE_STATEMENTS = Object.freeze([
    `CREATE TABLE IF NOT EXISTS gamelog_location (id INTEGER PRIMARY KEY, created_at TEXT, location TEXT, world_id TEXT, world_name TEXT, time INTEGER, group_name TEXT, UNIQUE(created_at, location))`,
    `CREATE INDEX IF NOT EXISTS gamelog_location_created_at_idx ON gamelog_location (created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_gamelog_location_world_created ON gamelog_location (world_id, created_at)`,
    `CREATE TABLE IF NOT EXISTS gamelog_join_leave (id INTEGER PRIMARY KEY, created_at TEXT, type TEXT, display_name TEXT, location TEXT, user_id TEXT, time INTEGER, UNIQUE(created_at, type, display_name))`,
    `CREATE INDEX IF NOT EXISTS idx_gamelog_jl_location ON gamelog_join_leave (location)`,
    `CREATE INDEX IF NOT EXISTS idx_gamelog_jl_user_created ON gamelog_join_leave (user_id, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_gamelog_jl_display_created ON gamelog_join_leave (display_name, created_at)`,
    `CREATE TABLE IF NOT EXISTS gamelog_portal_spawn (id INTEGER PRIMARY KEY, created_at TEXT, display_name TEXT, location TEXT, user_id TEXT, instance_id TEXT, world_name TEXT, UNIQUE(created_at, display_name))`,
    `CREATE TABLE IF NOT EXISTS gamelog_video_play (id INTEGER PRIMARY KEY, created_at TEXT, video_url TEXT, video_name TEXT, video_id TEXT, location TEXT, display_name TEXT, user_id TEXT, UNIQUE(created_at, video_url))`,
    `CREATE TABLE IF NOT EXISTS gamelog_resource_load (id INTEGER PRIMARY KEY, created_at TEXT, resource_url TEXT, resource_type TEXT, location TEXT, UNIQUE(created_at, resource_url))`,
    `CREATE TABLE IF NOT EXISTS gamelog_event (id INTEGER PRIMARY KEY, created_at TEXT, data TEXT, UNIQUE(created_at, data))`,
    `CREATE TABLE IF NOT EXISTS gamelog_external (id INTEGER PRIMARY KEY, created_at TEXT, message TEXT, display_name TEXT, user_id TEXT, location TEXT, UNIQUE(created_at, message))`,
    `CREATE TABLE IF NOT EXISTS cache_avatar (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)`,
    `CREATE TABLE IF NOT EXISTS cache_world (id TEXT PRIMARY KEY, added_at TEXT, author_id TEXT, author_name TEXT, created_at TEXT, description TEXT, image_url TEXT, name TEXT, release_status TEXT, thumbnail_image_url TEXT, updated_at TEXT, version INTEGER)`,
    `CREATE TABLE IF NOT EXISTS favorite_world (id INTEGER PRIMARY KEY, created_at TEXT, world_id TEXT, group_name TEXT)`,
    `CREATE TABLE IF NOT EXISTS favorite_avatar (id INTEGER PRIMARY KEY, created_at TEXT, avatar_id TEXT, group_name TEXT)`,
    `CREATE TABLE IF NOT EXISTS favorite_friend (id INTEGER PRIMARY KEY, created_at TEXT, user_id TEXT, group_name TEXT)`,
    `CREATE TABLE IF NOT EXISTS memos (user_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)`,
    `CREATE TABLE IF NOT EXISTS world_memos (world_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)`,
    `CREATE TABLE IF NOT EXISTS avatar_memos (avatar_id TEXT PRIMARY KEY, edited_at TEXT, memo TEXT)`,
    `CREATE TABLE IF NOT EXISTS avatar_tags (avatar_id TEXT NOT NULL, tag TEXT NOT NULL, color TEXT, PRIMARY KEY (avatar_id, tag))`
]);

export {
    GLOBAL_TABLE_STATEMENTS,
    buildInitUserTableStatements,
    buildUserTableName,
    normalizeUserTablePrefix
};
