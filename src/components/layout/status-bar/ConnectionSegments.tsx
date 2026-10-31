import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { commands } from '@/platform/tauri/bindings';
import { openExternalLink } from '@/services/shellIntegrationService';
import { toast } from '@/services/toastService';
import { refreshVrcStatusNow } from '@/services/vrcStatusService';
import { links } from '@/shared/constants/link';
import { useRuntimeStore } from '@/state/runtimeStore';

import { realtimeRecoveryLabel } from './realtimeRecovery';
import { formatStatusDate } from './statusBarFormat';
import { StatusSegment } from './StatusBarParts';
import { useStatusNowMs } from './statusBarTicker';

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
    const interrupted = useRuntimeStore((state) => state.transport.interrupted);
    const retryWaiting = useRuntimeStore(
        (state) => state.transport.retryWaiting
    );
    const retryAt = useRuntimeStore((state) => state.transport.retryAt);
    const lastError = useRuntimeStore((state) => state.transport.lastError);
    const outageStartedAt = useRuntimeStore(
        (state) => state.transport.outageStartedAt
    );
    const lastConnectedAt = useRuntimeStore(
        (state) => state.transport.lastConnectedAt
    );
    const showRecovery = interrupted && !websocketConnected;
    const retryAtMs = retryAt ? Date.parse(retryAt) : Number.NaN;
    const nowMs = useStatusNowMs(
        showRecovery && retryWaiting && Number.isFinite(retryAtMs)
    );
    const canRetryNow = showRecovery && retryWaiting;

    const recovery = showRecovery
        ? realtimeRecoveryLabel({
              retryWaiting,
              retryAtMs,
              nowMs,
              reconnecting: Boolean(outageStartedAt)
          })
        : null;
    const recoveryText = recovery
        ? recovery.key === 'status_bar.realtime_retry_in'
            ? t(recovery.key, { seconds: recovery.seconds })
            : t(recovery.key)
        : null;

    return (
        <StatusSegment
            active={websocketConnected}
            label={t('status_bar.realtime_connection')}
            value={recoveryText ? `· ${recoveryText}` : undefined}
            onClick={
                canRetryNow
                    ? () => {
                          commands
                              .appRealtimeRetryNow()
                              .catch((error: unknown) => {
                                  console.warn(
                                      'Realtime retry request failed:',
                                      error
                                  );
                              });
                      }
                    : undefined
            }
            tooltip={
                <div className="flex flex-col gap-1 text-xs">
                    <span>
                        WebSocket{' '}
                        {websocketConnected
                            ? t('status_bar.ws_connected')
                            : t('status_bar.ws_disconnected')}
                    </span>
                    {recoveryText ? <span>{recoveryText}</span> : null}
                    {showRecovery && outageStartedAt ? (
                        <span className="text-muted-foreground">
                            {t('status_bar.realtime_disconnected_since', {
                                time: formatStatusDate(outageStartedAt)
                            })}
                        </span>
                    ) : null}
                    {lastConnectedAt ? (
                        <span className="text-muted-foreground">
                            {t('status_bar.realtime_last_connected', {
                                time: formatStatusDate(lastConnectedAt)
                            })}
                        </span>
                    ) : null}
                    {showRecovery && lastError ? (
                        <span className="text-muted-foreground break-words">
                            {t('status_bar.realtime_reason', {
                                reason: lastError
                            })}
                        </span>
                    ) : null}
                    {canRetryNow ? (
                        <span className="text-muted-foreground">
                            {t('status_bar.realtime_retry_now')}
                        </span>
                    ) : null}
                </div>
            }
        />
    );
}
