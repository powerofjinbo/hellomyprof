export const DIRECTIONS = Object.freeze({
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
});

function positionToKey(position) {
  return `${position.x},${position.y}`;
}

function makeRng(rng) {
  return typeof rng === 'function' ? rng : Math.random;
}

export function keyToDirection(raw) {
  if (!raw) {
    return null;
  }
  const key = String(raw).toLowerCase();
  if (key === 'arrowup' || key === 'w') return DIRECTIONS.up;
  if (key === 'up') return DIRECTIONS.up;
  if (key === 'arrowdown' || key === 's') return DIRECTIONS.down;
  if (key === 'down') return DIRECTIONS.down;
  if (key === 'arrowleft' || key === 'a') return DIRECTIONS.left;
  if (key === 'left') return DIRECTIONS.left;
  if (key === 'arrowright' || key === 'd') return DIRECTIONS.right;
  if (key === 'right') return DIRECTIONS.right;
  return null;
}

function isOpposite(a, b) {
  return a.x === -b.x && a.y === -b.y;
}

export function placeFood(width, height, snake, getRandom = Math.random) {
  const rng = makeRng(getRandom);
  const occupied = new Set(snake.map(positionToKey));
  const free = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const point = `${x},${y}`;
      if (!occupied.has(point)) {
        free.push({ x, y });
      }
    }
  }

  if (free.length === 0) {
    return null;
  }

  const index = Math.floor(rng() * free.length);
  return free[index];
}

export function createSnakeState({ width = 20, height = 20, getRandom = Math.random } = {}) {
  const boardWidth = Math.max(4, Math.floor(width));
  const boardHeight = Math.max(4, Math.floor(height));
  const snake = [{ x: Math.floor(boardWidth / 2), y: Math.floor(boardHeight / 2) }];
  const direction = DIRECTIONS.right;

  return {
    width: boardWidth,
    height: boardHeight,
    snake,
    direction,
    nextDirection: direction,
    food: placeFood(boardWidth, boardHeight, snake, getRandom),
    score: 0,
    tick: 0,
    status: 'running',
    getRandom,
  };
}

export function queueDirection(state, direction) {
  if (!state || state.status !== 'running') {
    return state;
  }
  if (!direction) {
    return state;
  }
  if (isOpposite(direction, state.direction)) {
    return state;
  }
  if (state.nextDirection && isOpposite(direction, state.direction)) {
    return state;
  }
  return {
    ...state,
    nextDirection: direction,
  };
}

export function advanceState(state) {
  if (!state || state.status !== 'running') {
    return state;
  }

  const direction = state.nextDirection;
  const head = state.snake[0];
  const nextHead = { x: head.x + direction.x, y: head.y + direction.y };

  const hitWall =
    nextHead.x < 0 ||
    nextHead.y < 0 ||
    nextHead.x >= state.width ||
    nextHead.y >= state.height;
  if (hitWall) {
    return { ...state, status: 'gameOver', direction };
  }

  const ateFood = state.food && nextHead.x === state.food.x && nextHead.y === state.food.y;
  const nextSnake = [nextHead, ...state.snake];
  if (!ateFood) {
    nextSnake.pop();
  }

  const collided = nextSnake
    .slice(1)
    .some((segment) => segment.x === nextHead.x && segment.y === nextHead.y);

  if (collided) {
    return { ...state, status: 'gameOver', direction };
  }

  let score = state.score;
  let food = state.food;
  if (ateFood) {
    score += 1;
    food = placeFood(state.width, state.height, nextSnake, state.getRandom);
    if (!food) {
      return {
        ...state,
        snake: nextSnake,
        direction,
        nextDirection: direction,
        food,
        score,
        status: 'won',
        tick: state.tick + 1,
      };
    }
  }

  return {
    ...state,
    snake: nextSnake,
    direction,
    nextDirection: direction,
    food,
    score,
    tick: state.tick + 1,
    status: 'running',
  };
}
