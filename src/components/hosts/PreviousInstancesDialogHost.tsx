import { PreviousInstancesTableDialog } from '@/components/dialogs/PreviousInstancesTableDialog';
import { usePreviousInstancesDialogStore } from '@/state/previousInstancesDialogStore';

export function PreviousInstancesDialogHost() {
    const dialog = usePreviousInstancesDialogStore((state) => state.dialog);
    const setRows = usePreviousInstancesDialogStore(
        (state) => state.setPreviousInstancesDialogRows
    );
    const setOpen = usePreviousInstancesDialogStore(
        (state) => state.setPreviousInstancesDialogOpen
    );

    if (!dialog.open) {
        return null;
    }

    return (
        <PreviousInstancesTableDialog
            open={dialog.open}
            onOpenChange={setOpen}
            title={dialog.title}
            instances={dialog.rows}
            variant="world"
            onRowsChange={setRows}
            detailsOnly={dialog.detailsOnly}
        />
    );
}
