import { commands } from '@/platform/tauri/bindings';
import type { LegacyVrcxMigrationStatus } from '@/platform/tauri/bindings';
import type { AppToastOptions } from '@/services/toastService';

type ConfirmResult = {
    ok?: boolean;
    reason?: string;
};
type ConfirmOptions = Record<string, unknown> & {
    title: string;
    description: string;
    confirmText: string;
    alternativeText?: string;
    cancelText?: string;
    dismissible?: boolean;
    destructive?: boolean;
};
type LegacyMigrationPromptOptions = {
    alert: (options: ConfirmOptions) => Promise<ConfirmResult>;
    confirm: (options: ConfirmOptions) => Promise<ConfirmResult>;
    t: (key: string, params?: Record<string, unknown>) => string;
    toast: {
        add(options: AppToastOptions): void;
    };
};

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const LEGACY_MIGRATION_I18N_PREFIX =
    'view.settings.advanced.advanced.database_cleanup';
const LEGACY_PROCESS_I18N_PREFIX = 'message.database';

export async function confirmLegacyVrcxProcessState({
    alert,
    t
}: Pick<LegacyMigrationPromptOptions, 'alert' | 't'>): Promise<boolean> {
    while (await commands.appIsLegacyVrcxRunning()) {
        const result = await alert({
            title: t(`${LEGACY_PROCESS_I18N_PREFIX}.legacy_vrcx_running_title`),
            description: t(
                `${LEGACY_PROCESS_I18N_PREFIX}.legacy_vrcx_running_description`
            ),
            confirmText: t(
                `${LEGACY_PROCESS_I18N_PREFIX}.legacy_vrcx_force_migration`
            ),
            alternativeText: t(
                `${LEGACY_PROCESS_I18N_PREFIX}.legacy_vrcx_check_again`
            ),
            dismissible: false,
            destructive: true
        });
        if (result.reason !== 'alternative') {
            return result.ok === true && result.reason === 'ok';
        }
    }
    return false;
}

async function showLegacyMigrationFailure(
    { alert, t }: Pick<LegacyMigrationPromptOptions, 'alert' | 't'>,
    description: string
): Promise<void> {
    await alert({
        title: t(`${LEGACY_MIGRATION_I18N_PREFIX}.legacy_migration`),
        description,
        confirmText: t('common.actions.close')
    });
}

export async function promptLegacyVrcxForceMigration({
    alert,
    confirm,
    t,
    toast
}: LegacyMigrationPromptOptions): Promise<void> {
    let status: LegacyVrcxMigrationStatus | null = null;
    try {
        status = await commands.appGetLegacyVrcxForceMigrationStatus();
    } catch (error) {
        await showLegacyMigrationFailure(
            { alert, t },
            t(`${LEGACY_MIGRATION_I18N_PREFIX}.legacy_migration_failed`, {
                error: errorMessage(error)
            })
        );
        return;
    }

    if (!status?.available) {
        await showLegacyMigrationFailure(
            { alert, t },
            status?.reason ||
                t(
                    `${LEGACY_MIGRATION_I18N_PREFIX}.legacy_migration_not_available`
                )
        );
        return;
    }

    const result = await confirm({
        title: t(
            `${LEGACY_MIGRATION_I18N_PREFIX}.legacy_migration_confirm_title`
        ),
        description: t(
            `${LEGACY_MIGRATION_I18N_PREFIX}.legacy_migration_confirm_description`,
            {
                path: status.dbPath || '%APPDATA%\\VRCX'
            }
        ),
        confirmText: t(
            `${LEGACY_MIGRATION_I18N_PREFIX}.legacy_migration_confirm`
        ),
        cancelText: t('common.actions.cancel'),
        destructive: true
    });
    if (!result.ok) {
        return;
    }

    try {
        const allowRunningLegacyVrcx = await confirmLegacyVrcxProcessState({
            alert,
            t
        });
        const willRestart = await commands.appRequestLegacyVrcxForceMigration(
            allowRunningLegacyVrcx
        );
        if (!willRestart) {
            toast.add({
                type: 'warning',
                title: t(
                    `${LEGACY_MIGRATION_I18N_PREFIX}.legacy_migration_restart_manually`
                )
            });
        }
    } catch (error) {
        await showLegacyMigrationFailure(
            { alert, t },
            t(`${LEGACY_MIGRATION_I18N_PREFIX}.legacy_migration_failed`, {
                error: errorMessage(error)
            })
        );
    }
}
