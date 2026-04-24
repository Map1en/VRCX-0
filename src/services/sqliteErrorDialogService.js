import { subscribeSQLiteError } from '@/shared/sqliteErrorEvents.js';
import i18n from '@/services/i18nService.js';
import { useModalStore } from '@/state/modalStore.js';

const SQLITE_ERROR_DIALOGS = {
    malformed: {
        method: 'confirm',
        descriptionKey:
            'repository.sqlite_repository.generated_modal.please_repair_or_delete_your_database_file_by_fo',
        titleKey:
            'repository.sqlite_repository.generated_modal.your_database_is_corrupted'
    },
    disk_full: {
        method: 'alert',
        descriptionKey:
            'repository.sqlite_repository.generated_modal.disk_full_description',
        titleKey: 'repository.sqlite_repository.generated_modal.disk_full_title'
    },
    locked: {
        method: 'alert',
        descriptionKey:
            'repository.sqlite_repository.generated_modal.database_locked_description',
        titleKey:
            'repository.sqlite_repository.generated_modal.database_locked_title'
    },
    io_error: {
        method: 'alert',
        descriptionKey:
            'repository.sqlite_repository.generated_modal.disk_io_error_description',
        titleKey:
            'repository.sqlite_repository.generated_modal.disk_io_error_title'
    }
};

let unsubscribeSQLiteErrorListener = null;
const shownSQLiteErrors = new WeakSet();

function getSQLiteDialogDefinition(error) {
    if (!(error instanceof Error)) {
        return null;
    }
    return SQLITE_ERROR_DIALOGS[error.sqliteCategory] ?? null;
}

export function isKnownSQLiteError(error) {
    return Boolean(getSQLiteDialogDefinition(error));
}

export async function showSQLiteErrorDialog(error) {
    const dialog = getSQLiteDialogDefinition(error);
    if (!dialog) {
        return false;
    }

    if (shownSQLiteErrors.has(error)) {
        return false;
    }
    shownSQLiteErrors.add(error);

    const modalStore = useModalStore.getState();
    try {
        await modalStore[dialog.method]({
            description: i18n.t(dialog.descriptionKey),
            title: i18n.t(dialog.titleKey)
        });
    } catch (dialogError) {
        console.warn('Failed to show SQLite error dialog:', dialogError);
        return false;
    }
    return true;
}

export function bindSQLiteErrorDialogService() {
    if (unsubscribeSQLiteErrorListener) {
        return unsubscribeSQLiteErrorListener;
    }

    unsubscribeSQLiteErrorListener = subscribeSQLiteError((error) => {
        void showSQLiteErrorDialog(error);
    });

    return () => {
        if (unsubscribeSQLiteErrorListener) {
            unsubscribeSQLiteErrorListener();
            unsubscribeSQLiteErrorListener = null;
        }
    };
}
