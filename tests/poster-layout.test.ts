import assert from "node:assert/strict";
import test from "node:test";

const { getBalancedPosterRows }: typeof import("../lib/poster-layout") =
  await import(new URL("../lib/poster-layout.ts", import.meta.url).href);

test("poster rows match the requested 25- and 18-player formations", () => {
  assert.deepEqual(getBalancedPosterRows(25), [5, 5, 5, 5, 5]);
  assert.deepEqual(getBalancedPosterRows(18), [4, 4, 4, 3, 3]);
});

test("partial five-row squads distribute gaps evenly instead of leaving a sparse final row", () => {
  const formations = new Map([
    [17, [4, 4, 3, 3, 3]],
    [18, [4, 4, 4, 3, 3]],
    [19, [4, 4, 4, 4, 3]],
    [20, [4, 4, 4, 4, 4]],
    [21, [5, 4, 4, 4, 4]],
    [22, [5, 5, 4, 4, 4]],
    [23, [5, 5, 5, 4, 4]],
    [24, [5, 5, 5, 5, 4]],
  ]);
  for (const [count, expected] of formations) assert.deepEqual(getBalancedPosterRows(count), expected);
});

test("every supported squad preserves each player once and their original ordering", () => {
  for (let count = 1; count <= 30; count += 1) {
    const sizes = getBalancedPosterRows(count);
    const players = Array.from({ length: count }, (_, index) => `player-${index}`);
    let offset = 0;
    const rows = sizes.map(size => {
      const row = players.slice(offset, offset + size);
      offset += size;
      return row;
    });

    assert.equal(offset, count, `All ${count} players fit`);
    assert.deepEqual(rows.flat(), players, `${count} players retain their order`);
    assert.equal(new Set(rows.flat()).size, count, `${count} players are unique`);
    assert.ok(sizes.every(size => Number.isInteger(size) && size > 0));
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `${count} players stay balanced`);
    assert.ok(sizes.every((size, index) => index === 0 || size <= sizes[index - 1]));
    if (count > 3) assert.ok(sizes.length >= Math.max(...sizes), `${count} players form a vertical composition`);
  }
});

test("empty, small and maximum squads have deliberate layouts", () => {
  assert.deepEqual(getBalancedPosterRows(0), []);
  assert.deepEqual(getBalancedPosterRows(1), [1]);
  assert.deepEqual(getBalancedPosterRows(2), [2]);
  assert.deepEqual(getBalancedPosterRows(3), [3]);
  assert.deepEqual(getBalancedPosterRows(4), [2, 2]);
  assert.deepEqual(getBalancedPosterRows(9), [3, 3, 3]);
  assert.deepEqual(getBalancedPosterRows(16), [4, 4, 4, 4]);
  assert.deepEqual(getBalancedPosterRows(30), [5, 5, 5, 5, 5, 5]);
});

test("invalid or unsupported squad sizes fail before creating an allocation", () => {
  for (const count of [-1, -0.5, 1.5, 30.5, 31, Number.MAX_SAFE_INTEGER, Number.NaN, Infinity, -Infinity]) {
    assert.throws(() => getBalancedPosterRows(count), RangeError);
  }
});
