export function resolveTabValue(
    tabs: ReadonlyArray<{ value: string }>,
    preferred: string,
    fallback = 'info'
) {
    return tabs.some((tab) => tab.value === preferred) ? preferred : fallback;
}
