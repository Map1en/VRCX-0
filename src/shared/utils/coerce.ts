function normalizeNumber(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeBoolean(value: unknown): boolean {
    return value === true || value === 'true' || value === 1 || value === '1';
}

export { normalizeBoolean, normalizeNumber };
