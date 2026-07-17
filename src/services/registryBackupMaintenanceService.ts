import { commands } from '@/platform/tauri/bindings';
import type { RegistryBackupMaintenanceResult } from '@/platform/tauri/bindings';
import configRepository from '@/repositories/configRepository';
import { isHostCapabilityAvailable } from '@/services/hostCapabilityService';
import i18n from '@/services/i18nService';
import { useModalStore } from '@/state/modalStore';
import { useRuntimeStore } from '@/state/runtimeStore';

import { runRuntimeTelemetryJob } from './runtimeJobTelemetryService';

export async function runRegistryBackupMaintenance(reason: string) {
    if (!isHostCapabilityAvailable('registryPrefs')) {
        return;
    }

    let result: RegistryBackupMaintenanceResult;
    try {
        result = await commands.appRegistryBackupMaintenanceRun(reason);
    } catch (error) {
        console.warn(
            'Failed to run VRChat registry backup maintenance:',
            error
        );
        return;
    }

    if (!result?.restorePromptNeeded) {
        return;
    }

    await commands
        .appEnsureMainWindow()
        .catch(() => commands.appFocusWindow().catch(() => {}));
    await useModalStore.getState().alert({
        title: i18n.t(
            'service.background_maintenance.label.vrchat_registry_backup'
        ),
        description: i18n.t(
            'service.background_maintenance.description.registry_backup_restore_description'
        )
    });
    useRuntimeStore.getState().setSystemHostOpen('registryBackupOpen', true);
    await commands.appFocusWindow().catch(() => {});
    if (result.restorePromptBackupDate) {
        await configRepository.setString(
            'VRChatRegistryLastRestoreCheck',
            result.restorePromptBackupDate
        );
    }
}

export async function runForegroundUpdateRegistryBackupMaintenance() {
    await runRegistryBackupMaintenance('foreground-update');
}

export async function runStartupMaintenance() {
    await runRuntimeTelemetryJob(
        {
            name: 'startupMaintenance',
            detail: 'Running startup registry maintenance.'
        },
        () => runRegistryBackupMaintenance('foreground-startup')
    );
}
