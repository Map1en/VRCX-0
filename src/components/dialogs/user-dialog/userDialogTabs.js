export function resolveTabValue(tabs, preferred, fallback = 'info') {
    return tabs.some((tab) => tab.value === preferred) ? preferred : fallback;
}
