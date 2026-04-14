import { backend } from '../platform/tauri/index.js';
import { normalizePlatformError } from '../platform/tauri/errors.js';
import { useModalStore } from '@/state/modalStore.js';

function showSQLiteErrorModal(error) {
    const message = typeof error?.message === 'string' ? error.message : String(error ?? '');
    if (!message) {
        return;
    }

    const modalStore = useModalStore.getState();
    if (message.includes('database disk image is malformed')) {
        void modalStore.confirm({
            description:
                'Please repair or delete your database file by following the VRCX database repair instructions.',
            title: 'Your database is corrupted'
        });
        return;
    }
    if (message.includes('database or disk is full')) {
        void modalStore.alert({
            description: 'The disk containing the database is full.',
            title: 'Disk containing database is full'
        });
        return;
    }
    if (
        message.includes('database is locked') ||
        message.includes('attempt to write a readonly database')
    ) {
        void modalStore.alert({
            description: 'Please close other applications that might be using the database file.',
            title: 'Database is locked'
        });
        return;
    }
    if (message.includes('disk I/O error')) {
        void modalStore.alert({
            description: 'A disk I/O error occurred while accessing the database.',
            title: 'Disk I/O error'
        });
    }
}

class SqliteRepository {
    async query(sql, args = null) {
        try {
            return await backend.sqlite.execute(sql, args);
        } catch (error) {
            showSQLiteErrorModal(error);
            throw normalizePlatformError(error, 'SQLite query failed');
        }
    }

    async all(sql, args = null) {
        return this.query(sql, args);
    }

    async execute(callbackOrSql, sqlOrArgs = null, maybeArgs = null) {
        if (typeof callbackOrSql === 'function') {
            const rows = await this.query(sqlOrArgs, maybeArgs);
            if (Array.isArray(rows)) {
                for (const row of rows) {
                    callbackOrSql(row);
                }
            }
            return rows;
        }

        return this.query(callbackOrSql, sqlOrArgs);
    }

    async executeNonQuery(sql, args = null) {
        try {
            return await backend.sqlite.executeNonQuery(sql, args);
        } catch (error) {
            showSQLiteErrorModal(error);
            throw normalizePlatformError(error, 'SQLite non-query failed');
        }
    }

    async run(sql, args = null) {
        return this.executeNonQuery(sql, args);
    }

    async transaction(steps) {
        await this.executeNonQuery('BEGIN');
        try {
            const result = await steps(this);
            await this.executeNonQuery('COMMIT');
            return result;
        } catch (error) {
            await this.executeNonQuery('ROLLBACK');
            throw error;
        }
    }
}

const sqliteRepository = new SqliteRepository();

export { SqliteRepository };
export default sqliteRepository;
