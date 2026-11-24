import { useCallback, useEffect, useState } from 'react';

import {
    commands,
    type ScreenshotShareRecord
} from '@/platform/tauri/bindings';

export function useScreenshotShareHistory() {
    const [records, setRecords] = useState<ScreenshotShareRecord[] | null>(
        null
    );
    const [loadFailed, setLoadFailed] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);

    useEffect(() => {
        let active = true;
        commands.appGetScreenshotShareHistory().then(
            (history) => {
                if (active) {
                    setRecords(history);
                }
            },
            (error: unknown) => {
                if (active) {
                    console.warn(
                        'Failed to load screenshot share history:',
                        error
                    );
                    setLoadFailed(true);
                }
            }
        );
        return () => {
            active = false;
        };
    }, [loadAttempt]);

    const reload = useCallback(() => {
        setLoadFailed(false);
        setLoadAttempt((attempt) => attempt + 1);
    }, []);

    return { records, setRecords, loadFailed, reload };
}
