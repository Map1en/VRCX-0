function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function structuralEqual(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) {
        return true;
    }
    if (Array.isArray(left) && Array.isArray(right)) {
        return (
            left.length === right.length &&
            left.every((item, index) => structuralEqual(item, right[index]))
        );
    }
    if (isPlainObject(left) && isPlainObject(right)) {
        const leftKeys = Object.keys(left);
        if (leftKeys.length !== Object.keys(right).length) {
            return false;
        }
        return leftKeys.every(
            (key) =>
                Object.hasOwn(right, key) &&
                structuralEqual(left[key], right[key])
        );
    }
    return false;
}
