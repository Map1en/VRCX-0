import { useTranslation } from 'react-i18next';
import {
    confirmLegacyDatabaseMigration,
    skipLegacyDatabaseMigration
} from '@/services/databaseUpgradeService.js';
import { useRuntimeStore } from '@/state/runtimeStore.js';
import { Button } from '@/ui/shadcn/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/ui/shadcn/dialog';

function getDatabaseUpgradeTitle(phase) {
    switch (phase) {
        case 'confirm-legacy-migration':
            return 'Legacy VRCX-0 Migration';
        case 'running':
            return 'Database Upgrade Running';
        case 'restarting':
            return 'Restarting for Migration';
        case 'error':
            return 'Database Upgrade Failed';
        default:
            return 'Database Upgrade';
    }
}

export function DatabaseUpgradeDialog({ open }) {
    const { t } = useTranslation();

    const databaseUpgrade = useRuntimeStore((state) => state.databaseUpgrade);
    const setDatabaseUpgradeState = useRuntimeStore(
        (state) => state.setDatabaseUpgradeState
    );

    return (
        <Dialog
            open={open}
            onOpenChange={(nextOpen) => {
                if (!nextOpen && databaseUpgrade.phase === 'running') {
                    return;
                }
                setDatabaseUpgradeState({ open: nextOpen });
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>
                        {getDatabaseUpgradeTitle(databaseUpgrade.phase)}
                    </DialogTitle>
                    <DialogDescription>
                        {databaseUpgrade.detail ||
                            'Local database migration status.'}
                    </DialogDescription>
                </DialogHeader>
                {databaseUpgrade.fromVersion || databaseUpgrade.toVersion ? (
                    <div className="bg-muted/30 text-muted-foreground rounded-md border p-3 text-sm">
                        {`Version ${databaseUpgrade.fromVersion || 0} -> ${databaseUpgrade.toVersion || 0}`}
                    </div>
                ) : null}
                <DialogFooter>
                    {databaseUpgrade.phase === 'confirm-legacy-migration' ? (
                        <>
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => {
                                    void skipLegacyDatabaseMigration();
                                }}
                            >
                                {t(
                                    'message.database.migration_skip'
                                )}
                            </Button>
                            <Button
                                type="button"
                                onClick={() => {
                                    void confirmLegacyDatabaseMigration();
                                }}
                            >
                                {t(
                                    'dialog.system.generated.migrate_and_restart'
                                )}
                            </Button>
                        </>
                    ) : (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={databaseUpgrade.phase === 'running'}
                            onClick={() =>
                                setDatabaseUpgradeState({ open: false })
                            }
                        >
                            {t('common.actions.close')}
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
