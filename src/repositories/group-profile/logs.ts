import type { GroupAuditLogRow } from '@/domain/entities/profileEntities';
import { commands } from '@/platform/tauri/bindings';

import { VRCHAT_API_DEFAULT_PAGE_SIZE } from '../paginationConstants';
import {
    type GroupIdInput,
    type GroupLogsInput,
    type GroupLogsPage,
    normalizeEntityId,
    responsePage,
    unwrapVrchatGroupResponse
} from './shared';

export async function getGroupAuditLogTypes({ groupId }: GroupIdInput) {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupAuditLogTypes requires a group id.'
        );
    }

    const response = unwrapVrchatGroupResponse<unknown[]>(
        await commands.appVrchatGroupAuditLogTypesGet({
            groupId: normalizedGroupId
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/auditLogTypes`
    );
    return Array.isArray(response.json) ? response.json : [];
}

export async function getGroupLogs({
    groupId,
    n = VRCHAT_API_DEFAULT_PAGE_SIZE,
    offset = 0,
    eventTypes = []
}: GroupLogsInput) {
    const page = await getGroupLogsPage({
        groupId,
        n,
        offset,
        eventTypes
    });
    return page.results;
}

export async function getGroupLogsPage({
    groupId,
    n = VRCHAT_API_DEFAULT_PAGE_SIZE,
    offset = 0,
    eventTypes = []
}: GroupLogsInput): Promise<GroupLogsPage> {
    const normalizedGroupId = normalizeEntityId(groupId);
    if (!normalizedGroupId) {
        throw new Error(
            'GroupProfileRepository.getGroupLogs requires a group id.'
        );
    }

    const eventTypesValue =
        Array.isArray(eventTypes) && eventTypes.length
            ? eventTypes.join(',')
            : '';

    const response = unwrapVrchatGroupResponse(
        await commands.appVrchatGroupLogsGet({
            groupId: normalizedGroupId,
            n,
            offset,
            eventTypes: eventTypesValue
        }),
        `groups/${encodeURIComponent(normalizedGroupId)}/auditLogs`
    );
    return responsePage<GroupAuditLogRow>(response.json, 'results');
}

export async function getAllGroupLogs({
    groupId,
    eventTypes = []
}: Omit<GroupLogsInput, 'n' | 'offset'>) {
    const rows: GroupAuditLogRow[] = [];
    const seenIds = new Set<string>();
    const pageSize = VRCHAT_API_DEFAULT_PAGE_SIZE;
    const maxPages = 50;

    for (let page = 0; page < maxPages; page += 1) {
        const nextPage = await getGroupLogsPage({
            groupId,
            n: pageSize,
            offset: page * pageSize,
            eventTypes
        });

        for (const row of nextPage.results) {
            const id = normalizeEntityId(row.id);
            if (id) {
                if (seenIds.has(id)) {
                    continue;
                }
                seenIds.add(id);
            }
            rows.push(row);
        }

        if (!nextPage.hasNext) {
            break;
        }
    }

    return rows;
}
