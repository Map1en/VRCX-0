import type { FeedReadModelResult } from '@/domain/feed/readModel';
import type { FeedRowOutput as FeedRow } from '@/platform/tauri/bindings';
import {
    isFeedFilterType,
    type FeedFilterType
} from '@/repositories/feedRepository';
import { useFeedLiveStore } from '@/state/feedLiveStore';
import type {
    FeedLiveEntry,
    FeedLiveEntryPayload,
    FeedLivePatch
} from '@/state/feedLiveTypes';

type FeedLiveMergeOptions = {
    rows: FeedRow[];
    userId: string;
    filters?: readonly FeedFilterType[];
    favoriteUserIds?: readonly string[];
    scopedUserIds?: readonly string[];
    excludedFavoriteUserIds?: readonly string[];
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    favoritesOnly?: boolean;
    maxRows: number;
};

export type FeedLiveMergeOptionsBuilder = (input: {
    liveEntries: FeedLiveEntry[];
    rows: FeedRow[];
}) => FeedLiveMergeOptions;

type FeedDelta =
    | { kind: 'upsert'; sequence: number; entry: FeedLiveEntry }
    | { kind: 'patch'; sequence: number; patch: FeedLivePatch };

function normalizeText(value: unknown): string {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function optionalText(value: unknown): string | undefined {
    const normalized = normalizeText(value);
    return normalized || undefined;
}

function optionalNumber(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value !== 'string' || !value.trim()) {
        return undefined;
    }
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
}

function optionalStringList(value: unknown): string[] | undefined {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : undefined;
}

function liveEntryRow(entry: FeedLiveEntryPayload): FeedRow {
    const row: FeedRow = {
        created_at: optionalText(entry.created_at),
        type: optionalText(entry.type),
        ownerUserId: optionalText(entry.ownerUserId)
    };
    if (entry.type !== 'instance.closed') {
        row.userId = optionalText(entry.userId);
        row.displayName = optionalText(entry.displayName);
    }
    switch (entry.type) {
        case 'Online':
        case 'Offline':
            row.location = optionalText(entry.location);
            row.worldName = optionalText(entry.worldName);
            row.groupName = optionalText(entry.groupName);
            row.time = optionalNumber(entry.time);
            break;
        case 'GPS':
            row.location = optionalText(entry.location);
            row.worldName = optionalText(entry.worldName);
            row.previousLocation = optionalText(entry.previousLocation);
            row.groupName = optionalText(entry.groupName);
            row.time = optionalNumber(entry.time);
            break;
        case 'Status':
            row.status = optionalText(entry.status);
            row.statusDescription = optionalText(entry.statusDescription);
            row.previousStatus = optionalText(entry.previousStatus);
            row.previousStatusDescription = optionalText(
                entry.previousStatusDescription
            );
            break;
        case 'Bio':
            row.bio = optionalText(entry.bio);
            row.previousBio = optionalText(entry.previousBio);
            break;
        case 'Avatar':
            row.ownerId = optionalText(entry.ownerId);
            row.previousOwnerId = optionalText(entry.previousOwnerId);
            row.avatarName = optionalText(entry.avatarName);
            row.previousAvatarName = optionalText(entry.previousAvatarName);
            row.currentAvatarImageUrl = optionalText(
                entry.currentAvatarImageUrl
            );
            row.currentAvatarThumbnailImageUrl = optionalText(
                entry.currentAvatarThumbnailImageUrl
            );
            row.previousCurrentAvatarImageUrl = optionalText(
                entry.previousCurrentAvatarImageUrl
            );
            row.previousCurrentAvatarThumbnailImageUrl = optionalText(
                entry.previousCurrentAvatarThumbnailImageUrl
            );
            row.currentAvatarTags = optionalStringList(entry.currentAvatarTags);
            row.previousCurrentAvatarTags = optionalStringList(
                entry.previousCurrentAvatarTags
            );
            break;
        case 'OnPlayerJoining':
        case 'instance.closed':
            row.location = optionalText(entry.location);
            row.worldName = optionalText(entry.worldName);
            break;
        default:
            break;
    }
    return row;
}

function feedRowContentKey(row: FeedRow): string {
    return `${row.type ?? ''}:${row.created_at ?? ''}:${row.userId ?? ''}:${row.location ?? ''}`;
}

function feedRowCorrectionId(row: FeedRow): string {
    if (row.rowId != null) {
        return row.sourceRank != null
            ? `row:${row.type ?? ''}:${row.sourceRank}:${row.rowId}`
            : `row:${row.type ?? ''}:${row.rowId}`;
    }
    return `${row.type ?? ''}:${row.created_at ?? ''}:${row.userId ?? ''}:${row.location ?? ''}:`;
}

function feedSearchMatches(row: FeedRow, search: string): boolean {
    const query = search.trim().toUpperCase();
    if (!query) {
        return true;
    }
    if (
        (query.startsWith('WRLD_') || query.startsWith('GRP_')) &&
        normalizeText(row.location).toUpperCase().includes(query)
    ) {
        return true;
    }
    return [
        row.displayName,
        row.worldName,
        row.groupName,
        row.status,
        row.statusDescription,
        row.previousStatus,
        row.previousStatusDescription,
        row.bio,
        row.previousBio,
        row.avatarName
    ].some((value) => normalizeText(value).toUpperCase().includes(query));
}

function liveRowMatches(
    row: FeedRow,
    options: FeedLiveMergeOptions,
    favoriteUserIds: ReadonlySet<string>,
    scopedUserIds: ReadonlySet<string>,
    excludedUserIds: ReadonlySet<string>
): boolean {
    const entryType = normalizeText(row.type);
    if (!isFeedFilterType(entryType)) {
        return false;
    }
    const currentUserId = normalizeText(options.userId);
    const ownerUserId = normalizeText(row.ownerUserId);
    if (ownerUserId && ownerUserId !== currentUserId) {
        return false;
    }
    if (options.filters?.length && !options.filters.includes(entryType)) {
        return false;
    }
    const userId = normalizeText(row.userId);
    if (options.favoritesOnly && !favoriteUserIds.has(userId)) {
        return false;
    }
    if (scopedUserIds.size && !scopedUserIds.has(userId)) {
        return false;
    }
    if (userId && excludedUserIds.has(userId)) {
        return false;
    }
    const createdAt = normalizeText(row.created_at);
    if (options.dateFrom && createdAt && createdAt < options.dateFrom) {
        return false;
    }
    if (options.dateTo && createdAt && createdAt > options.dateTo) {
        return false;
    }
    return feedSearchMatches(row, options.search ?? '');
}

function mergeFeedDeltas(
    options: FeedLiveMergeOptions,
    liveEntries: FeedLiveEntry[],
    livePatches: FeedLivePatch[],
    minLiveSequence: number
): FeedReadModelResult<FeedRow> {
    const favoriteUserIds = new Set(options.favoriteUserIds ?? []);
    const scopedUserIds = new Set(options.scopedUserIds ?? []);
    const excludedUserIds = new Set(options.excludedFavoriteUserIds ?? []);
    const deltas: FeedDelta[] = [
        ...liveEntries.map((entry) => ({
            kind: 'upsert' as const,
            sequence: entry.sequence,
            entry
        })),
        ...livePatches.map((patch) => ({
            kind: 'patch' as const,
            sequence: patch.sequence,
            patch
        }))
    ]
        .filter((delta) => delta.sequence > minLiveSequence)
        .sort((left, right) => left.sequence - right.sequence);
    let rows = options.rows;
    let maxSequence = minLiveSequence;
    for (const delta of deltas) {
        maxSequence = Math.max(maxSequence, delta.sequence);
        if (delta.kind === 'patch') {
            rows = rows.map((row) =>
                feedRowCorrectionId(row) === delta.patch.id
                    ? {
                          ...row,
                          displayName:
                              optionalText(delta.patch.fields.displayName) ??
                              row.displayName,
                          worldName:
                              optionalText(delta.patch.fields.worldName) ??
                              row.worldName
                      }
                    : row
            );
            continue;
        }
        const row = liveEntryRow(delta.entry.entry);
        if (
            !liveRowMatches(
                row,
                options,
                favoriteUserIds,
                scopedUserIds,
                excludedUserIds
            )
        ) {
            continue;
        }
        const key = feedRowContentKey(row);
        rows = [
            row,
            ...rows.filter((entry) => feedRowContentKey(entry) !== key)
        ];
    }
    return {
        rows: rows.slice(0, Math.max(0, options.maxRows)),
        maxSequence
    };
}

export async function mergeFeedRowsWithLiveEntries({
    buildMergeOptions,
    minLiveSequence,
    requestIsCurrent,
    rows
}: {
    buildMergeOptions: FeedLiveMergeOptionsBuilder;
    minLiveSequence: number;
    requestIsCurrent(): boolean;
    rows: FeedRow[];
}): Promise<FeedReadModelResult<FeedRow> | null> {
    if (!requestIsCurrent()) {
        return null;
    }
    const snapshot = useFeedLiveStore.getState();
    return mergeFeedRowsWithSnapshot({
        buildMergeOptions,
        liveEntries: snapshot.entries,
        livePatches: snapshot.patches,
        minLiveSequence,
        rows
    });
}

export function mergeFeedRowsWithSnapshot({
    buildMergeOptions,
    liveEntries,
    livePatches,
    minLiveSequence,
    rows
}: {
    buildMergeOptions: FeedLiveMergeOptionsBuilder;
    liveEntries: FeedLiveEntry[];
    livePatches: FeedLivePatch[];
    minLiveSequence: number;
    rows: FeedRow[];
}): FeedReadModelResult<FeedRow> {
    return mergeFeedDeltas(
        buildMergeOptions({
            liveEntries,
            rows
        }),
        liveEntries,
        livePatches,
        minLiveSequence
    );
}

export async function prepareFeedRowsForCommit({
    buildMergeOptions,
    onMergeRound,
    requestIsCurrent,
    result
}: {
    buildMergeOptions: FeedLiveMergeOptionsBuilder;
    onMergeRound(): void;
    requestIsCurrent(): boolean;
    result: FeedReadModelResult<FeedRow>;
}): Promise<FeedReadModelResult<FeedRow> | null> {
    let nextResult = result;
    while (requestIsCurrent()) {
        onMergeRound();
        if (useFeedLiveStore.getState().version <= nextResult.maxSequence) {
            return nextResult;
        }
        const mergedResult = await mergeFeedRowsWithLiveEntries({
            buildMergeOptions,
            minLiveSequence: nextResult.maxSequence,
            requestIsCurrent,
            rows: nextResult.rows
        });
        if (!mergedResult) {
            return null;
        }
        nextResult = mergedResult;
    }
    return null;
}
