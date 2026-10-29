import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { openExternalLink } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { refreshVrcStatusNow } from '@/services/vrcStatusService';
import { links } from '@/shared/constants/link';
import { useRuntimeStore } from '@/state/runtimeStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/ui/shadcn/tooltip';

import { formatStatusDate } from './statusBarFormat';
import { StatusDot, StatusSegment } from './StatusBarParts';

export function ServersSegment() {
    const { t } = useTranslation();
    const indicator = useRuntimeStore((state) => state.vrcStatus.indicator);
    const summary = useRuntimeStore((state) => state.vrcStatus.summary);
    const status = useRuntimeStore((state) => state.vrcStatus.status);
    const lastFetchedAt = useRuntimeStore(
        (state) => state.vrcStatus.lastFetchedAt
    );
    const refreshing = useRuntimeStore((state) => state.vrcStatus.refreshing);
    const error = useRuntimeStore((state) => state.vrcStatus.error);
    const hasIssue = Boolean(indicator && indicator !== 'none');
    const isMajor = ['major', 'critical'].includes(indicator);

    async function openStatusPage() {
        const refreshStatusPromise = refreshVrcStatusNow().catch(
            (error: unknown) => {
                console.warn('VRChat status refresh failed:', error);
            }
        );

        try {
            await openExternalLink(links.vrchatStatus);
        } catch (error) {
            toast.add({
                type: 'error',
                title:
                    error instanceof Error
                        ? error.message
                        : t(
                              'component.app_status_bar.toast.failed_to_open_vrchat_status'
                          )
            });
        }

        await refreshStatusPromise;
    }

    return (
        <StatusSegment
            active={!hasIssue}
            alert={hasIssue ? (isMajor ? 'danger' : 'warn') : null}
            dotClassName={cn(
                refreshing && 'motion-safe:animate-pulse',
                hasIssue
                    ? isMajor
                        ? 'bg-[var(--status-busy)]'
                        : 'bg-[var(--status-askme)]'
                    : undefined
            )}
            label={t('status_bar.servers')}
            className="cursor-pointer"
            onClick={() => {
                openStatusPage();
            }}
            tooltip={
                <div className="flex flex-col gap-1 text-xs">
                    <span>
                        {summary || status || t('status_bar.servers_ok')}
                    </span>
                    {refreshing ? (
                        <span className="text-muted-foreground">
                            {t('common.loading')}
                        </span>
                    ) : null}
                    {error ? (
                        <span className="text-muted-foreground">{error}</span>
                    ) : null}
                    {lastFetchedAt ? (
                        <span className="text-muted-foreground">
                            {formatStatusDate(lastFetchedAt)}
                        </span>
                    ) : null}
                </div>
            }
        />
    );
}

export function RealtimeConnectionSegment() {
    const { t } = useTranslation();
    const websocketConnected = useRuntimeStore(
        (state) => state.transport.websocketConnected
    );

    return (
        <Tooltip>
            <TooltipTrigger
                render={
                    <div className="flex h-6 shrink-0 items-center gap-1.5 px-2">
                        <StatusDot active={Boolean(websocketConnected)} />
                        <span className="text-content-tertiary text-xs">
                            {t('status_bar.realtime_connection')}
                        </span>
                    </div>
                }
            />
            <TooltipContent className="flex max-w-xs flex-col gap-1 text-xs">
                <span>
                    WebSocket{' '}
                    {websocketConnected
                        ? t('status_bar.ws_connected')
                        : t('status_bar.ws_disconnected')}
                </span>
            </TooltipContent>
        </Tooltip>
    );
}
