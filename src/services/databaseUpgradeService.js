import { backend } from '@/platform/index.js';
import { configRepository } from '@/repositories/index.js';
import { useModalStore } from '@/state/modalStore.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { useSessionStore } from '@/state/sessionStore.js';
import { database } from '@/services/database/index.js';

const DATABASE_VERSION = 16;

function setUpgradeState(patch) {
    useRuntimeStore.getState().setDatabaseUpgradeState(patch);
}

async function runFullDatabaseUpgrade() {
    const currentVersion = await configRepository.getInt('databaseVersion', 0);

    if (currentVersion >= DATABASE_VERSION) {
        setUpgradeState({
            open: false,
            phase: 'completed',
            fromVersion: currentVersion,
            toVersion: DATABASE_VERSION,
            detail: 'Database schema is current.',
            legacyMigrationAvailable: false
        });
        useSessionStore.getState().setSessionState({ databaseReady: true });
        return true;
    }

    setUpgradeState({
        open: currentVersion > 0,
        phase: 'running',
        fromVersion: currentVersion,
        toVersion: DATABASE_VERSION,
        detail: `Updating database from ${currentVersion} to ${DATABASE_VERSION}.`,
        legacyMigrationAvailable: false
    });

    try {
        await database.cleanLegendFromFriendLog();
        await database.fixGameLogTraveling();
        await database.fixNegativeGPS();
        await database.fixBrokenLeaveEntries();
        await database.fixBrokenGroupInvites();
        await database.fixBrokenNotifications();
        await database.fixBrokenGroupChange();
        await database.fixCancelFriendRequestTypo();
        await database.fixBrokenGameLogDisplayNames();
        await database.upgradeDatabaseVersion();
        await database.vacuum();
        await database.optimize();
        await configRepository.setInt('databaseVersion', DATABASE_VERSION);

        setUpgradeState({
            open: false,
            phase: 'completed',
            fromVersion: currentVersion,
            toVersion: DATABASE_VERSION,
            detail: 'Database update complete.'
        });
        useSessionStore.getState().setSessionState({ databaseReady: true });
        return true;
    } catch (error) {
        console.error('Database upgrade failed:', error);
        setUpgradeState({
            open: false,
            phase: 'error',
            detail: error instanceof Error ? error.message : String(error)
        });
        await useModalStore.getState().alert({
            title: 'Database upgrade failed',
            description:
                'VRCX failed to apply a local database upgrade. Developer tools will open so the error can be inspected.',
            dismissible: false
        });
        await backend.app.ShowDevTools().catch(() => {});
        useSessionStore.getState().setSessionState({ databaseReady: false });
        return false;
    }
}

export async function initializeDatabaseUpgradeFlow() {
    let legacyAvailable = false;

    try {
        legacyAvailable = Boolean(await backend.app.CheckLegacyVrcxAvailable());
    } catch (error) {
        console.warn('Legacy VRCX availability check failed:', error);
    }

    if (legacyAvailable) {
        setUpgradeState({
            open: true,
            phase: 'confirm-legacy-migration',
            fromVersion: 0,
            toVersion: DATABASE_VERSION,
            detail:
                'A legacy VRCX installation was detected. Confirm migration to let the host copy legacy data and restart, or skip to continue with the current database.',
            legacyMigrationAvailable: true
        });
        useSessionStore.getState().setSessionState({ databaseReady: false });
        return false;
    }

    return runFullDatabaseUpgrade();
}

export async function confirmLegacyDatabaseMigration() {
    setUpgradeState({
        open: true,
        phase: 'restarting',
        detail: 'Requesting legacy migration from the Tauri host.'
    });

    try {
        const willRestart = await backend.app.RequestLegacyMigration();
        if (willRestart) {
            return;
        }
    } catch (error) {
        console.error('Legacy migration request failed:', error);
    }

    setUpgradeState({
        open: true,
        phase: 'confirm-legacy-migration',
        detail:
            'The host did not restart for legacy migration. You can try again or skip and continue with the current database.'
    });
}

export async function skipLegacyDatabaseMigration() {
    setUpgradeState({
        open: false,
        phase: 'running',
        detail: 'Skipping legacy migration and continuing database initialization.',
        legacyMigrationAvailable: false
    });
    return runFullDatabaseUpgrade();
}
