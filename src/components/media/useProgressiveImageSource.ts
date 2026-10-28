import { useEffect, useState } from 'react';

import { decodeImage, isImageDecoded } from './imageDecodeCache';

type ProgressiveImageStatus = 'idle' | 'loading' | 'ready' | 'error';

type ProgressiveImageState = {
    shownSrc: string;
    status: ProgressiveImageStatus;
    target: string;
};

export function useProgressiveImageSource(src: string, placeholderSrc = '') {
    const [state, setState] = useState<ProgressiveImageState>(() => ({
        shownSrc: isImageDecoded(src) ? src : '',
        status: !src ? 'idle' : isImageDecoded(src) ? 'ready' : 'loading',
        target: src
    }));

    useEffect(() => {
        let active = true;

        if (!src) {
            setState((current) => ({
                shownSrc: placeholderSrc ? current.shownSrc : '',
                status: 'idle',
                target: ''
            }));
        } else if (isImageDecoded(src)) {
            setState({ shownSrc: src, status: 'ready', target: src });
            return undefined;
        } else {
            setState((current) => ({
                shownSrc: current.shownSrc,
                status: 'loading',
                target: src
            }));
            decodeImage(src).then(
                () => {
                    if (active) {
                        setState({
                            shownSrc: src,
                            status: 'ready',
                            target: src
                        });
                    }
                },
                () => {
                    if (active) {
                        setState({
                            shownSrc: '',
                            status: 'error',
                            target: src
                        });
                    }
                }
            );
        }

        if (placeholderSrc) {
            decodeImage(placeholderSrc).then(
                () => {
                    if (!active) {
                        return;
                    }
                    setState((current) =>
                        current.status === 'ready' || current.status === 'error'
                            ? current
                            : { ...current, shownSrc: placeholderSrc }
                    );
                },
                () => {}
            );
        }

        return () => {
            active = false;
        };
    }, [placeholderSrc, src]);

    return {
        isInterim: Boolean(state.shownSrc && state.shownSrc !== state.target),
        shownSrc: state.shownSrc,
        status: state.status
    };
}
