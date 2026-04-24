import { normalizePlatformError } from '../platform/tauri/errors.js';
import { backend } from '../platform/tauri/index.js';
import { notifySQLiteError } from '../shared/sqliteErrorEvents.js';

const SQLITE_ERROR_PATTERNS = [
    {
        category: 'malformed',
        code: 'SQLITE_CORRUPT',
        matches: ['database disk image is malformed']
    },
    {
        category: 'disk_full',
        code: 'SQLITE_FULL',
        matches: ['database or disk is full']
    },
    {
        category: 'locked',
        code: 'SQLITE_BUSY',
        matches: [
            'database is locked',
            'attempt to write a readonly database'
        ]
    },
    {
        category: 'io_error',
        code: 'SQLITE_IOERR',
        matches: ['disk I/O error']
    }
];

function getErrorMessage(error) {
    if (error instanceof Error) {
        return error.message || String(error);
    }
    if (typeof error === 'string') {
        return error;
    }
    if (error === undefined || error === null) {
        return '';
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
}

function classifySQLiteError(message) {
    const normalizedMessage = String(message || '').toLowerCase();
    const match = SQLITE_ERROR_PATTERNS.find((entry) =>
        entry.matches.some((pattern) =>
            normalizedMessage.includes(pattern.toLowerCase())
        )
    );
    if (!match) {
        return {
            category: 'unknown',
            code: 'SQLITE_ERROR'
        };
    }
    return {
        category: match.category,
        code: match.code
    };
}

function normalizeSQLiteError(error, fallbackMessage) {
    const originalMessage = getErrorMessage(error);
    const normalizedError = normalizePlatformError(error, fallbackMessage);
    const { category, code } = classifySQLiteError(originalMessage);
    normalizedError.sqliteCategory = category;
    normalizedError.sqliteCode = code;
    normalizedError.originalMessage = originalMessage;
    return normalizedError;
}

async function query(sql, args = null) {
    try {
        return await backend.sqlite.execute(sql, args);
    } catch (error) {
        const normalizedError = normalizeSQLiteError(
            error,
            'SQLite query failed'
        );
        notifySQLiteError(normalizedError);
        throw normalizedError;
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
        const normalizedError = normalizeSQLiteError(
            error,
            'SQLite non-query failed'
        );
        notifySQLiteError(normalizedError);
        throw normalizedError;
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
