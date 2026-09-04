import { useEffect, useState } from 'react';

import { directAccessParse } from '@/services/directAccessService';

const DETECT_DELAY_MS = 600;

export function useDirectAccessCandidate(input: string): boolean {
    const [candidate, setCandidate] = useState('');

    useEffect(() => {
        if (!input) {
            setCandidate('');
            return undefined;
        }

        let active = true;
        const timer = setTimeout(() => {
            directAccessParse(input, 'detect')
                .then((recognized) => {
                    if (active && recognized) {
                        setCandidate(input);
                    }
                })
                .catch((error) => {
                    console.warn('Direct access detection failed:', error);
                });
        }, DETECT_DELAY_MS);

        return () => {
            active = false;
            clearTimeout(timer);
        };
    }, [input]);

    return Boolean(input) && candidate === input;
}
