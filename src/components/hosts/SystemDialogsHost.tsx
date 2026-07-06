import { useEffect } from 'react';
import { toast } from 'sonner';

import { KeyboardShortcutsDialog } from '@/components/keyboard/KeyboardShortcutsDialog';
import { ProxySettingsDialog } from '@/components/proxy/ProxySettingsDialog';
import {
    getHostCapabilityUnavailableReason,
    isHostCapabilityAvailable,
    isHostCapabilitySupported
} from '@/services/hostCapabilityService';
import { useRuntimeStore } from '@/state/runtimeStore';

import { ChangelogDialog } from './system-dialogs/ChangelogDialog';
import { DatabaseUpgradeDialog } from './system-dialogs/DatabaseUpgradeDialog';
import { LaunchOptionsDialog } from './system-dialogs/LaunchOptionsDialog';
import { RegistryBackupDialog } from './system-dialogs/RegistryBackupDialog';
import { UpdaterDialog } from './system-dialogs/UpdaterDialog';
import { VRChatConfigDialog } from './system-dialogs/VRChatConfigDialog';
import { UpdateAvailableToastHost } from './UpdateAvailableToastHost';

export function SystemDialogsHost() {
    const updaterOpen = useRuntimeStore(
        (state) => state.systemHosts.updaterOpen
    );
    const changelogOpen = useRuntimeStore(
        (state) => state.systemHosts.changelogOpen
    );
    const keyboardShortcutsOpen = useRuntimeStore(
        (state) => state.systemHosts.keyboardShortcutsOpen
    );
    const proxySettingsOpen = useRuntimeStore(
        (state) => state.systemHosts.proxySettingsOpen
    );
    const changelogTargetVersion = useRuntimeStore(
        (state) => state.changelogTargetVersion
    );
    const registryBackupOpen = useRuntimeStore(
        (state) => state.systemHosts.registryBackupOpen
    );
    const launchOptionsOpen = useRuntimeStore(
        (state) => state.systemHosts.launchOptionsOpen
    );
    const vrchatConfigOpen = useRuntimeStore(
        (state) => state.systemHosts.vrchatConfigOpen
    );
    const databaseUpgradeOpen = useRuntimeStore(
        (state) => state.databaseUpgrade.open
    );
    const systemHostDatabaseUpgradeOpen = useRuntimeStore(
        (state) => state.systemHosts.databaseUpgradeOpen
    );
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );
    const setChangelogTargetVersion = useRuntimeStore(
        (state) => state.setChangelogTargetVersion
    );
    const hostCapabilities = useRuntimeStore((state) => state.hostCapabilities);

    useEffect(() => {
        type CapabilityGuard = [
            hostKey: string,
            open: boolean,
            capability: keyof typeof hostCapabilities,
            mode?: 'available' | 'supported'
        ];
        const guards: CapabilityGuard[] = [
            ['registryBackupOpen', registryBackupOpen, 'registryPrefs'],
            ['launchOptionsOpen', launchOptionsOpen, 'gameLaunch', 'supported'],
            ['vrchatConfigOpen', vrchatConfigOpen, 'vrchatPathDiscovery']
        ];

        for (const [hostKey, open, capability, mode] of guards) {
            const usable =
                mode === 'supported'
                    ? isHostCapabilitySupported(capability)
                    : isHostCapabilityAvailable(capability);
            if (open && !usable) {
                toast.error(getHostCapabilityUnavailableReason(capability));
                setSystemHostOpen(hostKey, false);
            }
        }
    }, [
        launchOptionsOpen,
        registryBackupOpen,
        setSystemHostOpen,
        hostCapabilities,
        vrchatConfigOpen
    ]);

    return (
        <>
            <UpdateAvailableToastHost />
            <UpdaterDialog
                open={Boolean(updaterOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('updaterOpen', open)
                }
            />
            <ChangelogDialog
                open={Boolean(changelogOpen)}
                targetVersion={changelogTargetVersion}
                onOpenChange={(open: boolean) => {
                    setSystemHostOpen('changelogOpen', open);
                    if (!open) {
                        setChangelogTargetVersion('');
                    }
                }}
            />
            <RegistryBackupDialog
                open={Boolean(registryBackupOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('registryBackupOpen', open)
                }
            />
            <LaunchOptionsDialog
                open={Boolean(launchOptionsOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('launchOptionsOpen', open)
                }
            />
            <VRChatConfigDialog
                open={Boolean(vrchatConfigOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('vrchatConfigOpen', open)
                }
            />
            <DatabaseUpgradeDialog
                open={Boolean(
                    databaseUpgradeOpen || systemHostDatabaseUpgradeOpen
                )}
            />
            <KeyboardShortcutsDialog
                open={Boolean(keyboardShortcutsOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('keyboardShortcutsOpen', open)
                }
            />
            <ProxySettingsDialog
                open={Boolean(proxySettingsOpen)}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('proxySettingsOpen', open)
                }
            />
        </>
    );
}
