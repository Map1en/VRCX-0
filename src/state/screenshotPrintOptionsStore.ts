import { create } from 'zustand';

import configRepository from '@/repositories/configRepository';

export type ScreenshotPrintStyle = 'modern' | 'classic';
export type ScreenshotPrintPeople = 'off' | 'count' | 'names';

export type ScreenshotPrintOptions = {
    style: ScreenshotPrintStyle;
    people: ScreenshotPrintPeople;
    playerCount: boolean;
    stay: boolean;
};

export const DEFAULT_SCREENSHOT_PRINT_OPTIONS: ScreenshotPrintOptions = {
    style: 'modern',
    people: 'count',
    playerCount: true,
    stay: true
};

const OPTIONS_KEY = 'VRCX_ScreenshotPrintOptions';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

export function parseScreenshotPrintOptions(
    raw: string
): ScreenshotPrintOptions {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return DEFAULT_SCREENSHOT_PRINT_OPTIONS;
    }
    if (!isRecord(value)) {
        return DEFAULT_SCREENSHOT_PRINT_OPTIONS;
    }
    const defaults = DEFAULT_SCREENSHOT_PRINT_OPTIONS;
    return {
        style:
            value.style === 'classic' || value.style === 'modern'
                ? value.style
                : defaults.style,
        people:
            value.people === 'off' ||
            value.people === 'count' ||
            value.people === 'names'
                ? value.people
                : defaults.people,
        playerCount:
            typeof value.playerCount === 'boolean'
                ? value.playerCount
                : defaults.playerCount,
        stay: typeof value.stay === 'boolean' ? value.stay : defaults.stay
    };
}

type ScreenshotPrintOptionsState = {
    options: ScreenshotPrintOptions;
    loaded: boolean;
    load(): Promise<ScreenshotPrintOptions>;
    save(options: ScreenshotPrintOptions): void;
};

export const useScreenshotPrintOptionsStore =
    create<ScreenshotPrintOptionsState>((set, get) => ({
        options: DEFAULT_SCREENSHOT_PRINT_OPTIONS,
        loaded: false,
        async load() {
            if (get().loaded) {
                return get().options;
            }
            const raw = await configRepository.getString(OPTIONS_KEY, '');
            const options = raw
                ? parseScreenshotPrintOptions(raw)
                : DEFAULT_SCREENSHOT_PRINT_OPTIONS;
            set({ options, loaded: true });
            return options;
        },
        save(options) {
            set({ options, loaded: true });
            void configRepository.setString(
                OPTIONS_KEY,
                JSON.stringify(options)
            );
        }
    }));
