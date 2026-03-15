import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnakeState, queueDirection, advanceState, placeFood, DIRECTIONS } from '../src/snake-core.mjs';

function fixedRandom(value) {
  return () => value;
}

test('moves snake forward in current direction', () => {
  const state = createSnakeState({
    width: 10,
    height: 10,
    getRandom: fixedRandom(0.3),
  });

  const moved = advanceState(state);
  const expectedX = state.snake[0].x + state.direction.x;
  const expectedY = state.snake[0].y + state.direction.y;

  assert.equal(moved.snake[0].x, expectedX);
  assert.equal(moved.snake[0].y, expectedY);
});

test('queues direction and rejects reverse direction', () => {
  const state = createSnakeState({ width: 8, height: 8, getRandom: fixedRandom(0.3) });
  const next = queueDirection(state, DIRECTIONS.left);

  assert.equal(next.nextDirection.x, state.direction.x);
  assert.equal(next.nextDirection.y, state.direction.y);
});

test('grows when food is eaten and score increments', () => {
  const state = createSnakeState({ width: 6, height: 6, getRandom: fixedRandom(0.5) });
  state.snake = [{ x: 2, y: 2 }];
  state.food = { x: 3, y: 2 };

  const moved = advanceState(state);

  assert.equal(moved.score, 1);
  assert.equal(moved.snake.length, 2);
  assert.equal(moved.snake[0].x, 3);
  assert.equal(moved.snake[0].y, 2);
});

test('ends game on wall collision', () => {
  const state = createSnakeState({ width: 4, height: 4, getRandom: fixedRandom(0.5) });
  state.snake = [{ x: 3, y: 2 }];
  state.direction = DIRECTIONS.right;
  state.nextDirection = DIRECTIONS.right;

  const moved = advanceState(state);

  assert.equal(moved.status, 'gameOver');
});

test('ends game on self collision', () => {
  const state = createSnakeState({ width: 5, height: 5, getRandom: fixedRandom(0.5) });
  state.snake = [
    { x: 2, y: 2 },
    { x: 2, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 1, y: 3 },
  ];
  state.direction = DIRECTIONS.up;
  state.nextDirection = DIRECTIONS.left;
  state.food = { x: 0, y: 0 };

  const moved = advanceState(state);

  assert.equal(moved.status, 'gameOver');
});

test('places food only on a free cell', () => {
  const snake = [
    { x: 0, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 0 },
  ];
  const food = placeFood(2, 2, snake, fixedRandom(0.9));

  assert.deepEqual(food, { x: 1, y: 1 });
});

test('returns null when board is full', () => {
  const snake = [];
  for (let y = 0; y < 2; y += 1) {
    for (let x = 0; x < 2; x += 1) {
      snake.push({ x, y });
    }
  }

  const food = placeFood(2, 2, snake, fixedRandom(0.1));
  assert.equal(food, null);
});
