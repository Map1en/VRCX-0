import { useLayoutEffect, useMemo, useRef } from 'react';

type Command = ((...args: never[]) => unknown) | undefined;
type AnyCommand = (...args: unknown[]) => unknown;

const MISSING_PREFIX = '!';

export function useStableCommands<T extends Record<string, Command>>(
    commands: T
): T {
    const latestRef = useRef(commands);
    useLayoutEffect(() => {
        latestRef.current = commands;
    });
    const signature = Object.entries(commands)
        .map(([key, command]) => (command ? key : `${MISSING_PREFIX}${key}`))
        .join('|');
    return useMemo(() => {
        const stable: Record<string, Command> = {};
        for (const entry of signature ? signature.split('|') : []) {
            if (entry.startsWith(MISSING_PREFIX)) {
                stable[entry.slice(MISSING_PREFIX.length)] = undefined;
                continue;
            }
            stable[entry] = (...args: unknown[]) =>
                (latestRef.current[entry] as AnyCommand | undefined)?.(...args);
        }
        return stable as T;
    }, [signature]);
}
