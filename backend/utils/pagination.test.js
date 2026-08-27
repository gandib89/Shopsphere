import assert from "node:assert/strict";
import test from "node:test";

import { parsePagination } from "./pagination.js";

test("no page/limit in query stays unpaginated with a hard cap", () => {
  const result = parsePagination({});
  assert.equal(result.paginated, false);
  assert.deepEqual(result.prismaArgs, { take: 1000 });
});

test("page/limit in query switches to a paginated skip/take", () => {
  const result = parsePagination({ page: "2", limit: "10" });
  assert.equal(result.paginated, true);
  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 10);
  assert.deepEqual(result.prismaArgs, { skip: 10, take: 10 });
});

test("limit is clamped to the max page size", () => {
  const result = parsePagination({ limit: "9999" });
  assert.equal(result.pageSize, 200);
});

test("invalid page/limit values fall back to sane defaults", () => {
  const result = parsePagination({ page: "not-a-number", limit: "-5" });
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 50);
});
