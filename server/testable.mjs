export function parseRangeHeader(value, size) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(value);
    if (!match) return null;
    const suffix = !match[1] && match[2] ? Number(match[2]) : 0;
    const start = match[1] ? Number(match[1]) : Math.max(0, size - suffix);
    const end = match[2] && match[1] ? Number(match[2]) : size - 1;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) return null;
    return { start, end: Math.min(end, size - 1) };
}
