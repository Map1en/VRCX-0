import { describe, expect, it } from 'vitest';

import {
    buildGroupAuditLogCsv,
    GROUP_AUDIT_LOG_EXPORT_COLUMNS
} from './groupModerationCsv';

describe('groupModerationCsv', () => {
    it('lists the export columns in a fixed order', () => {
        expect(
            GROUP_AUDIT_LOG_EXPORT_COLUMNS.map((column) => column.key)
        ).toEqual([
            'created_at',
            'eventType',
            'actorDisplayName',
            'description',
            'data'
        ]);
    });

    it('builds a CSV header and rows for the selected columns only', () => {
        const csv = buildGroupAuditLogCsv(
            [
                {
                    created_at: '2026-06-22T10:00:00Z',
                    eventType: 'group.member.ban',
                    actorDisplayName: 'Moderator Alice',
                    description: 'Banned Bob',
                    data: { reason: 'spam' }
                }
            ],
            ['created_at', 'description']
        );

        expect(csv).toBe(
            'created_at,description\n2026-06-22T10:00:00Z,Banned Bob'
        );
    });

    it('quotes fields containing commas, quotes, or newlines and JSON-stringifies data', () => {
        const csv = buildGroupAuditLogCsv(
            [
                {
                    created_at: '2026-06-22T10:00:00Z',
                    description: 'Reason: "spam, harassment"',
                    data: { reason: 'spam', targets: ['usr_1', 'usr_2'] }
                }
            ],
            ['description', 'data']
        );

        expect(csv).toBe(
            'description,data\n"Reason: ""spam, harassment""","{""reason"":""spam"",""targets"":[""usr_1"",""usr_2""]}"'
        );
    });

    it('returns just the header row when there are no rows', () => {
        expect(buildGroupAuditLogCsv([], ['created_at', 'eventType'])).toBe(
            'created_at,eventType'
        );
    });

    it('ignores unknown column keys and preserves the fixed column order', () => {
        const csv = buildGroupAuditLogCsv(
            [
                {
                    created_at: '2026-06-22T10:00:00Z',
                    eventType: 'group.member.kick'
                }
            ],
            ['eventType', 'created_at', 'not-a-real-column']
        );

        expect(csv).toBe(
            'created_at,eventType\n2026-06-22T10:00:00Z,group.member.kick'
        );
    });
});
