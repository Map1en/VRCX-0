import { MyAvatarGridCard } from './MyAvatarsViewParts.jsx';

export function MyAvatarsGridView({
    gridScrollRef,
    gridTotalHeight,
    visibleGridRows,
    gridGap,
    gridColumnCount,
    gridMinWidth,
    currentAvatarId,
    cardScale,
    savingTagsAvatarId,
    updatingAvatarId,
    uploadingImageAvatarId,
    onAvatarAction
}) {
    return (
        <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-auto py-2">
            <div
                className="relative p-1"
                style={{
                    height: `${gridTotalHeight}px`
                }}
            >
                {visibleGridRows.map((row) => (
                    <div
                        key={row.key}
                        className="absolute right-1 left-1 grid overflow-hidden"
                        style={{
                            height: `${row.height}px`,
                            gap: `${gridGap}px`,
                            gridTemplateColumns: `repeat(${gridColumnCount}, minmax(${gridMinWidth}px, 1fr))`,
                            transform: `translateY(${row.top}px)`
                        }}
                    >
                        {row.avatars.map((avatar) => (
                            <MyAvatarGridCard
                                key={avatar.id}
                                avatar={avatar}
                                currentAvatarId={currentAvatarId}
                                cardScale={cardScale}
                                isUpdating={
                                    savingTagsAvatarId === avatar.id ||
                                    updatingAvatarId === avatar.id ||
                                    uploadingImageAvatarId === avatar.id
                                }
                                onAction={(action, nextAvatar) =>
                                    void onAvatarAction(action, nextAvatar)
                                }
                            />
                        ))}
                    </div>
                ))}
            </div>
        </div>
    );
}
