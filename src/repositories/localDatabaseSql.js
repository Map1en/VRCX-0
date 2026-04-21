function safeParameterPart(value) {
    return String(value || 'value').replace(/[^A-Za-z0-9_]/g, '_');
}

function buildInClause(column, values, prefix = 'in') {
    if (!Array.isArray(values) || values.length === 0) {
        return { clause: '', args: {} };
    }

    const args = {};
    const safePrefix = safeParameterPart(prefix);
    const placeholders = values.map((value, index) => {
        const key = `@${safePrefix}_${index}`;
        args[key] = value;
        return key;
    });

    return {
        clause: `${column} IN (${placeholders.join(', ')})`,
        args
    };
}

function columnNameFor(columnSpec) {
    return typeof columnSpec === 'string' ? columnSpec : columnSpec.column;
}

function valueFor(row, columnSpec) {
    if (typeof columnSpec === 'string') {
        return row[columnSpec];
    }
    if (typeof columnSpec.value === 'function') {
        return columnSpec.value(row);
    }
    return row[columnSpec.value ?? columnSpec.column];
}

function buildValuesList(rows, columns, prefix = 'value') {
    if (!Array.isArray(rows) || rows.length === 0) {
        return { valuesSql: '', args: {} };
    }
    if (!Array.isArray(columns) || columns.length === 0) {
        return { valuesSql: '', args: {} };
    }

    const args = {};
    const safePrefix = safeParameterPart(prefix);
    const valuesSql = rows
        .map((row, rowIndex) => {
            const placeholders = columns.map((columnSpec, columnIndex) => {
                const key = `@${safePrefix}_${safeParameterPart(columnNameFor(columnSpec))}_${rowIndex}_${columnIndex}`;
                args[key] = valueFor(row, columnSpec);
                return key;
            });
            return `(${placeholders.join(', ')})`;
        })
        .join(', ');

    return { valuesSql, args };
}

function clampSqlLimit(value, fallback = 500, max = 50000) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(parsed, max);
}

export { buildInClause, buildValuesList, clampSqlLimit };
