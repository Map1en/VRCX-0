import { useModalStore } from '@/state/modalStore.js';

import { normalizePlatformError } from '../platform/tauri/errors.js';
import { backend } from '../platform/tauri/index.js';
import { appI18n } from '@/services/i18nService.js';

function showSQLiteErrorModal(error) {
    const message =
        typeof error?.message === 'string'
            ? error.message
            : String(error ?? '');
    if (!message) {
        return;
    }

    const modalStore = useModalStore.getState();
    if (message.includes('database disk image is malformed')) {
        void modalStore.confirm({
            description:
                appI18n.t('repository.sqlite_repository.generated_modal.please_repair_or_delete_your_database_file_by_fo'),
            title: appI18n.t('repository.sqlite_repository.generated_modal.your_database_is_corrupted')
        });
        return;
    }
    if (message.includes('database or disk is full')) {
        void modalStore.alert({
            description: appI18n.t(
                'repository.sqlite_repository.generated_modal.disk_full_description'
            ),
            title: appI18n.t(
                'repository.sqlite_repository.generated_modal.disk_full_title'
            )
        });
        return;
    }
    if (
        message.includes('database is locked') ||
        message.includes('attempt to write a readonly database')
    ) {
        void modalStore.alert({
            description: appI18n.t(
                'repository.sqlite_repository.generated_modal.database_locked_description'
            ),
            title: appI18n.t(
                'repository.sqlite_repository.generated_modal.database_locked_title'
            )
        });
        return;
    }
    if (message.includes('disk I/O error')) {
        void modalStore.alert({
            description: appI18n.t(
                'repository.sqlite_repository.generated_modal.disk_io_error_description'
            ),
            title: appI18n.t(
                'repository.sqlite_repository.generated_modal.disk_io_error_title'
            )
        });
    }
}

async function query(sql, args = null) {
    try {
        return await backend.sqlite.execute(sql, args);
    } catch (error) {
        showSQLiteErrorModal(error);
        throw normalizePlatformError(error, 'SQLite query failed');
    }
}

async function all(sql, args = null) {
    return query(sql, args);
}

async function execute(callbackOrSql, sqlOrArgs = null, maybeArgs = null) {
    if (typeof callbackOrSql === 'function') {
        const rows = await query(sqlOrArgs, maybeArgs);
        if (Array.isArray(rows)) {
            for (const row of rows) {
                callbackOrSql(row);
            }
        }
        return rows;
    }

    return query(callbackOrSql, sqlOrArgs);
}

async function executeNonQuery(sql, args = null) {
    try {
        return await backend.sqlite.executeNonQuery(sql, args);
    } catch (error) {
        showSQLiteErrorModal(error);
        throw normalizePlatformError(error, 'SQLite non-query failed');
    }
}

async function run(sql, args = null) {
    return executeNonQuery(sql, args);
}

async function transaction(steps) {
    await executeNonQuery('BEGIN');
    try {
        const result = await steps(sqliteRepository);
        await executeNonQuery('COMMIT');
        return result;
    } catch (error) {
        await executeNonQuery('ROLLBACK');
        throw error;
    }
}

const sqliteRepository = Object.freeze({
    query,
    all,
    execute,
    executeNonQuery,
    run,
    transaction
});

export { query, all, execute, executeNonQuery, run, transaction };
export default sqliteRepository;
