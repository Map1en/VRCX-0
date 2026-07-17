import { PageScaffold } from '@/components/layout/PageScaffold';

import { PlayerListTableSection } from './components/PlayerListTableSection';
import { PlayerListWorldHeader } from './components/PlayerListWorldHeader';
import { usePlayerListPageController } from './usePlayerListPageController';

export function PlayerListPage({
    embedded = false
}: {
    embedded?: boolean;
} = {}) {
    const {
        actions,
        clockNow,
        detail,
        gameLogDisabled,
        instanceSnapshot,
        isGameRunning,
        loadStatus,
        playerListLocation,
        playerListStartedAt,
        viewData
    } = usePlayerListPageController();

    return (
        <PageScaffold
            embedded={embedded}
            className="overflow-x-hidden overflow-y-auto"
        >
            <PlayerListWorldHeader
                clockNow={clockNow}
                instanceSnapshot={instanceSnapshot}
                currentUserLocation={playerListLocation}
                friendCount={viewData.headerFriendCount}
                isGameRunning={isGameRunning}
                playerCount={viewData.headerPlayerCount}
                startedAt={playerListStartedAt}
            />

            <PlayerListTableSection
                detail={detail}
                filterContextKey={playerListLocation}
                filteredRows={viewData.filteredRows}
                gameLogDisabled={gameLogDisabled}
                isGameRunning={isGameRunning}
                isPlayerListSourceUnavailable={
                    viewData.isPlayerListSourceUnavailable
                }
                loadStatus={loadStatus}
                onOpenPlayer={actions.openPlayerRow}
                parsedLocation={viewData.parsedLocation}
                playerSourceRows={viewData.playerSourceRows}
            />
        </PageScaffold>
    );
}
