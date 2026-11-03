import { splitMentions } from '../mentions';
import { EntityChip } from './EntityChip';

export function MentionText({ text }: { text: string }) {
    return (
        <span className="whitespace-pre-wrap">
            {splitMentions(text).map((segment, index) =>
                segment.kind === 'text' ? (
                    segment.text
                ) : (
                    <EntityChip
                        key={`${segment.target.id}-${index}`}
                        kind={segment.target.kind}
                        id={segment.target.id}
                    >
                        @{segment.target.name}
                    </EntityChip>
                )
            )}
        </span>
    );
}
