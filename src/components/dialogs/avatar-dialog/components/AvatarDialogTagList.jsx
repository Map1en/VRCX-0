import { Badge } from '@/ui/shadcn/badge';

export function AvatarDialogTagList({ tags, trimPrefix = '' }) {
    if (!tags.length) {
        return null;
    }

    return (
        <div className="flex flex-wrap gap-2">
            {tags.map((tag) => (
                <Badge key={tag} variant="outline">
                    {trimPrefix ? tag.replace(trimPrefix, '') : tag}
                </Badge>
            ))}
        </div>
    );
}
