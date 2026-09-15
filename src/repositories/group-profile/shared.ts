import type {
    GroupAuditLogRow,
    GroupGalleryFileRow,
    GroupInstanceRecord,
    GroupMemberRow
} from '@/domain/entities/group';
import type {
    GroupMemberPatch,
    GroupMemberSort,
    GroupPostMutation,
    GroupJoinRequestAction,
    HttpApiExecuteResponse
} from '@/platform/tauri/bindings';
import { isRecord } from '@/shared/utils/record';
import { replaceBioSymbols } from '@/shared/utils/string';

import {
    collectPages as collectBoundedPages,
    type CollectPagesOptions,
    type PageRequest
} from '../pagination';
import { unwrapVrchatResponse } from '../vrchatRequest';

export type GroupRecord = Record<string, unknown>;

export type GroupUserGroupRow = GroupRecord & {
    bannerId?: string;
    bannerUrl?: string;
    description?: string;
    discriminator?: string;
    groupId: string;
    iconId?: string;
    iconUrl?: string;
    id: string;
    isRepresenting?: boolean;
    lastPostCreatedAt?: string | null;
    lastPostReadAt?: string | null;
    memberCount?: number;
    memberVisibility?: string;
    mutualGroup?: boolean;
    name?: string;
    ownerId?: string;
    privacy?: string;
    shortCode?: string;
};

export type GroupInstancesResponse =
    | GroupInstanceRecord[]
    | (GroupRecord & {
          fetchedAt?: string;
          instances?: GroupInstanceRecord[];
      });

export type GroupLogsPage = {
    hasNext: boolean;
    results: GroupAuditLogRow[];
    totalCount: number | null;
};

export type GroupModerationRow = Partial<GroupMemberRow> & {
    groupId: string;
    id: string;
    userId: string;
};

export type VrchatApiResult = HttpApiExecuteResponse;

export type { CollectPagesOptions, GroupGalleryFileRow, PageRequest };

export interface GroupProfileInput {
    groupId?: string;
    includeRoles?: boolean;
    force?: boolean;
    dialog?: boolean;
}

export interface GroupIdInput {
    groupId?: string;
}

export interface GroupUserInput extends GroupIdInput {
    userId?: string;
}

export interface GroupUserRoleInput extends GroupUserInput {
    roleId?: string;
}

export interface GroupPostInput extends GroupIdInput {
    postId?: string;
}

export interface GroupPostMutationInput extends GroupPostInput {
    params: GroupPostMutation;
}

export interface GroupPageInput extends GroupIdInput {
    n?: number;
    offset?: number;
}

export interface GroupMembersInput extends GroupPageInput {
    sort?: GroupMemberSort;
    roleId?: string;
    force?: boolean;
}

export interface GroupMembersSearchInput extends GroupPageInput {
    query?: string;
}

export interface GroupGalleryInput extends GroupPageInput {
    galleryId?: string;
    force?: boolean;
}

export interface GroupJoinRequestInput extends GroupPageInput {
    blocked?: boolean;
}

export interface GroupJoinRequestResponseInput extends GroupUserInput {
    action: GroupJoinRequestAction;
    block?: boolean;
}

export interface GroupLogsInput extends GroupPageInput {
    eventTypes?: string[];
}

export interface GroupRepresentationInput extends GroupIdInput {
    isRepresenting?: boolean;
}

export interface GroupMemberPropsInput extends GroupUserInput {
    params: GroupMemberPatch;
}

export { isRecord };

export function unwrapVrchatGroupResponse<TJson = GroupRecord>(
    response: VrchatApiResult,
    path: string
) {
    return unwrapVrchatResponse<TJson>(response, path, {
        fallbackMessage: 'VRChat group request failed'
    });
}

export function normalizeEntityId(value: unknown): string {
    const normalize = (text: string) => {
        const normalized = text.trim();
        return normalized === '[object Object]' ? '' : normalized;
    };
    if (typeof value === 'string') {
        return normalize(value);
    }
    if (typeof value === 'number' || typeof value === 'bigint') {
        return normalize(String(value));
    }
    return '';
}

export function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

export function normalizeText(value: unknown): string {
    if (typeof value !== 'string' || !value) {
        return '';
    }
    const rawText = value.trim();
    if (rawText === '[object Object]') {
        return '';
    }
    return replaceBioSymbols(rawText).trim();
}

export function normalizeArray(values: unknown): string[] {
    if (!Array.isArray(values)) {
        return [];
    }

    return values
        .map((value) =>
            typeof value === 'string'
                ? value.trim()
                : String(value ?? '').trim()
        )
        .filter(Boolean);
}

export function parseInteger(value: unknown): number {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function parseOptionalInteger(value: unknown): number | null {
    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
}

export function responseRows<TRow = unknown>(json: unknown, key = ''): TRow[] {
    if (Array.isArray(json)) {
        return json as TRow[];
    }

    if (key && isRecord(json) && Array.isArray(json[key])) {
        return json[key] as TRow[];
    }

    return [];
}

export function responsePage<TRow = unknown>(json: unknown, key = '') {
    const results = responseRows<TRow>(json, key);
    const record = isRecord(json) ? json : {};
    return {
        hasNext: record.hasNext === true,
        results,
        totalCount: parseOptionalInteger(record.totalCount)
    };
}

export async function collectPages<TRow = unknown>(
    fetchPage: (page: PageRequest) => Promise<TRow[]>,
    options: CollectPagesOptions = {}
) {
    return collectBoundedPages(fetchPage, options);
}
