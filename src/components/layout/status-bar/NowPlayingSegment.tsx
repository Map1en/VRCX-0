import { MusicIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { copyTextToClipboard } from '@/services/clipboardService';
import { openExternalLink } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { useRuntimeStore } from '@/state/runtimeStore';

import { NowPlayingProgress } from './StatusBarFooterParts';
import { formatDuration } from './statusBarFormat';
import { StatusSegment } from './StatusBarParts';

export function NowPlayingSegment() {
    const { t } = useTranslation();
    const url = useRuntimeStore((state) => state.nowPlaying.url);
    const name = useRuntimeStore((state) => state.nowPlaying.name);
    const startedAt = useRuntimeStore((state) => state.nowPlaying.startedAt);
    const position = useRuntimeStore((state) => state.nowPlaying.position);
    const length = useRuntimeStore((state) => state.nowPlaying.length);

    return (
        <StatusSegment
            visible={Boolean(url)}
            icon={
                <MusicIcon className="text-content-tertiary size-3 shrink-0" />
            }
            label={t('status_bar.now_playing')}
            value={name || url}
            tooltip={t('status_bar.now_playing_hint')}
            onClick={() => {
                if (!url) {
                    return;
                }
                openExternalLink(url).catch((error: unknown) => {
                    toast.add({
                        type: 'error',
                        title:
                            error instanceof Error
                                ? error.message
                                : t(
                                      'component.app_status_bar.toast.failed_to_open_media_link'
                                  )
                    });
                });
            }}
            onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!url) {
                    return;
                }
                void copyTextToClipboard(url, {
                    successMessage: t(
                        'component.app_status_bar.toast.media_link_copied'
                    ),
                    errorMessage: t(
                        'component.app_status_bar.toast.failed_to_copy_media_link'
                    )
                });
            }}
            className="max-w-96 shrink overflow-hidden"
        >
            <NowPlayingProgress
                formatter={formatDuration}
                nowPlaying={{ url, name, startedAt, position, length }}
            />
        </StatusSegment>
    );
}
