import { beforeEach, describe, expect, it } from 'vitest';

import { useDataDirMigrationStore } from './dataDirMigrationStore';

const plan = {
    targetPath: 'D:\\VRCX-0',
    requiredBytes: 1024,
    availableBytes: 2048,
    targetState: 'empty' as const
};

describe('dataDirMigrationStore', () => {
    beforeEach(() => {
        const store = useDataDirMigrationStore.getState();
        store.closeDialog();
        useDataDirMigrationStore.setState({
            status: { revision: 0, state: 'idle' },
            lastAppliedRevision: -1
        });
    });

    it('keeps the newest runtime status', () => {
        const store = useDataDirMigrationStore.getState();
        store.applyStatus({
            revision: 2,
            state: 'running',
            phase: 'copying',
            percent: 50
        });
        store.applyStatus({ revision: 1, state: 'error' });

        expect(useDataDirMigrationStore.getState().status).toMatchObject({
            revision: 2,
            state: 'running',
            percent: 50
        });
    });

    it('opens each plan with a fresh idle presentation state', () => {
        const store = useDataDirMigrationStore.getState();
        store.applyStatus({ revision: 5, state: 'completed' });
        store.openDialog(plan);

        expect(useDataDirMigrationStore.getState()).toMatchObject({
            dialogOpen: true,
            plan,
            mode: 'migrate',
            status: { revision: 0, state: 'idle' },
            lastAppliedRevision: -1
        });
    });
});
