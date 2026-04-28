import { normalizePlatformError } from '../platform/tauri/errors.js';
import { backend } from '../platform/tauri/index.js';
import { notifySQLiteError } from '../shared/sqliteErrorEvents.js';

export type SQLiteValue = string | number | boolean | null | Uint8Array | undefined;
export type SQLiteParams = SQLiteValue[] | Record<string, SQLiteValue> | null;
export type SQLiteRow = Record<string, unknown> | unknown[];
export type SQLiteErrorCategory =
    | 'malformed'
    | 'disk_full'
    | 'locked'
    | 'io_error'
    | 'unknown';

export interface SQLiteError extends Error {
    sqliteCategory: SQLiteErrorCategory;
    sqliteCode: string;
    originalMessage: string;
}

export interface SQLiteRepository {
    query<T extends SQLiteRow = SQLiteRow>(
        sql: string,
        args?: SQLiteParams
    ): Promise<T[]>;
    all<T extends SQLiteRow = SQLiteRow>(
        sql: string,
        args?: SQLiteParams
    ): Promise<T[]>;
    execute<T extends SQLiteRow = SQLiteRow>(
        sql: string,
        args?: SQLiteParams
    ): Promise<T[]>;
    execute<T extends SQLiteRow = SQLiteRow>(
        callback: (row: T) => void,
        sql: string,
        args?: SQLiteParams
    ): Promise<T[]>;
    executeNonQuery(sql: string, args?: SQLiteParams): Promise<unknown>;
    run(sql: string, args?: SQLiteParams): Promise<unknown>;
    transaction<T>(
        steps: (repository: SQLiteRepository) => Promise<T> | T
    ): Promise<T>;
}

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
] satisfies Array<{
    category: Exclude<SQLiteErrorCategory, 'unknown'>;
    code: string;
    matches: string[];
}>;

function getErrorMessage(error: unknown): string {
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

function classifySQLiteError(message: unknown): {
    category: SQLiteErrorCategory;
    code: string;
} {
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

function normalizeSQLiteError(
    error: unknown,
    fallbackMessage: string
): SQLiteError {
    const originalMessage = getErrorMessage(error);
    const normalizedError = normalizePlatformError(
        error,
        fallbackMessage
    ) as SQLiteError;
    const { category, code } = classifySQLiteError(originalMessage);
    normalizedError.sqliteCategory = category;
    normalizedError.sqliteCode = code;
    normalizedError.originalMessage = originalMessage;
    return normalizedError;
}

async function query<T extends SQLiteRow = SQLiteRow>(
    sql: string,
    args: SQLiteParams = null
): Promise<T[]> {
    return queryWithInvoker(
        (querySql, queryArgs) => backend.sqlite.execute(querySql, queryArgs),
        'SQLite query failed',
        sql,
        args
    );
}

async function queryOnWriter<T extends SQLiteRow = SQLiteRow>(
    sql: string,
    args: SQLiteParams = null
): Promise<T[]> {
    return queryWithInvoker(
        (querySql, queryArgs) =>
            backend.sqlite.executeOnWriter(querySql, queryArgs),
        'SQLite writer query failed',
        sql,
        args
    );
}

async function queryWithInvoker<T extends SQLiteRow = SQLiteRow>(
    invokeQuery: (sql: string, args: SQLiteParams) => Promise<unknown>,
    fallbackMessage: string,
    sql: string,
    args: SQLiteParams = null
): Promise<T[]> {
    try {
        return (await invokeQuery(sql, args)) as T[];
    } catch (error) {
        const normalizedError = normalizeSQLiteError(error, fallbackMessage);
        notifySQLiteError(normalizedError);
        throw normalizedError;
    }
}

async function all<T extends SQLiteRow = SQLiteRow>(
    sql: string,
    args: SQLiteParams = null
): Promise<T[]> {
    return query(sql, args);
}

async function allOnWriter<T extends SQLiteRow = SQLiteRow>(
    sql: string,
    args: SQLiteParams = null
): Promise<T[]> {
    return queryOnWriter(sql, args);
}

async function execute<T extends SQLiteRow = SQLiteRow>(
    sql: string,
    args?: SQLiteParams
): Promise<T[]>;
async function execute<T extends SQLiteRow = SQLiteRow>(
    callback: (row: T) => void,
    sql: string,
    args?: SQLiteParams
): Promise<T[]>;
async function execute<T extends SQLiteRow = SQLiteRow>(
    callbackOrSql: string | ((row: T) => void),
    sqlOrArgs: string | SQLiteParams = null,
    maybeArgs: SQLiteParams = null
): Promise<T[]> {
    return executeWithQuery<T>(query, callbackOrSql, sqlOrArgs, maybeArgs);
}

async function executeOnWriter<T extends SQLiteRow = SQLiteRow>(
    sql: string,
    args?: SQLiteParams
): Promise<T[]>;
async function executeOnWriter<T extends SQLiteRow = SQLiteRow>(
    callback: (row: T) => void,
    sql: string,
    args?: SQLiteParams
): Promise<T[]>;
async function executeOnWriter<T extends SQLiteRow = SQLiteRow>(
    callbackOrSql: string | ((row: T) => void),
    sqlOrArgs: string | SQLiteParams = null,
    maybeArgs: SQLiteParams = null
): Promise<T[]> {
    return executeWithQuery<T>(
        queryOnWriter,
        callbackOrSql,
        sqlOrArgs,
        maybeArgs
    );
}

async function executeWithQuery<T extends SQLiteRow = SQLiteRow>(
    queryFn: (sql: string, args?: SQLiteParams) => Promise<T[]>,
    callbackOrSql: string | ((row: T) => void),
    sqlOrArgs: string | SQLiteParams = null,
    maybeArgs: SQLiteParams = null
): Promise<T[]> {
    if (typeof callbackOrSql === 'function') {
        const rows = await queryFn(sqlOrArgs as string, maybeArgs);
        if (Array.isArray(rows)) {
            for (const row of rows) {
                callbackOrSql(row);
            }
        }
        return rows;
    }

    return queryFn(callbackOrSql, sqlOrArgs as SQLiteParams);
}

async function executeNonQuery(
    sql: string,
    args: SQLiteParams = null
): Promise<unknown> {
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

async function run(
    sql: string,
    args: SQLiteParams = null
): Promise<unknown> {
    return executeNonQuery(sql, args);
}

async function transaction<T>(
    steps: (repository: SQLiteRepository) => Promise<T> | T
): Promise<T> {
    await executeNonQuery('BEGIN');
    try {
        const result = await steps(createWriterBoundRepository());
        await executeNonQuery('COMMIT');
        return result;
    } catch (error) {
        await executeNonQuery('ROLLBACK');
        throw error;
    }
}

function createWriterBoundRepository(): SQLiteRepository {
    return Object.freeze({
        query: queryOnWriter,
        all: allOnWriter,
        execute: executeOnWriter,
        executeNonQuery,
        run,
        transaction
    });
}

const sqliteRepository: SQLiteRepository = Object.freeze({
    query,
    all,
    execute,
    executeNonQuery,
    run,
    transaction
});

export { query, all, execute, executeNonQuery, run, transaction };
export default sqliteRepository;
