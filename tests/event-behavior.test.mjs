import assert from 'node:assert/strict';

globalThis.localStorage = {
  data: new Map(),
  getItem(key) {
    return this.data.has(key) ? this.data.get(key) : null;
  },
  setItem(key, value) {
    this.data.set(key, String(value));
  },
  removeItem(key) {
    this.data.delete(key);
  }
};

const gameModule = await import('../game.js');
const { Game } = gameModule;

function makeGame() {
  return new Game(() => {}, () => {}, () => {}, () => {});
}

{
  const choiceIndexForEventKey = gameModule.choiceIndexForEventKey;

  assert.equal(choiceIndexForEventKey?.('ArrowLeft', 3), 0);
  assert.equal(choiceIndexForEventKey?.('ArrowUp', 3), 1);
  assert.equal(choiceIndexForEventKey?.('ArrowRight', 3), 2);
  assert.equal(choiceIndexForEventKey?.('1', 3), 0);
  assert.equal(choiceIndexForEventKey?.('2', 3), 1);
  assert.equal(choiceIndexForEventKey?.('3', 3), 2);
  assert.equal(choiceIndexForEventKey?.('ArrowRight', 2), 1);
  assert.equal(choiceIndexForEventKey?.('x', 3), null);
}

{
  const game = makeGame();
  const steps = [];
  game.step = (side) => steps.push(side);
  game.alive = true;
  game.paused = false;
  game.inEvent = true;

  game.applyEvent({
    apply: () => game.startAutoDig('right', 5000, 280, true)
  });

  assert.equal(game.inEvent, false);
  assert.equal(game.autoDigActive, true);
  assert.equal(game.autoDigSide, 'right');
  assert.deepEqual(steps, ['right']);
  game.stopAutoDig();
}
