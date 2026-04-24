import { useRuntimeStore } from '@/state/runtimeStore.js';

import { DatabaseUpgradeDialog } from './system-dialogs/DatabaseUpgradeDialog.jsx';
import { LaunchOptionsDialog } from './system-dialogs/LaunchOptionsDialog.jsx';
import { RegistryBackupDialog } from './system-dialogs/RegistryBackupDialog.jsx';
import { UpdaterDialog } from './system-dialogs/UpdaterDialog.jsx';
import { VRChatConfigDialog } from './system-dialogs/VRChatConfigDialog.jsx';

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
