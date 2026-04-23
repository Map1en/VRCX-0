import { useRuntimeStore } from '@/state/runtimeStore.js';

import { DatabaseUpgradeDialog } from './system-dialogs/DatabaseUpgradeDialog.jsx';
import { LaunchOptionsDialog } from './system-dialogs/LaunchOptionsDialog.jsx';
import { RegistryBackupDialog } from './system-dialogs/RegistryBackupDialog.jsx';
import { UpdaterDialog } from './system-dialogs/UpdaterDialog.jsx';
import { VRChatConfigDialog } from './system-dialogs/VRChatConfigDialog.jsx';

export function SystemDialogsHost() {
    const systemHosts = useRuntimeStore((state) => state.systemHosts);
    const databaseUpgrade = useRuntimeStore((state) => state.databaseUpgrade);
    const setSystemHostOpen = useRuntimeStore(
        (state) => state.setSystemHostOpen
    );

    return (
        <>
            <UpdaterDialog
                open={Boolean(systemHosts.updaterOpen)}
                onOpenChange={(open) => setSystemHostOpen('updaterOpen', open)}
            />
            <RegistryBackupDialog
                open={Boolean(systemHosts.registryBackupOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('registryBackupOpen', open)
                }
            />
            <LaunchOptionsDialog
                open={Boolean(systemHosts.launchOptionsOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('launchOptionsOpen', open)
                }
            />
            <VRChatConfigDialog
                open={Boolean(systemHosts.vrchatConfigOpen)}
                onOpenChange={(open) =>
                    setSystemHostOpen('vrchatConfigOpen', open)
                }
            />
            <DatabaseUpgradeDialog
                open={Boolean(
                    databaseUpgrade.open || systemHosts.databaseUpgradeOpen
                )}
            />
        </>
    );
}
