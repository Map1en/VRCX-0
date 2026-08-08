import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';

function formatUpdateReleaseDate(value: unknown) {
    if (!value) {
        return '-';
    }
    const timestamp = Date.parse(String(value));
    if (!Number.isFinite(timestamp)) {
        return String(value);
    }
    return formatDateFilter(timestamp, 'date');
}

function clampUpdateProgress(value: unknown) {
    return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

export function TitleBarUpdateButton({ onClick }: { onClick: () => void }) {
    const { t } = useTranslation();
    const latestUpdaterRelease = useRuntimeStore(
        (state) => state.updateLoop.latestUpdaterRelease
    );
    const autoDownloadState = useRuntimeStore(
        (state) => state.updateLoop.autoDownloadState
    );
    const downloadedVersion = useRuntimeStore(
        (state) => state.updateLoop.downloadedVersion
    );
    const downloadProgress = useRuntimeStore(
        (state) => state.updateLoop.downloadProgress
    );
    const latestVersion = latestUpdaterRelease?.canonicalVersion || '';
    const hasMatchingDownloadedVersion =
        Boolean(latestVersion) && downloadedVersion === latestVersion;
    const isDownloaded =
        autoDownloadState === 'downloaded' && hasMatchingDownloadedVersion;
    const isDownloading =
        autoDownloadState === 'downloading' && hasMatchingDownloadedVersion;
    const progressPercent = clampUpdateProgress(downloadProgress);

    return (
        <HoverCard>
            <HoverCardTrigger
                delay={150}
                closeDelay={80}
                render={
                    <Button
                        type="button"
                        variant={isDownloaded ? 'default' : 'secondary'}
                        size="sm"
                        className="h-6 gap-1.5 rounded-md px-2 text-xs shadow-none"
                        onClick={onClick}
                    >
                        {isDownloaded
                            ? t('nav_menu.update_downloaded')
                            : t('nav_menu.update')}
                    </Button>
                }
            />
            <HoverCardContent side="bottom" align="end" className="w-80 p-3">
                <div className="flex flex-col gap-2">
                    <div className="text-sm font-semibold">
                        {latestUpdaterRelease?.title ||
                            t('dialog.system.label.vrcx_0_update')}
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                        <dt className="text-muted-foreground">
                            {t('message.vrcx_updater.current_version')}
                        </dt>
                        <dd className="text-foreground truncate tabular-nums">
                            {latestUpdaterRelease?.currentVersion || '-'}
                        </dd>
                        <dt className="text-muted-foreground">
                            {t('message.vrcx_updater.latest_version')}
                        </dt>
                        <dd className="text-foreground truncate tabular-nums">
                            {latestUpdaterRelease?.latestVersion || '-'}
                        </dd>
                        <dt className="text-muted-foreground">
                            {t('message.vrcx_updater.released')}
                        </dt>
                        <dd className="text-foreground truncate">
                            {formatUpdateReleaseDate(
                                latestUpdaterRelease?.publishedAt
                            )}
                        </dd>
                        {isDownloading ? (
                            <>
                                <dt className="text-muted-foreground">
                                    {t('nav_menu.update')}
                                </dt>
                                <dd className="text-foreground truncate tabular-nums">
                                    {progressPercent}%
                                </dd>
                            </>
                        ) : null}
                    </dl>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}
