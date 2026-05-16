// @ts-nocheck
import { GameLogPageView } from './components/GameLogPageView';
import { useGameLogPageController } from './useGameLogPageController.js';

export function GameLogPage({ embedded = false } = {}) {
    const viewProps = useGameLogPageController({ embedded });

    return <GameLogPageView {...viewProps} />;
}
