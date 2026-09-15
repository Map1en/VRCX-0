import type { TFunction } from 'i18next';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDateTime } from '@/lib/dateTime';
import { commands } from '@/platform/tauri/bindings';
import appLauncherRepository from '@/repositories/appLauncherRepository';
import configRepository from '@/repositories/configRepository';
import { getCurrentAppLauncherSnapshot } from '@/services/appLauncherSnapshotService';
import {
    getProfileBackupSettings,
    setProfileBackupSettings
} from '@/services/profileBackupService';
import {
    publishToolsStatusUpdated,
    TOOLS_STATUS_UPDATED_EVENT
} from '@/shared/constants/tools';
import { isRecord } from '@/shared/utils/record';
import { useProfileBackupStore } from '@/state/profileBackupStore';

export type ToolStatusSummary = {
    label: string;
    tone: 'active' | 'neutral';
    toggle?: {
        enabled: boolean;
        setEnabled: (enabled: boolean) => Promise<void>;
    };
};

export function countPresenceRules(rules: readonly unknown[] | null): {
    enabled: number;
    total: number;
} {
    const configuredRules = (rules ?? []).filter(isRecord);
    return {
        enabled: configuredRules.filter((rule) => rule.enabled !== false)
            .length,
        total: configuredRules.length
    };
}

async function loadToolStatusSummaries(
    t: TFunction
): Promise<Map<string, ToolStatusSummary>> {
    const [
        timeRules,
        contextRules,
        inviteMode,
        endpoints,
        appLauncher,
        backupSettings
    ] = await Promise.all([
        commands.appPresenceAutomationRulesGet('time').catch(() => null),
        commands.appPresenceAutomationRulesGet('context').catch(() => null),
        configRepository
            .getString('autoAcceptInviteRequests', 'Off')
            .catch(() => null),
        commands.appLlmEndpointList().catch(() => null),
        getCurrentAppLauncherSnapshot().catch(() => null),
        getProfileBackupSettings().catch(() => null)
    ]);

    const next = new Map<string, ToolStatusSummary>();
    for (const [toolKey, rules] of [
        ['presence-schedule', timeRules],
        ['presence-room-rules', contextRules]
    ] as const) {
        const counts = countPresenceRules(rules);
        if (counts.enabled > 0) {
            next.set(toolKey, {
                label:
                    counts.enabled === counts.total
                        ? t('view.tools.status.rules_enabled', {
                              count: counts.enabled
                          })
                        : t('view.tools.status.rules_enabled_of_total', {
                              enabled: counts.enabled,
                              total: counts.total
                          }),
                tone: 'active'
            });
        } else if (counts.total > 0) {
            next.set(toolKey, {
                label: t('view.tools.status.rules_configured_off', {
                    count: counts.total
                }),
                tone: 'neutral'
            });
        }
    }

    if (inviteMode !== null) {
        const enabled = inviteMode !== 'Off';
        next.set('presence-invite-requests', {
            label: '',
            tone: enabled ? 'active' : 'neutral',
            toggle: {
                enabled,
                setEnabled: async (nextEnabled) => {
                    await configRepository.setString(
                        'autoAcceptInviteRequests',
                        nextEnabled ? 'All Favorites' : 'Off'
                    );
                    publishToolsStatusUpdated();
                }
            }
        });
    }

    if (appLauncher?.entries.length) {
        next.set('app-launcher', {
            label: t('view.tools.status.apps_count', {
                count: appLauncher.entries.length
            }),
            tone: appLauncher.enabled ? 'active' : 'neutral',
            toggle: {
                enabled: appLauncher.enabled,
                setEnabled: async (nextEnabled) => {
                    await appLauncherRepository.setEnabled(nextEnabled);
                    publishToolsStatusUpdated();
                }
            }
        });
    }

    if (backupSettings?.autoTargetDir) {
        next.set('profile-backup', {
            label: backupSettings.lastAutoAt
                ? t('view.tools.status.last_backup', {
                      date: formatDateTime(backupSettings.lastAutoAt, {
                          dateStyle: 'medium',
                          timeStyle: 'short'
                      })
                  })
                : t('view.tools.status.automatic_backup'),
            tone: backupSettings.autoEnabled ? 'active' : 'neutral',
            toggle: {
                enabled: backupSettings.autoEnabled,
                setEnabled: async (nextEnabled) => {
                    await setProfileBackupSettings({
                        ...backupSettings,
                        autoEnabled: nextEnabled
                    });
                    publishToolsStatusUpdated();
                }
            }
        });
    }

    if (endpoints?.length) {
        next.set('llm-endpoints', {
            label: t('view.tools.status.connections_configured', {
                count: endpoints.length
            }),
            tone: 'neutral'
        });
    }

    return next;
}

export function useToolStatusSummaries(): Map<string, ToolStatusSummary> {
    const { t } = useTranslation();
    const backupOutcomeRevision = useProfileBackupStore(
        (state) => state.status.lastOutcome?.revision ?? -1
    );
    const [statusByToolKey, setStatusByToolKey] = useState(
        () => new Map<string, ToolStatusSummary>()
    );

    useEffect(() => {
        let active = true;
        let requestRevision = 0;
        const refresh = () => {
            const expectedRevision = ++requestRevision;
            void loadToolStatusSummaries(t).then((next) => {
                if (active && expectedRevision === requestRevision) {
                    setStatusByToolKey(next);
                }
            });
        };
        refresh();
        window.addEventListener(TOOLS_STATUS_UPDATED_EVENT, refresh);
        return () => {
            active = false;
            window.removeEventListener(TOOLS_STATUS_UPDATED_EVENT, refresh);
        };
    }, [backupOutcomeRevision, t]);

    return statusByToolKey;
}
