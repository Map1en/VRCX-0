import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { FavoriteEntityDetail } from '@/domain/favorites/types';
import type { LoadStatus } from '@/domain/shared/types';
import {
    commands,
    type FavoriteDetailsHydrateInput,
    type FavoriteDetailsHydrateKind,
    type FavoriteDetailsHydrateOutput
} from '@/platform/tauri/bindings';
import { isRecord } from '@/shared/utils/record';
import { useFavoriteRevisionStore } from '@/state/favoriteRevisionStore';
import { useRuntimeStore } from '@/state/runtimeStore';

type FavoriteRemoteDetailKind = FavoriteDetailsHydrateKind;

type FavoriteRemoteEntityDetail = FavoriteEntityDetail & {
    id: string;
};

type FavoriteRemoteDetailsById = Record<string, FavoriteRemoteEntityDetail>;

interface UseFavoriteRemoteDetailsOptions {
    type: FavoriteRemoteDetailKind;
    favoriteIds?: string[];
    requestedIds?: string[];
    avatarTags?: string[];
    groupTags?: string[];
    cacheKey?: string;
    enabled?: boolean;
    refreshToken?: number;
}

function favoriteRemoteDetailsLoadingDetail(
    type: FavoriteRemoteDetailKind
): string {
    return type === 'avatar'
        ? 'Loading remote avatar details.'
        : 'Loading remote world details.';
}

const inflightHydrations = new Map<
    string,
    Promise<Awaited<ReturnType<typeof commands.appFavoriteDetailsHydrate>>>
>();

function hydrateFavoriteDetails(
    requestKey: string,
    input: FavoriteDetailsHydrateInput
) {
    const inflight = inflightHydrations.get(requestKey);
    if (inflight) {
        return inflight;
    }
    const request = commands.appFavoriteDetailsHydrate(input).finally(() => {
        inflightHydrations.delete(requestKey);
    });
    inflightHydrations.set(requestKey, request);
    return request;
}

function normalizeValues(values: readonly string[]): string[] {
    return Array.from(
        new Set(values.map((value) => value.trim()).filter(Boolean))
    );
}

function normalizeEntityId(value: unknown) {
    return typeof value === 'string'
        ? value.trim()
        : String(value ?? '').trim();
}

function normalizeOptionalString(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const normalized = value.trim();
    return normalized || undefined;
}

interface RemoteDetailsState {
    requestKey: string;
    status: LoadStatus;
    detail: string;
    data: FavoriteRemoteDetailsById;
    availabilityById: Record<string, string>;
    lastLoadedAt: string | null;
}

interface RetainedEntry {
    detail?: FavoriteRemoteEntityDetail;
    availability?: string;
}

interface RetainedDetails {
    refreshKey: string;
    entries: Map<string, RetainedEntry>;
}

const RETAINED_DETAIL_LIMIT = 600;

function buildRetainedDetails(refreshKey: string): RetainedDetails {
    return {
        refreshKey,
        entries: new Map()
    };
}

function retainDetails(
    retained: RetainedDetails,
    refreshKey: string,
    requestedIds: readonly string[],
    data: FavoriteRemoteDetailsById,
    availabilityById: Record<string, string>
): RetainedDetails {
    const next =
        retained.refreshKey === refreshKey
            ? retained
            : buildRetainedDetails(refreshKey);
    for (const id of requestedIds) {
        next.entries.delete(id);
        const detail = data[id];
        const availability = availabilityById[id];
        if (detail || availability) {
            next.entries.set(id, { detail, availability });
        }
    }
    while (next.entries.size > RETAINED_DETAIL_LIMIT) {
        const oldest = next.entries.keys().next().value;
        if (oldest === undefined) {
            break;
        }
        next.entries.delete(oldest);
    }
    return next;
}

function projectRetainedDetails(retained: RetainedDetails) {
    const data: FavoriteRemoteDetailsById = {};
    const availabilityById: Record<string, string> = {};
    for (const [id, entry] of retained.entries) {
        if (entry.detail) {
            data[id] = entry.detail;
        }
        if (entry.availability) {
            availabilityById[id] = entry.availability;
        }
    }
    return { data, availabilityById };
}

function buildInitialState(
    requestKey: string = '',
    status: LoadStatus = 'idle',
    detail: string = '',
    retained?: RetainedDetails
): RemoteDetailsState {
    const projected = retained
        ? projectRetainedDetails(retained)
        : { data: {}, availabilityById: {} };
    return {
        requestKey,
        status,
        detail,
        data: projected.data,
        availabilityById: projected.availabilityById,
        lastLoadedAt: null
    };
}

function mapAvailabilityById(
    availabilityById: FavoriteDetailsHydrateOutput['availabilityById']
): Record<string, string> {
    const byId: Record<string, string> = {};
    for (const [key, value] of Object.entries(availabilityById)) {
        const id = normalizeEntityId(key);
        const status = normalizeOptionalString(value);
        if (id && status) {
            byId[id] = status;
        }
    }
    return byId;
}

function normalizeFavoriteEntityDetail(
    value: unknown
): FavoriteRemoteEntityDetail | null {
    if (!isRecord(value)) {
        return null;
    }
    const id = normalizeEntityId(value.id);
    if (!id) {
        return null;
    }
    const detail: FavoriteRemoteEntityDetail = {
        ...value,
        id
    };
    if (Array.isArray(value.tags)) {
        detail.tags = normalizeValues(value.tags);
    } else {
        delete detail.tags;
    }

    const releaseStatus = normalizeOptionalString(value.releaseStatus);
    if (releaseStatus) {
        detail.releaseStatus = releaseStatus;
    } else {
        delete detail.releaseStatus;
    }

    const thumbnailImageUrl = normalizeOptionalString(value.thumbnailImageUrl);
    if (thumbnailImageUrl) {
        detail.thumbnailImageUrl = thumbnailImageUrl;
    } else {
        delete detail.thumbnailImageUrl;
    }

    const imageUrl = normalizeOptionalString(value.imageUrl);
    if (imageUrl) {
        detail.imageUrl = imageUrl;
    } else {
        delete detail.imageUrl;
    }

    return detail;
}

function mapDetailsById(detailsById: unknown): FavoriteRemoteDetailsById {
    const byId: FavoriteRemoteDetailsById = {};
    if (!isRecord(detailsById)) {
        return byId;
    }
    for (const value of Object.values(detailsById)) {
        const detail = normalizeFavoriteEntityDetail(value);
        if (!detail) {
            continue;
        }
        byId[detail.id] = detail;
    }
    return byId;
}

export function useFavoriteRemoteDetails({
    type,
    favoriteIds = [],
    requestedIds = favoriteIds,
    avatarTags = [],
    groupTags = [],
    cacheKey = '',
    enabled = true,
    refreshToken = 0
}: UseFavoriteRemoteDetailsOptions) {
    const currentUserId = useRuntimeStore((state) => state.auth.currentUserId);
    const endpoint = useRuntimeStore((state) => state.auth.currentUserEndpoint);
    const remoteDetailsRevision = useFavoriteRevisionStore(
        (state) => state.remoteDetailsRevisionByKind[type]
    );
    const worldDetailsRevision = useFavoriteRevisionStore(
        (state) => state.worldDetailsRevision
    );
    const normalizedIds = useMemo(
        () => normalizeValues(favoriteIds),
        [favoriteIds]
    );
    const normalizedRequestedIds = useMemo(
        () => normalizeValues(requestedIds),
        [requestedIds]
    );
    const normalizedTags = useMemo(
        () => normalizeValues(avatarTags),
        [avatarTags]
    );
    const normalizedGroupTags = useMemo(
        () => normalizeValues(groupTags),
        [groupTags]
    );
    const refreshKey = [
        type,
        currentUserId || '',
        endpoint || '',
        cacheKey,
        String(refreshToken),
        String(remoteDetailsRevision),
        type === 'world' ? String(worldDetailsRevision) : ''
    ].join('::');
    const requestKey = [
        refreshKey,
        normalizedIds.join('|'),
        normalizedRequestedIds.join('|'),
        normalizedTags.join('|'),
        normalizedGroupTags.join('|')
    ].join('::');
    const hasIds = normalizedRequestedIds.length > 0;
    const [stateEntry, setStateEntry] = useState(() => ({
        refreshKey,
        value: buildInitialState()
    }));
    const state = stateEntry.value;
    const retainedRef = useRef(buildRetainedDetails(refreshKey));
    const requestParams = {
        ids: normalizedIds,
        requestedIds: normalizedRequestedIds,
        refreshKey,
        tags: normalizedTags,
        groupTags: normalizedGroupTags
    };
    const requestParamsRef = useRef(requestParams);
    useLayoutEffect(() => {
        requestParamsRef.current = requestParams;
    });

    useEffect(() => {
        if (retainedRef.current.refreshKey !== refreshKey) {
            retainedRef.current = buildRetainedDetails(refreshKey);
        }
        const setState = (value: RemoteDetailsState) =>
            setStateEntry({ refreshKey, value });
        if (!enabled || !hasIds) {
            setState(
                buildInitialState(
                    requestKey,
                    hasIds ? 'idle' : 'ready',
                    '',
                    retainedRef.current
                )
            );
            return;
        }

        let active = true;
        const requested = requestParamsRef.current.requestedIds;
        setState(
            buildInitialState(
                requestKey,
                'running',
                favoriteRemoteDetailsLoadingDetail(type),
                retainedRef.current
            )
        );
        hydrateFavoriteDetails(requestKey, {
            kind: type,
            favoriteIds: requestParamsRef.current.ids,
            requestedIds: requested,
            avatarTags: type === 'avatar' ? requestParamsRef.current.tags : [],
            groupTags:
                type === 'world' ? requestParamsRef.current.groupTags : []
        })
            .then((output) => {
                if (!active) {
                    return;
                }
                const loaded = mapDetailsById(output.detailsById);
                const availabilityById = mapAvailabilityById(
                    output.availabilityById
                );
                const retained = retainDetails(
                    retainedRef.current,
                    requestParamsRef.current.refreshKey,
                    requested,
                    loaded,
                    availabilityById
                );
                retainedRef.current = retained;
                setState({
                    ...buildInitialState(
                        requestKey,
                        'ready',
                        type === 'avatar'
                            ? `Loaded remote avatar details for ${Object.keys(loaded).length} favorites.`
                            : `Loaded remote world details for ${Object.keys(loaded).length} favorites.`,
                        retained
                    ),
                    lastLoadedAt: output.fetchedAt
                });
            })
            .catch((error: unknown) => {
                if (!active) {
                    return;
                }
                setState({
                    ...buildInitialState(
                        requestKey,
                        'error',
                        error instanceof Error
                            ? error.message
                            : `Failed to load remote ${type} favorites.`,
                        retainedRef.current
                    ),
                    lastLoadedAt: new Date().toISOString()
                });
            });

        return () => {
            active = false;
        };
    }, [enabled, hasIds, refreshKey, requestKey, type]);

    if (state.requestKey === requestKey) {
        return state;
    }
    const pendingStatus = !hasIds ? 'ready' : enabled ? 'running' : 'idle';
    const retainedState =
        stateEntry.refreshKey === refreshKey ? state : buildInitialState();
    return {
        ...buildInitialState(
            requestKey,
            pendingStatus,
            pendingStatus === 'running'
                ? favoriteRemoteDetailsLoadingDetail(type)
                : ''
        ),
        data: retainedState.data,
        availabilityById: retainedState.availabilityById
    };
}
