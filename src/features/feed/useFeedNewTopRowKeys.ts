import { useEffect, useRef, useState } from 'react';

import { getFeedRowId } from '@/components/feed/feedRows';
import type { FeedRow } from '@/components/feed/feedTypes';

const NEW_ROW_FEEDBACK_MS = 1600;
const NEW_ROW_ANIMATION_LIMIT = 6;

export function useFeedNewTopRowKeys(
    rows: FeedRow[],
    resetKey: string
): Set<string> {
    const previousRowKeysRef = useRef<string[]>([]);
    const previousResetKeyRef = useRef(resetKey);
    const clearTimersRef = useRef(new Map<string, number>());
    const [newRowKeys, setNewRowKeys] = useState<Set<string>>(() => new Set());

    useEffect(() => {
        const timers = clearTimersRef.current;
        const nextKeys = rows.map(getFeedRowId).filter(Boolean);
        if (previousResetKeyRef.current !== resetKey) {
            previousResetKeyRef.current = resetKey;
            previousRowKeysRef.current = nextKeys;
            timers.forEach((timer) => {
                window.clearTimeout(timer);
            });
            timers.clear();
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

        const arrivedKeys = nextKeys.slice(
            0,
            Math.min(previousFirstIndex, NEW_ROW_ANIMATION_LIMIT)
        );
        setNewRowKeys((current) => {
            const next = new Set(current);
            for (const key of arrivedKeys) {
                next.add(key);
            }
            return next;
        });
        for (const key of arrivedKeys) {
            const runningTimer = timers.get(key);
            if (runningTimer) {
                window.clearTimeout(runningTimer);
            }
            timers.set(
                key,
                window.setTimeout(() => {
                    timers.delete(key);
                    setNewRowKeys((current) => {
                        if (!current.has(key)) {
                            return current;
                        }
                        const next = new Set(current);
                        next.delete(key);
                        return next;
                    });
                }, NEW_ROW_FEEDBACK_MS)
            );
        }
    }, [resetKey, rows]);

    useEffect(() => {
        const timers = clearTimersRef.current;
        return () => {
            timers.forEach((timer) => {
                window.clearTimeout(timer);
            });
            timers.clear();
        };
    }, []);

    return newRowKeys;
}
