import { useEffect, useState } from 'react';

import { decodeImage, isImageDecoded } from './imageDecodeCache';

type ProgressiveImageStatus = 'idle' | 'loading' | 'ready' | 'error';

type ProgressiveImageState = {
    shownSrc: string;
    status: ProgressiveImageStatus;
    target: string;
};

const PLACEHOLDER_DELAY_MS = 120;

export function useProgressiveImageSource(src: string, placeholderSrc = '') {
    const [state, setState] = useState<ProgressiveImageState>(() => ({
        shownSrc: isImageDecoded(src) ? src : '',
        status: !src ? 'idle' : isImageDecoded(src) ? 'ready' : 'loading',
        target: src
    }));

    useEffect(() => {
        if (src && isImageDecoded(src)) {
            setState({ shownSrc: src, status: 'ready', target: src });
            return undefined;
        }

        let active = true;
        const placeholderTimer = placeholderSrc
            ? window.setTimeout(() => {
                  decodeImage(placeholderSrc).then(
                      () => {
                          if (!active) {
                              return;
                          }
                          setState((current) =>
                              current.status === 'ready' ||
                              current.status === 'error'
                                  ? current
                                  : { ...current, shownSrc: placeholderSrc }
                          );
                      },
                      () => {}
                  );
              }, PLACEHOLDER_DELAY_MS)
            : undefined;

        if (!src) {
            setState((current) => ({
                shownSrc: placeholderSrc ? current.shownSrc : '',
                status: 'idle',
                target: ''
            }));
        } else {
            setState((current) => ({
                shownSrc: current.shownSrc,
                status: 'loading',
                target: src
            }));
            decodeImage(src).then(
                () => {
                    window.clearTimeout(placeholderTimer);
                    if (active) {
                        setState({
                            shownSrc: src,
                            status: 'ready',
                            target: src
                        });
                    }
                },
                () => {
                    window.clearTimeout(placeholderTimer);
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

        return () => {
            active = false;
            window.clearTimeout(placeholderTimer);
        };
    }, [placeholderSrc, src]);

    return {
        isInterim: Boolean(
            placeholderSrc &&
            state.shownSrc === placeholderSrc &&
            state.shownSrc !== state.target
        ),
        shownSrc: state.shownSrc,
        status: state.status
    };
}
