import { useEffect, useState } from 'react';

import { refreshModerationSync } from '@/services/moderationSyncService';
import { useRuntimeStore } from '@/state/runtimeStore';

import type { ModerationLoadStatus, ModerationRow } from './moderationPageTypes';

type ModerationRowsOptions = {
    refreshKey?: string;
};

export function useModerationRows({
    refreshKey = ''
}: ModerationRowsOptions = {}) {
    const currentUserId = useRuntimeStore((state: any) => state.auth.currentUserId);
    const currentEndpoint = useRuntimeStore(
        (state: any) => state.auth.currentUserEndpoint
    );
    const [rows, setRows] = useState<ModerationRow[]>([]);
    const [loadStatus, setLoadStatus] =
        useState<ModerationLoadStatus>('idle');
    const [detail, setDetail] = useState('');
    const [refreshToken, setRefreshToken] = useState(0);

    useEffect(() => {
        let active = true;
        if (!currentUserId) {
            setRows([]);
            setLoadStatus('idle');
            setDetail(
                'No authenticated user is available for the moderation snapshot.'
            );
            return () => {
                active = false;
            };
        }
        setLoadStatus('running');
        setDetail('');
        refreshModerationSync({
            userId: currentUserId,
            endpoint: currentEndpoint
        })
            .then((response: any) => {
                if (!active) {
                    return;
                }
                const nextRows = Array.isArray(response?.rows)
                    ? response.rows
                    : [];
                setRows(nextRows);
                setLoadStatus('ready');
                setDetail('');
            })
            .catch(() => {
                if (!active) {
                    return;
                }
                setRows([]);
                setLoadStatus('error');
                setDetail('');
            });
        return () => {
            active = false;
        };
    }, [currentEndpoint, currentUserId, refreshKey, refreshToken]);

    function refresh() {
        setRefreshToken((value) => value + 1);
    }

    return {
        currentEndpoint,
        currentUserId,
        detail,
        loadStatus,
        refresh,
        rows,
        setDetail,
        setRows
    };
}
