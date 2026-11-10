import {
    commands,
    type FeedLoggerErrorCode,
    type FeedLoggerProbe,
    type FeedLoggerSyncEvent
} from '@/platform/tauri/bindings';
import { PlatformCommandError } from '@/platform/tauri/errors';
import { isRecord } from '@/shared/utils/record';
import { useModalStore } from '@/state/modalStore';
import { useOfflineRecordStore } from '@/state/offlineRecordStore';

import i18n from './i18nService';
import { toast } from './toastService';

export type OfflineRecordHealthLevel = 'ok' | 'warning' | 'error';

const GUIDE_BASE_URL =
    'https://github.com/Map1en/VRCX-0/blob/master/crates/logger/';
const GUIDE_FILES: Record<string, string> = {
    'zh-CN': 'README.zh-CN.md',
    'zh-TW': 'README.zh-Hant.md',
    ja: 'README.ja-JP.md',
    ko: 'README.ko-KR.md'
};

export function offlineRecordGuideUrl(language: string): string {
    return `${GUIDE_BASE_URL}${GUIDE_FILES[language] ?? 'README.md'}`;
}

type OfflineRecordHealth = {
    level: OfflineRecordHealthLevel;
    messageKey: string;
};

const PROBE_FAILURE_HEALTH: Record<
    Exclude<FeedLoggerProbe['state'], 'notConfigured' | 'connected'>,
    OfflineRecordHealth
> = {
    unreachable: {
        level: 'error',
        messageKey: 'offline_record.health.unreachable'
    },
    unauthorized: {
        level: 'error',
        messageKey: 'offline_record.health.unauthorized'
    },
    clientTooOld: {
        level: 'error',
        messageKey: 'offline_record.health.client_too_old'
    },
    loggerTooOld: {
        level: 'error',
        messageKey: 'offline_record.health.logger_too_old'
    },
    badResponse: {
        level: 'warning',
        messageKey: 'offline_record.health.bad_response'
    },
    betaRecorder: {
        level: 'error',
        messageKey: 'offline_record.health.beta_recorder'
    }
};

export function resolveOfflineRecordHealth(
    probe: FeedLoggerProbe | null,
    currentUserId: string | null
): OfflineRecordHealth | null {
    if (!probe || probe.state === 'notConfigured') {
        return null;
    }
    if (probe.state !== 'connected') {
        return PROBE_FAILURE_HEALTH[probe.state];
    }
    const { status } = probe;
    if (
        status.session.state !== 'noCredentials' &&
        status.accountId &&
        currentUserId &&
        status.accountId !== currentUserId
    ) {
        return {
            level: 'warning',
            messageKey: 'offline_record.health.account_mismatch'
        };
    }
    switch (status.session.state) {
        case 'recording':
            return {
                level: 'ok',
                messageKey: 'offline_record.health.recording'
            };
        case 'loggingIn':
            return {
                level: 'warning',
                messageKey: 'offline_record.health.logging_in'
            };
        case 'reconnecting':
            return {
                level: 'warning',
                messageKey: 'offline_record.health.reconnecting'
            };
        case 'awaitingTwoFactor':
            return {
                level: 'error',
                messageKey: 'offline_record.health.two_factor'
            };
        case 'noCredentials':
            return {
                level: 'error',
                messageKey: 'offline_record.health.no_credentials'
            };
        case 'loginFailed':
            return {
                level: 'error',
                messageKey: 'offline_record.health.login_failed'
            };
    }
}

const ERROR_KEYS: Record<FeedLoggerErrorCode, string> = {
    notConfigured: 'offline_record.error.not_configured',
    notSignedIn: 'offline_record.error.not_signed_in',
    syncInProgress: 'offline_record.error.sync_in_progress',
    notPresent: 'offline_record.error.not_present',
    noSavedCredentials: 'offline_record.error.no_saved_credentials',
    loggerTooOld: 'offline_record.health.logger_too_old',
    betaRecorder: 'offline_record.health.beta_recorder',
    backupRequired: 'offline_record.error.backup_required',
    accountMismatch: 'offline_record.error.account_mismatch',
    invalidAddress: 'offline_record.error.invalid_address',
    invalidPassword: 'offline_record.error.invalid_password',
    unreachable: 'offline_record.health.unreachable',
    unauthorized: 'offline_record.health.unauthorized',
    clientTooOld: 'offline_record.health.client_too_old',
    rejected: 'offline_record.error.rejected',
    badResponse: 'offline_record.health.bad_response',
    storage: 'offline_record.error.storage'
};

export function offlineRecordErrorMessage(error: unknown): string {
    if (error instanceof PlatformCommandError && error.feedLoggerCode) {
        const message =
            isRecord(error.cause) && typeof error.cause.message === 'string'
                ? error.cause.message
                : error.message;
        return i18n.t(ERROR_KEYS[error.feedLoggerCode], { message });
    }
    return i18n.t('offline_record.action_failed');
}

async function succeeded(action: () => Promise<unknown>): Promise<boolean> {
    try {
        await action();
        return true;
    } catch (error) {
        console.warn('Offline record step failed:', error);
        return false;
    }
}

async function continueAfter(failure: 'sync' | 'sign_out'): Promise<boolean> {
    const result = await useModalStore.getState().confirm({
        title: i18n.t(`offline_record.${failure}_failed_title`),
        description: i18n.t(`offline_record.${failure}_failed_description`),
        confirmText: i18n.t('offline_record.continue_anyway'),
        cancelText: i18n.t('common.actions.cancel'),
        destructive: true
    });
    return result.ok;
}

export async function syncRecorderBeforeLeaving(): Promise<boolean> {
    const probe = useOfflineRecordStore.getState().health;
    if (probe?.state === 'connected' && probe.status.unsyncedFrames === 0) {
        return true;
    }
    return (
        (await succeeded(() => commands.appFeedLoggerSync())) ||
        continueAfter('sync')
    );
}

export async function syncThenRemoveRecorder(): Promise<boolean> {
    if (!(await syncRecorderBeforeLeaving())) {
        return false;
    }
    if (
        !(await succeeded(() => commands.appFeedLoggerUnpair())) &&
        !(await continueAfter('sign_out'))
    ) {
        return false;
    }
    if (!(await succeeded(() => commands.appFeedLoggerSettingsClear()))) {
        toast.add({
            type: 'error',
            title: i18n.t('offline_record.action_failed')
        });
        return false;
    }
    return true;
}

let disablingBackup = false;

export async function confirmDisablingBackupWithRecorder(): Promise<boolean> {
    if (disablingBackup) {
        return false;
    }
    disablingBackup = true;
    try {
        const settings = await commands
            .appFeedLoggerSettingsGet()
            .catch((error: unknown) => {
                console.warn('Failed to read offline record settings:', error);
                return null;
            });
        if (!settings) {
            toast.add({
                type: 'error',
                title: i18n.t('offline_record.action_failed')
            });
            return false;
        }
        if (!settings.address) {
            return true;
        }
        const result = await useModalStore.getState().confirm({
            title: i18n.t('offline_record.backup_off_confirm_title'),
            description: i18n.t(
                'offline_record.backup_off_confirm_description'
            ),
            confirmText: i18n.t('offline_record.backup_off_confirm'),
            cancelText: i18n.t('common.actions.cancel'),
            destructive: true
        });
        return result.ok && (await syncThenRemoveRecorder());
    } finally {
        disablingBackup = false;
    }
}

export function handleFeedLoggerHealthEvent(probe: FeedLoggerProbe) {
    useOfflineRecordStore.getState().applyHealth(probe);
}

export function handleFeedLoggerSyncEvent(event: FeedLoggerSyncEvent) {
    const store = useOfflineRecordStore.getState();
    switch (event.state) {
        case 'pulling':
        case 'writing':
            store.setSyncProgress({ phase: event.state, frames: event.frames });
            return;
        case 'finished':
            store.finishSync('finished');
            if (event.inserted > 0) {
                store.markBackfilled();
                toast.add({
                    type: 'success',
                    title: i18n.t('offline_record.toast.backfilled', {
                        count: event.inserted
                    })
                });
            }
            if (event.skipped > 0) {
                toast.add({
                    type: 'warning',
                    title: i18n.t('offline_record.toast.skipped', {
                        count: event.skipped
                    })
                });
            }
            break;
        case 'failed':
            store.finishSync('failed');
            toast.add({
                type: 'error',
                title: i18n.t('offline_record.toast.backfill_failed'),
                description: event.message
            });
            break;
    }
    commands.appFeedLoggerStatus().catch((error: unknown) => {
        console.warn('Failed to refresh offline record status:', error);
    });
}
