import test from "node:test";
import assert from "node:assert/strict";
import { parseRangeHeader } from "./testable.mjs";

test("parses open ended byte ranges", () => {
    assert.deepEqual(parseRangeHeader("bytes=10-", 100), { start: 10, end: 99 });
});

test("parses suffix byte ranges", () => {
    assert.deepEqual(parseRangeHeader("bytes=-10", 100), { start: 90, end: 99 });
});

test("rejects invalid ranges", () => {
    assert.equal(parseRangeHeader("bytes=100-101", 100), null);
    assert.equal(parseRangeHeader("not-a-range", 100), null);
});
