import { useEffect } from 'react';
import { toast } from 'sonner';

import {
    getHostCapabilityUnavailableReason,
    isHostCapabilityAvailable,
    isHostCapabilitySupported
} from '@/services/hostCapabilityService';
import { useRuntimeStore } from '@/state/runtimeStore';

import { DatabaseUpgradeDialog } from './system-dialogs/DatabaseUpgradeDialog';
import { ChangelogDialog } from './system-dialogs/ChangelogDialog';
import { LaunchOptionsDialog } from './system-dialogs/LaunchOptionsDialog';
import { RegistryBackupDialog } from './system-dialogs/RegistryBackupDialog';
import { UpdaterDialog } from './system-dialogs/UpdaterDialog';
import { VRChatConfigDialog } from './system-dialogs/VRChatConfigDialog';

export function SystemDialogsHost() {
    const updaterOpen = useRuntimeStore(
        (state: any) => state.systemHosts.updaterOpen
    );
    const changelogOpen = useRuntimeStore(
        (state: any) => state.systemHosts.changelogOpen
    );
    const registryBackupOpen = useRuntimeStore(
        (state: any) => state.systemHosts.registryBackupOpen
    );
    const launchOptionsOpen = useRuntimeStore(
        (state: any) => state.systemHosts.launchOptionsOpen
    );
    const vrchatConfigOpen = useRuntimeStore(
        (state: any) => state.systemHosts.vrchatConfigOpen
    );
    const databaseUpgradeOpen = useRuntimeStore(
        (state: any) => state.databaseUpgrade.open
    );
    const systemHostDatabaseUpgradeOpen = useRuntimeStore(
        (state: any) => state.systemHosts.databaseUpgradeOpen
    );
    const setSystemHostOpen = useRuntimeStore(
        (state: any) => state.setSystemHostOpen
    );
    const hostCapabilities = useRuntimeStore((state: any) => state.hostCapabilities);

    useEffect(() => {
        const guards = [
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
            <UpdaterDialog
                open={Boolean(updaterOpen)}
                onOpenChange={(open: any) => setSystemHostOpen('updaterOpen', open)}
            />
            <ChangelogDialog
                open={Boolean(changelogOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('changelogOpen', open)
                }
            />
            <RegistryBackupDialog
                open={Boolean(registryBackupOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('registryBackupOpen', open)
                }
            />
            <LaunchOptionsDialog
                open={Boolean(launchOptionsOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('launchOptionsOpen', open)
                }
            />
            <VRChatConfigDialog
                open={Boolean(vrchatConfigOpen)}
                onOpenChange={(open: any) =>
                    setSystemHostOpen('vrchatConfigOpen', open)
                }
            />
            <DatabaseUpgradeDialog
                open={Boolean(
                    databaseUpgradeOpen || systemHostDatabaseUpgradeOpen
                )}
            />
        </>
    );
}
