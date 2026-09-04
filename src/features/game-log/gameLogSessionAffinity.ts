import { createContext, useContext } from 'react';

export type GameLogSessionAffinity = {
    favoriteIdSet: ReadonlySet<string>;
    friendIdSet: ReadonlySet<string>;
};

export const GameLogSessionAffinityContext =
    createContext<GameLogSessionAffinity | null>(null);

export function useGameLogSessionAffinity(): GameLogSessionAffinity {
    const affinity = useContext(GameLogSessionAffinityContext);
    if (!affinity) {
        throw new Error('GameLog session affinity requires a provider.');
    }
    return affinity;
}
