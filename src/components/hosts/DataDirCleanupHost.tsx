import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
    dataDirMigrationWarningKey,
    formatDataDirMigrationBytes
} from '@/services/dataDirMigrationI18n';
import {
    cleanupMigratedDataDir,
    markDataDirCleanupPrompted,
    takeDataDirMigrationResult,
    type DataDirCleanupPending
} from '@/services/dataDirMigrationService';
import { getAppDataDirState } from '@/services/shellIntegrationService';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

const CLEANUP_TOAST_ID = 'data-dir-migration-cleanup';
const REPROMPT_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

export function DataDirCleanupHost() {
    const { t, i18n } = useTranslation();
    const hydrated = useRuntimeStore(
        (state) => state.shell.backendRuntimeSnapshotHydrated
    );
    const checked = useRef(false);
    const confirm = useModalStore((state) => state.confirm);

    useEffect(() => {
        if (!hydrated || checked.current) {
            return;
        }
        checked.current = true;

        async function confirmAndCleanup(pending: DataDirCleanupPending) {
            const size = formatDataDirMigrationBytes(
                pending.bytes,
                i18n.language
            );
            const result = await confirm({
                title: t('data_dir_migration.cleanup.confirm_title'),
                description: t(
                    'data_dir_migration.cleanup.confirm_description',
                    {
                        path: pending.oldDir,
                        size
                    }
                ),
                confirmText: t('data_dir_migration.cleanup.action'),
                cancelText: t('common.actions.cancel'),
                destructive: true
            });
            if (!result.ok) {
                return;
            }
            try {
                const report = await cleanupMigratedDataDir();
                if (!report) {
                    return;
                }
                toast.success(t('data_dir_migration.cleanup.completed'), {
                    description: t(
                        report.skipped.length > 0
                            ? 'data_dir_migration.cleanup.completed_with_skipped'
                            : 'data_dir_migration.cleanup.freed',
                        {
                            size: formatDataDirMigrationBytes(
                                report.freedBytes,
                                i18n.language
                            ),
                            count: report.skipped.length
                        }
                    )
                });
            } catch (error) {
                toast.error(
                    error instanceof Error ? error.message : String(error)
                );
            }
        }

        async function checkStartupResult() {
            const state = await getAppDataDirState();
            const result = await takeDataDirMigrationResult().catch(
                (error: unknown) => {
                    console.warn(
                        'Failed to read the data directory migration result:',
                        error
                    );
                    return null;
                }
            );
            if (result?.status === 'databaseOpenFailed') {
                toast.error(t('data_dir_migration.result.failed_title'), {
                    description: t(
                        'data_dir_migration.result.database_open_failed'
                    )
                });
            } else if (result?.status === 'interrupted') {
                toast.warning(
                    t('data_dir_migration.result.interrupted_title'),
                    {
                        description: t('data_dir_migration.result.interrupted')
                    }
                );
            } else if (result?.status === 'succeeded') {
                toast.success(t('data_dir_migration.result.succeeded'), {
                    description:
                        result.warnings.length > 0
                            ? result.warnings
                                  .map((warning) =>
                                      t(dataDirMigrationWarningKey(warning))
                                  )
                                  .join(' ')
                            : undefined
                });
            }

            const pending = state.cleanupPending;
            if (pending?.dismissed) {
                return;
            }
            const lastPromptedAt = pending?.lastPromptedAt
                ? Date.parse(pending.lastPromptedAt)
                : Number.NaN;
            if (
                !pending ||
                (Number.isFinite(lastPromptedAt) &&
                    Date.now() - lastPromptedAt < REPROMPT_INTERVAL_MS)
            ) {
                return;
            }
            toast.success(t('data_dir_migration.cleanup.ready_title'), {
                id: CLEANUP_TOAST_ID,
                description: t('data_dir_migration.cleanup.ready_description', {
                    path: pending.oldDir
                }),
                duration: Infinity,
                position: 'bottom-right',
                closeButton: true,
                action: {
                    label: t('data_dir_migration.cleanup.action_with_size', {
                        size: formatDataDirMigrationBytes(
                            pending.bytes,
                            i18n.language
                        )
                    }),
                    onClick: (event) => {
                        event.preventDefault();
                        void confirmAndCleanup(pending);
                    }
                }
            });
            void markDataDirCleanupPrompted(new Date().toISOString()).catch(
                (error: unknown) => {
                    console.warn(
                        'Failed to record the data directory cleanup prompt:',
                        error
                    );
                }
            );
        }

        void checkStartupResult().catch((error: unknown) => {
            console.warn(
                'Failed to inspect data directory migration startup state:',
                error
            );
        });
    }, [confirm, hydrated, i18n.language, t]);

    return null;
}
