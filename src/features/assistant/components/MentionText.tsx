import { UserHoverCard } from '@/components/user-hover-card/UserHoverCard';
import { openUserDialog } from '@/services/dialogService';

import { splitMentions } from '../mentions';

export function MentionText({ text }: { text: string }) {
    return (
        <span className="whitespace-pre-wrap">
            {splitMentions(text).map((segment, index) =>
                segment.kind === 'text' ? (
                    segment.text
                ) : (
                    <UserHoverCard
                        key={`${segment.userId}-${index}`}
                        userId={segment.userId}
                    >
                        <button
                            type="button"
                            className="text-foreground cursor-pointer rounded-md bg-(--state-hover-surface) px-1 font-medium hover:bg-(--state-pressed-surface)"
                            onClick={() =>
                                openUserDialog({ userId: segment.userId })
                            }
                        >
                            @{segment.name}
                        </button>
                    </UserHoverCard>
                )
            )}
        </span>
    );
}
