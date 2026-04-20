import { parseLocation } from '@/shared/utils/locationParser.js';

import sqliteRepository from './sqliteRepository.js';

function normalizeString(value) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeInstanceActivityRow(row) {
    if (Array.isArray(row)) {
        return {
            id: row[0] ?? '',
            created_at: row[1] ?? '',
            type: row[2] ?? '',
            display_name: row[3] ?? '',
            location: row[4] ?? '',
            user_id: row[5] ?? '',
            time: Number(row[6] ?? 0) || 0
        };
    }

    return {
        id: row?.id ?? '',
        created_at: row?.created_at ?? '',
        type: row?.type ?? '',
        display_name: row?.display_name ?? row?.displayName ?? '',
        location: row?.location ?? '',
        user_id: row?.user_id ?? row?.userId ?? '',
        time: Number(row?.time ?? 0) || 0
    };
}

function normalizeWorldCacheRow(row) {
    if (Array.isArray(row)) {
        return {
            id: row[0] ?? '',
            authorId: row[2] ?? '',
            authorName: row[3] ?? '',
            created_at: row[4] ?? '',
            description: row[5] ?? '',
            imageUrl: row[6] ?? '',
            name: row[7] ?? '',
            releaseStatus: row[8] ?? '',
            thumbnailImageUrl: row[9] ?? '',
            updated_at: row[10] ?? '',
            version: row[11] ?? 0
        };
    }

    return {
        id: row?.id ?? '',
        authorId: row?.author_id ?? row?.authorId ?? '',
        authorName: row?.author_name ?? row?.authorName ?? '',
        created_at: row?.created_at ?? '',
        description: row?.description ?? '',
        imageUrl: row?.image_url ?? row?.imageUrl ?? '',
        name: row?.name ?? '',
        releaseStatus: row?.release_status ?? row?.releaseStatus ?? '',
        thumbnailImageUrl:
            row?.thumbnail_image_url ?? row?.thumbnailImageUrl ?? '',
        updated_at: row?.updated_at ?? '',
        version: row?.version ?? 0
    };
}

function isValidActivityLocation(location) {
    const normalizedLocation = normalizeString(location);
    if (!normalizedLocation) {
        return false;
    }
    return !parseLocation(normalizedLocation).isTraveling;
}

async function getAvailableDates(userId) {
    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId) {
        return [];
    }

    const rows = await sqliteRepository.query(
        `SELECT created_at
         FROM gamelog_join_leave
         WHERE user_id = @userId
         ORDER BY created_at DESC`,
        {
            '@userId': normalizedUserId
        }
    );

    return Array.isArray(rows)
        ? rows
              .map((row) =>
                  Array.isArray(row)
                      ? row[0]
                      : (row?.created_at ?? row?.[0] ?? '')
              )
              .filter(Boolean)
        : [];
}

async function getInstanceActivityRows(startDate, endDate) {
    const rows = await sqliteRepository.query(
        `SELECT *
         FROM gamelog_join_leave
         WHERE type = 'OnPlayerLeft'
           AND (
             strftime('%Y-%m-%dT%H:%M:%SZ', created_at, '-' || (time * 1.0 / 1000) || ' seconds')
                BETWEEN @utc_start_date AND @utc_end_date
             OR created_at BETWEEN @utc_start_date AND @utc_end_date
           )
         ORDER BY created_at ASC, id ASC`,
        {
            '@utc_start_date': startDate,
            '@utc_end_date': endDate
        }
    );

    return Array.isArray(rows)
        ? rows
              .map(normalizeInstanceActivityRow)
              .filter((row) => isValidActivityLocation(row.location))
        : [];
}

async function getWorldSummariesByIds(worldIds) {
    const ids = Array.from(
        new Set(
            (Array.isArray(worldIds) ? worldIds : [])
                .map(normalizeString)
                .filter(Boolean)
        )
    );
    if (!ids.length) {
        return {};
    }

    const params = {};
    const placeholders = ids.map((id, index) => {
        const key = `@worldId${index}`;
        params[key] = id;
        return key;
    });

    const rows = await sqliteRepository.query(
        `SELECT *
         FROM cache_world
         WHERE id IN (${placeholders.join(', ')})`,
        params
    );

    const map = {};
    if (Array.isArray(rows)) {
        for (const row of rows) {
            const world = normalizeWorldCacheRow(row);
            if (world.id) {
                map[world.id] = world;
            }
        }
    }

    const locationRows = await sqliteRepository.query(
        `SELECT gl.world_id, gl.world_name
         FROM gamelog_location gl
         INNER JOIN (
             SELECT world_id, MAX(id) AS max_id
             FROM gamelog_location
             WHERE world_id IN (${placeholders.join(', ')})
               AND world_name IS NOT NULL
               AND world_name != ''
             GROUP BY world_id
         ) latest
             ON latest.world_id = gl.world_id
            AND latest.max_id = gl.id`,
        params
    );

    if (Array.isArray(locationRows)) {
        for (const row of locationRows) {
            const worldId = normalizeString(
                Array.isArray(row) ? row[0] : (row?.world_id ?? row?.worldId)
            );
            const worldName = normalizeString(
                Array.isArray(row)
                    ? row[1]
                    : (row?.world_name ?? row?.worldName)
            );
            if (!worldId || !worldName || map[worldId]?.name) {
                continue;
            }
            map[worldId] = {
                ...(map[worldId] || {}),
                id: worldId,
                name: worldName
            };
        }
    }

    return map;
}

const instanceActivityRepository = {
    getAvailableDates,
    getInstanceActivityRows,
    getWorldSummariesByIds
};

export { getAvailableDates, getInstanceActivityRows, getWorldSummariesByIds };
export default instanceActivityRepository;
