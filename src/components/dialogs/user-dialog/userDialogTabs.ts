export function resolveTabValue(
    tabs: any,
    preferred: any,
    fallback: any = 'info'
) {
    return tabs.some((tab: any) => tab.value === preferred)
        ? preferred
        : fallback;
}
