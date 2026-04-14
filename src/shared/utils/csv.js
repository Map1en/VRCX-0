/**
 * @param {string} text
 * @returns {boolean}
 */
export function needsCsvQuotes(text) {
    return String(text).includes(',') ||
        String(text).includes('"') ||
        Array.from(String(text)).some((char) => char.charCodeAt(0) <= 31);
}

/**
 * @param {*} value
 * @returns {string}
 */
export function formatCsvField(value) {
    if (value === null || typeof value === 'undefined') {
        return '';
    }
    const text = String(value);
    if (needsCsvQuotes(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

/**
 * @param {object} obj - The source object
 * @param {string[]} fields - Property names to include
 * @returns {string}
 */
export function formatCsvRow(obj, fields) {
    return fields.map((field) => formatCsvField(obj?.[field])).join(',');
}
