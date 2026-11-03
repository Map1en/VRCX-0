import { useEffect, useState } from 'react';

import { rememberScreenshotThumbnailUrl } from '@/components/media/screenshotThumbnailUrlCache';
import { convertFileSrc } from '@/platform/tauri/assets';
import { requestScreenshotThumbnail } from '@/services/screenshotThumbnailQueueService';

type ScreenshotThumbnailLoadState = 'idle' | 'loading' | 'ready' | 'error';

export function useScreenshotThumbnailUrl(
    path: string,
    revision: string | number = ''
) {
    const [thumbnailUrl, setThumbnailUrl] = useState('');
    const [loadState, setLoadState] =
        useState<ScreenshotThumbnailLoadState>('idle');

    useEffect(() => {
        if (!path) {
            setThumbnailUrl('');
            setLoadState('idle');
            return undefined;
        }
        let active = true;
        setThumbnailUrl('');
        setLoadState('loading');

        const request = requestScreenshotThumbnail(path);
        request.promise
            .then((thumbnailPath) => {
                if (!active) {
                    return;
                }
                const nextThumbnailUrl = convertFileSrc(
                    String(thumbnailPath || ''),
                    'vrcx-0-thumb'
                );
                rememberScreenshotThumbnailUrl(path, nextThumbnailUrl);
                setThumbnailUrl(nextThumbnailUrl);
                setLoadState('ready');
            })
            .catch(() => {
                if (active) {
                    setLoadState('error');
                }
            });

        return () => {
            active = false;
            request.cancel();
        };
    }, [path, revision]);

    return { thumbnailUrl, loadState };
}
