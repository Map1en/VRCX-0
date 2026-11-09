import { RotateCcwIcon, Settings2Icon } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { MutualFriendsLayoutControls } from '@/components/mutual-friends/MutualFriendsLayoutControls';
import { MutualGraphBuildHint } from '@/components/mutual-friends/MutualGraphBuildHint';
import { mutualFriendIdsOf } from '@/lib/mutual-friends/mutualFriendsStrangers';
import { useMutualFriendGraphContext } from '@/lib/mutual-friends/useMutualFriendGraphContext';
import { useMutualFriendLabels } from '@/lib/mutual-friends/useMutualFriendLabels';
import { useMutualFriendsLayoutSettings } from '@/lib/mutual-friends/useMutualFriendsLayoutSettings';
import { useMutualFriendsSigmaLifecycle } from '@/lib/mutual-friends/useMutualFriendsSigmaLifecycle';
import { openUserDialog } from '@/services/dialogService';
import { useResolvedThemeMode } from '@/services/themeService';
import { useDialogStore } from '@/state/dialogStore';
import { HintTooltip } from '@/ui/hint-tooltip';
import { Button } from '@/ui/shadcn/button';
import {
    Popover,
    PopoverContent,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger
} from '@/ui/shadcn/popover';
import { Spinner } from '@/ui/shadcn/spinner';

import {
    assignUserMutualEgoCommunities,
    buildUserMutualEgoGraph
} from '../userDialogMutualEgoGraph';

export type UserDialogMutualGraphProps = {
    userId: string;
    displayName: string;
    rows: readonly Record<string, unknown>[];
};

export function UserDialogMutualGraph({
    userId,
    displayName,
    rows
}: UserDialogMutualGraphProps) {
    const graph = useMutualFriendGraphContext(true);
    const { t } = useTranslation();
    const { layoutSettings, resetLayoutSettings, setLayoutSetting } =
        useMutualFriendsLayoutSettings();
    const friendLabelsById = useMutualFriendLabels();
    const resolvedTheme = useResolvedThemeMode();
    const closeDialog = useDialogStore((state) => state.closeDialog);
    const selectedNodeIdRef = useRef('');

    const egoGraph = useMemo(() => {
        const rowsById = new Map(rows.map((row) => [row.id, row]));
        return buildUserMutualEgoGraph({
            center: { id: userId, label: displayName || userId },
            friends: mutualFriendIdsOf(rows).map((id) => {
                const rowName = rowsById.get(id)?.displayName;
                return {
                    id,
                    label:
                        friendLabelsById[id] ||
                        (typeof rowName === 'string' ? rowName : '') ||
                        id
                };
            }),
            links: graph.links,
            nodeById: graph.nodeById
        });
    }, [
        displayName,
        friendLabelsById,
        graph.links,
        graph.nodeById,
        rows,
        userId
    ]);
    const { communityIndexById, namedCommunityIndexes } = useMemo(() => {
        const assignment = assignUserMutualEgoCommunities(
            egoGraph,
            userId,
            resolvedTheme === 'dark'
        );
        return {
            communityIndexById: assignment.communityIndexById,
            namedCommunityIndexes: new Set(
                assignment.communities
                    .filter((community) => community.isNamed)
                    .map((community) => community.index)
            )
        };
    }, [egoGraph, resolvedTheme, userId]);
    const openNode = useCallback(
        (nodeId: string) => {
            if (nodeId !== userId) {
                openUserDialog({ userId: nodeId });
            }
        },
        [userId]
    );

    const sigma = useMutualFriendsSigmaLifecycle({
        graph: egoGraph,
        layoutSettings,
        communityIndexById,
        namedCommunityIndexes,
        resolvedTheme,
        crossCommunityOnly: false,
        selectedNodeId: '',
        selectedNodeIdRef,
        onSelectNode: openNode,
        forceLabels: true
    });

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
            {graph.needsGraphBuild ? (
                <MutualGraphBuildHint
                    className="self-start"
                    onBeforeNavigate={closeDialog}
                />
            ) : null}
            <div className="relative min-h-0 w-full flex-1 overflow-hidden rounded-md border">
                <div
                    ref={sigma.setGraphElementRef}
                    className="absolute inset-0"
                />
                <Popover>
                    <HintTooltip
                        label={t('view.charts.mutual_friend.settings.title')}
                    >
                        <PopoverTrigger
                            render={
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon-sm"
                                    className="absolute top-2 right-2 z-10"
                                >
                                    <Settings2Icon />
                                </Button>
                            }
                        />
                    </HintTooltip>
                    <PopoverContent
                        align="end"
                        className="flex w-80 flex-col gap-4"
                    >
                        <PopoverHeader>
                            <PopoverTitle>
                                {t('view.charts.mutual_friend.settings.title')}
                            </PopoverTitle>
                        </PopoverHeader>
                        <MutualFriendsLayoutControls
                            layoutSettings={layoutSettings}
                            setLayoutSetting={setLayoutSetting}
                        />
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="self-start"
                            onClick={resetLayoutSettings}
                        >
                            <RotateCcwIcon data-icon="inline-start" />
                            {t(
                                'view.charts.mutual_friend.settings.reset_defaults'
                            )}
                        </Button>
                    </PopoverContent>
                </Popover>
                {sigma.isLayoutRunning ? (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <Spinner className="text-muted-foreground size-4" />
                    </div>
                ) : null}
            </div>
        </div>
    );
}
