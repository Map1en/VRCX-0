import {
    commands,
    type InstanceActivityRowOutput,
    type WorldSummaryOutput
} from '@/platform/tauri/bindings';

export interface InstanceActivityRow {
    id: number;
    created_at: string;
    type: string;
    display_name: string;
    location: string;
    user_id: string;
    time: number;
}

type WorldSummary = WorldSummaryOutput;

function normalizeInstanceActivityRow(
    row: InstanceActivityRowOutput
): InstanceActivityRow {
    return {
        id: row.id,
        created_at: row.createdAt,
        type: row.type,
        display_name: row.displayName,
        location: row.location,
        user_id: row.userId,
        time: row.time
    };
}

async function getAvailableDates(userId: string): Promise<string[]> {
    const normalizedUserId = userId.trim();
    if (!normalizedUserId) {
        return [];
    }

    const rows = await commands.appInstanceActivityDatesGet(normalizedUserId);
    return rows.filter(Boolean);
}

async function getInstanceActivityRows(
    startDate: string,
    endDate: string
): Promise<InstanceActivityRow[]> {
    const rows = await commands.appInstanceActivityRowsGet(startDate, endDate);

    return rows.map((row) => normalizeInstanceActivityRow(row));
}

async function getWorldSummariesByIds(
    worldIds: readonly string[]
): Promise<Record<string, WorldSummary>> {
    const ids = Array.from(
        new Set(worldIds.map((worldId) => worldId.trim()).filter(Boolean))
    );
    if (!ids.length) {
        return {};
    }

    const rows = await commands.appWorldSummariesGet(ids);

    const map: Record<string, WorldSummary> = {};
    for (const [worldId, row] of Object.entries(rows)) {
        if (!row) {
            continue;
        }
        const world = {
            ...row,
            id: row.id || worldId
        };
        if (!world.id) {
            continue;
        }
        map[world.id] = world;
    }

    return map;
}

const instanceActivityRepository = {
    getAvailableDates,
    getInstanceActivityRows,
    getWorldSummariesByIds
};

export default instanceActivityRepository;
