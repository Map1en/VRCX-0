import { UserPickerRow } from '@/components/search/UserPickerRow';
import type { FriendRecord } from '@/domain/friends/types';
import { cn } from '@/lib/utils';

interface MentionMenuProps {
    label: string;
    candidates: readonly FriendRecord[];
    activeIndex: number;
    onPick: (friend: FriendRecord) => void;
    onHover: (index: number) => void;
}

export function MentionMenu({
    label,
    candidates,
    activeIndex,
    onPick,
    onHover
}: MentionMenuProps) {
    return (
        <div
            role="listbox"
            aria-label={label}
            className="bg-popover text-popover-foreground border-border/70 absolute bottom-full left-0 z-10 mb-2 w-72 overflow-hidden rounded-xl border p-1 shadow-md"
        >
            {candidates.map((friend, index) => (
                <button
                    key={friend.id}
                    type="button"
                    role="option"
                    aria-selected={index === activeIndex}
                    className={cn(
                        'flex w-full cursor-pointer rounded-lg',
                        index === activeIndex && 'bg-(--state-hover-surface)'
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => onHover(index)}
                    onClick={() => onPick(friend)}
                >
                    <UserPickerRow
                        option={{ label: friend.displayName, user: friend }}
                        showSelection={false}
                    />
                </button>
            ))}
        </div>
    );
}
