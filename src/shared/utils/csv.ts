export function needsCsvQuotes(text: unknown): boolean {
    return (
        String(text).includes(',') ||
        String(text).includes('"') ||
        Array.from(String(text)).some((char) => char.charCodeAt(0) <= 31)
    );
}

export function formatCsvField(value: unknown): string {
    if (value === null || typeof value === 'undefined') {
        return '';
    }
    const text = String(value);
    if (needsCsvQuotes(text)) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
}

export function formatCsvRow(
    obj: Record<string, unknown> | null | undefined,
    fields: string[]
): string {
    return fields.map((field) => formatCsvField(obj?.[field])).join(',');
}
