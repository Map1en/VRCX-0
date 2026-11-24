import { useRef } from 'react';

import type { MyAvatarActionHandler } from './myAvatarsTypes';

export type MyAvatarsTableMeta = {
    onAvatarAction: MyAvatarActionHandler;
};

export function useMyAvatarsTableMeta(
    onAvatarAction: MyAvatarActionHandler
): MyAvatarsTableMeta {
    const metaRef = useRef<MyAvatarsTableMeta>({
        onAvatarAction
    });
    // eslint-disable-next-line react/refs
    return Object.assign(metaRef.current, { onAvatarAction });
}
