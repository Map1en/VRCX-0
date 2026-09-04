import { lazy, useEffect } from 'react';
import { toast } from 'sonner';

import {
    getHostCapabilityUnavailableReason,
    isHostCapabilityAvailable,
    isHostCapabilitySupported,
    type HostCapabilityKey
} from '@/services/hostCapabilityService';
import { useRuntimeStore } from '@/state/runtimeStore';

import { DataDirCleanupHost } from './DataDirCleanupHost';
import { MountOnFirstOpen } from './MountOnFirstOpen';
import { ProfileRestoreResultHost } from './ProfileRestoreResultHost';
import { DatabaseMaintenanceDialog } from './system-dialogs/DatabaseMaintenanceDialog';
import { DatabaseUpgradeDialog } from './system-dialogs/DatabaseUpgradeDialog';
import { DataDirMigrationDialog } from './system-dialogs/DataDirMigrationDialog';
import { ProfileBackupDialogs } from './system-dialogs/ProfileBackupDialogs';
import { UpdaterDialog } from './system-dialogs/UpdaterDialog';
import { UpdateAvailableToastHost } from './UpdateAvailableToastHost';

const ChangelogDialog = lazy(() =>
    import('./system-dialogs/ChangelogDialog').then((module) => ({
        default: module.ChangelogDialog
    }))
);
const RegistryBackupDialog = lazy(() =>
    import('./system-dialogs/RegistryBackupDialog').then((module) => ({
        default: module.RegistryBackupDialog
    }))
);
const LaunchOptionsDialog = lazy(() =>
    import('./system-dialogs/LaunchOptionsDialog').then((module) => ({
        default: module.LaunchOptionsDialog
    }))
);
const VRChatConfigDialog = lazy(() =>
    import('./system-dialogs/VRChatConfigDialog').then((module) => ({
        default: module.VRChatConfigDialog
    }))
);
const KeyboardShortcutsDialog = lazy(() =>
    import('@/components/keyboard/KeyboardShortcutsDialog').then((module) => ({
        default: module.KeyboardShortcutsDialog
    }))
);
const ProxySettingsDialog = lazy(() =>
    import('@/components/proxy/ProxySettingsDialog').then((module) => ({
        default: module.ProxySettingsDialog
    }))
);

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
            capability: HostCapabilityKey,
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
            <ProfileRestoreResultHost />
            <DataDirCleanupHost />
            <DataDirMigrationDialog />
            <UpdateAvailableToastHost />
            <UpdaterDialog
                open={updaterOpen}
                onOpenChange={(open: boolean) =>
                    setSystemHostOpen('updaterOpen', open)
                }
            />
            <MountOnFirstOpen open={changelogOpen}>
                <ChangelogDialog
                    open={changelogOpen}
                    targetVersion={changelogTargetVersion}
                    onOpenChange={(open: boolean) => {
                        setSystemHostOpen('changelogOpen', open);
                        if (!open) {
                            setChangelogTargetVersion('');
                        }
                    }}
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={registryBackupOpen}>
                <RegistryBackupDialog
                    open={registryBackupOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('registryBackupOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={launchOptionsOpen}>
                <LaunchOptionsDialog
                    open={launchOptionsOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('launchOptionsOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={vrchatConfigOpen}>
                <VRChatConfigDialog
                    open={vrchatConfigOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('vrchatConfigOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <DatabaseUpgradeDialog
                open={databaseUpgradeOpen || systemHostDatabaseUpgradeOpen}
            />
            <DatabaseMaintenanceDialog />
            <ProfileBackupDialogs />
            <MountOnFirstOpen open={keyboardShortcutsOpen}>
                <KeyboardShortcutsDialog
                    open={keyboardShortcutsOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('keyboardShortcutsOpen', open)
                    }
                />
            </MountOnFirstOpen>
            <MountOnFirstOpen open={proxySettingsOpen}>
                <ProxySettingsDialog
                    open={proxySettingsOpen}
                    onOpenChange={(open: boolean) =>
                        setSystemHostOpen('proxySettingsOpen', open)
                    }
                />
            </MountOnFirstOpen>
        </>
    );
}
