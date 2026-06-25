import { commands } from '@/platform/tauri/bindings';
import { normalizeString } from '@/shared/utils/string';

type SQLiteLikeRow = Record<string, unknown> | unknown[];

interface InstanceActivityRow {
    id: unknown;
    created_at: unknown;
    type: string;
    display_name: unknown;
    location: string;
    user_id: unknown;
    time: number;
}

interface WorldSummary {
    id: string;
    authorId?: unknown;
    authorName?: unknown;
    created_at?: unknown;
    description?: unknown;
    imageUrl?: unknown;
    name?: string;
    releaseStatus?: unknown;
    thumbnailImageUrl?: unknown;
    updated_at?: unknown;
    version?: unknown;
}

function normalizeInstanceActivityRow(row: SQLiteLikeRow): InstanceActivityRow {
    if (Array.isArray(row)) {
        return {
            id: row[0] ?? '',
            created_at: row[1] ?? '',
            type: normalizeString(row[2]),
            display_name: row[3] ?? '',
            location: normalizeString(row[4]),
            user_id: row[5] ?? '',
            time: Number(row[6] ?? 0) || 0
        };
    }

    return {
        id: row?.id ?? '',
        created_at: row?.created_at ?? row?.createdAt ?? '',
        type: normalizeString(row?.type),
        display_name: row?.display_name ?? row?.displayName ?? '',
        location: normalizeString(row?.location),
        user_id: row?.user_id ?? row?.userId ?? '',
        time: Number(row?.time ?? 0) || 0
    };
}

function normalizeWorldCacheRow(row: SQLiteLikeRow): WorldSummary {
    if (Array.isArray(row)) {
        return {
            id: normalizeString(row[0]),
            authorId: row[2] ?? '',
            authorName: row[3] ?? '',
            created_at: row[4] ?? '',
            description: row[5] ?? '',
            imageUrl: row[6] ?? '',
            name: normalizeString(row[7]),
            releaseStatus: row[8] ?? '',
            thumbnailImageUrl: row[9] ?? '',
            updated_at: row[10] ?? '',
            version: row[11] ?? 0
        };
    }

    return {
        id: normalizeString(row?.id),
        authorId: row?.author_id ?? row?.authorId ?? '',
        authorName: row?.author_name ?? row?.authorName ?? '',
        created_at: row?.created_at ?? '',
        description: row?.description ?? '',
        imageUrl: row?.image_url ?? row?.imageUrl ?? '',
        name: normalizeString(row?.name),
        releaseStatus: row?.release_status ?? row?.releaseStatus ?? '',
        thumbnailImageUrl:
            row?.thumbnail_image_url ?? row?.thumbnailImageUrl ?? '',
        updated_at: row?.updated_at ?? '',
        version: row?.version ?? 0
    };
}

async function getAvailableDates(userId: unknown): Promise<unknown[]> {
    const normalizedUserId = normalizeString(userId);
    if (!normalizedUserId) {
        return [];
    }

    const rows = await commands.appInstanceActivityDatesGet(normalizedUserId);

    return Array.isArray(rows) ? rows.filter(Boolean) : [];
}

async function getInstanceActivityRows(
    startDate: string,
    endDate: string
): Promise<InstanceActivityRow[]> {
    const rows = await commands.appInstanceActivityRowsGet(startDate, endDate);

    return Array.isArray(rows)
        ? rows.map((row) => normalizeInstanceActivityRow(row))
        : [];
}

async function getWorldSummariesByIds(
    worldIds: unknown
): Promise<Record<string, WorldSummary>> {
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

    const rows = (await commands.appWorldSummariesGet(ids)) as Record<
        string,
        SQLiteLikeRow
    >;

    const map: Record<string, WorldSummary> = {};
    for (const [worldId, row] of Object.entries(rows || {})) {
        const world = normalizeWorldCacheRow(row);
        if (!world.id) {
            world.id = worldId;
        }
        if (world.id) {
            map[world.id] = world;
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
