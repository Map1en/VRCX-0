import { GameLogPageView } from './components/GameLogPageView.jsx';
import { useGameLogPageController } from './useGameLogPageController.js';

export function GameLogPage({ embedded = false } = {}) {
    const viewProps = useGameLogPageController({ embedded });

    return <GameLogPageView {...viewProps} />;
}
