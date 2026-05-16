// @ts-nocheck
import { useEffect } from 'react';
import { toast } from 'sonner';

import {
    getHostCapabilityUnavailableReason,
    isHostCapabilityAvailable,
    isHostCapabilitySupported
} from '@/services/hostCapabilityService.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';

import { DatabaseUpgradeDialog } from './system-dialogs/DatabaseUpgradeDialog';
import { LaunchOptionsDialog } from './system-dialogs/LaunchOptionsDialog';
import { RegistryBackupDialog } from './system-dialogs/RegistryBackupDialog';
import { UpdaterDialog } from './system-dialogs/UpdaterDialog';
import { VRChatConfigDialog } from './system-dialogs/VRChatConfigDialog';

export function SystemDialogsHost() {
    const updaterOpen = useRuntimeStore(
        (state) => state.systemHosts.updaterOpen
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
    const hostCapabilities = useRuntimeStore((state) => state.hostCapabilities);

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
                onOpenChange={(open) => setSystemHostOpen('updaterOpen', open)}
            />
            <RegistryBackupDialog
                open={Boolean(registryBackupOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('registryBackupOpen', open)
                }
            />
            <LaunchOptionsDialog
                open={Boolean(launchOptionsOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('launchOptionsOpen', open)
                }
            />
            <VRChatConfigDialog
                open={Boolean(vrchatConfigOpen)}
                onOpenChange={(open) =>
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
