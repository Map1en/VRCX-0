export function createDensityPreset<
    C extends Readonly<Record<string, unknown>>
>(defaultValue: keyof C & string, configs: C) {
    const values = new Set(Object.keys(configs));

    function sanitize(value?: unknown): keyof C & string {
        const normalizedValue = typeof value === 'string' ? value.trim() : '';
        return values.has(normalizedValue)
            ? (normalizedValue as keyof C & string)
            : defaultValue;
    }

    function getConfig(value?: unknown): C[keyof C & string] {
        return configs[sanitize(value)];
    }

    return { sanitize, getConfig };
}
