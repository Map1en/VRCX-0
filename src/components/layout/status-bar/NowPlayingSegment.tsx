import { MusicIcon, PauseIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { FadeInImage } from '@/components/media/FadeInImage';
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
    const paused = useRuntimeStore((state) => state.nowPlaying.paused);
    const displayName = useRuntimeStore(
        (state) => state.nowPlaying.displayName
    );
    const thumbnailUrl = useRuntimeStore(
        (state) => state.nowPlaying.thumbnailUrl
    );
    const StateIcon = paused ? PauseIcon : MusicIcon;

    return (
        <StatusSegment
            visible={Boolean(url)}
            icon={
                <StateIcon className="text-content-tertiary size-3 shrink-0" />
            }
            label={t('status_bar.now_playing')}
            value={name || url}
            tooltip={
                <div className="flex flex-col gap-1">
                    {thumbnailUrl ? (
                        <FadeInImage
                            src={thumbnailUrl}
                            alt=""
                            className="mb-1 aspect-video w-full rounded-sm object-cover"
                        />
                    ) : null}
                    {name && name !== url ? (
                        <span className="font-medium break-words">{name}</span>
                    ) : null}
                    {displayName ? (
                        <span className="opacity-70">{displayName}</span>
                    ) : null}
                    <span className="break-all opacity-70">{url}</span>
                    <span className="opacity-70">
                        {t('status_bar.now_playing_hint')}
                    </span>
                </div>
            }
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
                nowPlaying={{ startedAt, position, length, paused }}
            />
        </StatusSegment>
    );
}
