import { useEffect } from 'react';

import { commands } from '@/platform/tauri/bindings';
import {
    startI18nLanguageSync,
    startReactRuntimeServices,
    startThemeModeSync
} from '@/services/runtimeBootstrapService';
import { useFriendLogStore } from '@/state/friendLogStore';
import { useRuntimeStore } from '@/state/runtimeStore';
import { useSessionStore } from '@/state/sessionStore';

import { RemoteRuntimeStatus } from './RemoteRuntimeStatus';

const FRIEND_HISTORY_REFRESH_MS = 30_000;

export function AppBootstrap() {
    useEffect(() => startReactRuntimeServices(), []);
    useEffect(() => startI18nLanguageSync(), []);
    useEffect(() => startThemeModeSync(), []);
    useEffect(() => {
        let offeredLegacyMigration = false;
        let remoteDatabase: boolean | null = null;
        const openLegacyMigrationIfReady = () => {
            const session = useSessionStore.getState();
            const upgrade = useRuntimeStore.getState().databaseUpgrade;
            if (remoteDatabase === null) {
                return;
            }
            if (remoteDatabase && !session.isLoggedIn) {
                offeredLegacyMigration = false;
                if (
                    upgrade.open &&
                    upgrade.phase === 'confirm-legacy-migration'
                ) {
                    useRuntimeStore
                        .getState()
                        .setDatabaseUpgradeState({ open: false });
                }
                return;
            }
            if (
                offeredLegacyMigration ||
                !session.isLoggedIn ||
                !session.databaseReady ||
                !upgrade.legacyMigrationAvailable
            ) {
                return;
            }
            offeredLegacyMigration = true;
            useRuntimeStore.getState().setDatabaseUpgradeState({ open: true });
        };
        const unsubscribeSession = useSessionStore.subscribe(
            openLegacyMigrationIfReady
        );
        const unsubscribeRuntime = useRuntimeStore.subscribe(
            openLegacyMigrationIfReady
        );
        let active = true;
        void commands
            .appBootstrapStatusGet()
            .then((status) => {
                if (active) {
                    remoteDatabase = status.isRemote;
                    openLegacyMigrationIfReady();
                }
            })
            .catch(() => undefined);
        return () => {
            active = false;
            unsubscribeSession();
            unsubscribeRuntime();
        };
    }, []);
    useEffect(() => {
        let timer: number | null = null;
        let remoteDatabase = false;
        let disposed = false;
        const syncTimerWithSession = () => {
            const shouldRun =
                remoteDatabase && useSessionStore.getState().isLoggedIn;
            if (shouldRun && timer === null) {
                timer = window.setInterval(() => {
                    if (
                        remoteDatabase &&
                        useSessionStore.getState().isLoggedIn
                    ) {
                        useFriendLogStore.getState().bumpRevision();
                    }
                }, FRIEND_HISTORY_REFRESH_MS);
            } else if (!shouldRun && timer !== null) {
                window.clearInterval(timer);
                timer = null;
            }
        };
        const unsubscribe = useSessionStore.subscribe(syncTimerWithSession);
        void commands
            .appBootstrapStatusGet()
            .then((status) => {
                if (!disposed) {
                    remoteDatabase = status.isRemote;
                    syncTimerWithSession();
                }
            })
            .catch((error: unknown) => {
                console.warn(
                    'Could not determine storage mode for history refresh:',
                    error
                );
            });
        return () => {
            disposed = true;
            unsubscribe();
            if (timer !== null) {
                window.clearInterval(timer);
            }
        };
    }, []);
    return <RemoteRuntimeStatus />;
}
