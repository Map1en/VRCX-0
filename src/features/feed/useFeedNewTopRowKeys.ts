import { useEffect, useRef, useState } from 'react';

import { getFeedRowId } from '@/components/feed/feedRows';
import type { FeedRow } from '@/components/feed/feedTypes';

const NEW_ROW_FEEDBACK_MS = 180;
const NEW_ROW_ANIMATION_LIMIT = 6;

export function useFeedNewTopRowKeys(
    rows: FeedRow[],
    resetKey: string
): Set<string> {
    const previousRowKeysRef = useRef<string[]>([]);
    const previousResetKeyRef = useRef(resetKey);
    const clearTimerRef = useRef<number | null>(null);
    const [newRowKeys, setNewRowKeys] = useState<Set<string>>(() => new Set());

    useEffect(() => {
        const nextKeys = rows.map(getFeedRowId).filter(Boolean);
        if (previousResetKeyRef.current !== resetKey) {
            previousResetKeyRef.current = resetKey;
            previousRowKeysRef.current = nextKeys;
            setNewRowKeys(new Set());
            return;
        }

        const previousKeys = previousRowKeysRef.current;
        previousRowKeysRef.current = nextKeys;
        if (!previousKeys.length || !nextKeys.length) {
            return;
        }

        const previousFirstIndex = nextKeys.indexOf(previousKeys[0]);
        if (previousFirstIndex <= 0) {
            return;
        }

        setNewRowKeys(
            new Set(
                nextKeys.slice(
                    0,
                    Math.min(previousFirstIndex, NEW_ROW_ANIMATION_LIMIT)
                )
            )
        );
        if (clearTimerRef.current) {
            window.clearTimeout(clearTimerRef.current);
        }
        clearTimerRef.current = window.setTimeout(() => {
            clearTimerRef.current = null;
            setNewRowKeys(new Set());
        }, NEW_ROW_FEEDBACK_MS);
    }, [resetKey, rows]);

    useEffect(
        () => () => {
            if (clearTimerRef.current) {
                window.clearTimeout(clearTimerRef.current);
            }
        },
        []
    );

    return newRowKeys;
}
