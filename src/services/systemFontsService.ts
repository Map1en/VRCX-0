import { commands } from '@/platform/tauri/bindings';

let cache: Promise<string[]> | null = null;
let unavailableWarningConsumed = false;

export function loadSystemFonts(): Promise<string[]> {
    if (!cache) {
        cache = commands
            .appListSystemFonts()
            .then((fonts: unknown) => {
                const list = Array.isArray(fonts) ? fonts : [];
                if (!list.length) {
                    cache = null;
                }
                return list;
            })
            .catch((): string[] => {
                cache = null;
                return [];
            });
    }
    return cache;
}

export function consumeSystemFontsUnavailableWarning(fonts: readonly string[]) {
    if (fonts.length || unavailableWarningConsumed) {
        return false;
    }
    unavailableWarningConsumed = true;
    return true;
}
