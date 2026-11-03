import { useState } from 'react';

export function useSyncedDraft<T>(value: T): [T, (next: T) => void] {
    const [draft, setDraft] = useState(value);
    const [source, setSource] = useState(value);
    if (!Object.is(source, value)) {
        setSource(value);
        setDraft(value);
    }
    return [draft, setDraft];
}
