import { useTranslation } from 'react-i18next';

import { formatDateFilter } from '@/lib/dateTime';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Button } from '@/ui/shadcn/button';
import {
    HoverCard,
    HoverCardContent,
    HoverCardTrigger
} from '@/ui/shadcn/hover-card';

function formatUpdateReleaseDate(value: any) {
    if (!value) {
        return '-';
    }
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp)) {
        return String(value);
    }
    return formatDateFilter(timestamp, 'date');
}

export function TitleBarUpdateButton({ onClick }: { onClick: () => void }) {
    const { t } = useTranslation();
    const latestUpdaterRelease = useRuntimeStore(
        (state: any) => state.updateLoop.latestUpdaterRelease
    );

    return (
        <HoverCard openDelay={150} closeDelay={80}>
            <HoverCardTrigger asChild>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-6 gap-1.5 rounded-md px-2 text-xs shadow-none"
                    onClick={onClick}
                >
                    {t('nav_menu.update')}
                </Button>
            </HoverCardTrigger>
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
                    </dl>
                </div>
            </HoverCardContent>
        </HoverCard>
    );
}
