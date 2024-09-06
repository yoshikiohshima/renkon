import {ProgramState} from "../dist/renkon.js";
import {equal, assert, assertState} from "./tester.js";

function test2String(delay, value) {
  return `
  const a = new Promise((resolve) => setTimeout(() => resolve(${value}), ${delay}));
  const b = a + 1;
  `;
}

export async function test2_1() {
  // create a program with timer ticking at 50 ms
  const state = new ProgramState(0);

  state.setupProgram([test2String(1000, 10)]);

  // there should be two nodes
  assert(state.nodes.size, 2);

  // but they are not evaluated yet.
  assertState(state, "a", undefined);
  assertState(state, "b", undefined);
  
  // evaluate the program at t=0
  state.evaluate(0);

  assertState(state, "a", undefined);
  assertState(state, "b", undefined);

  await new Promise((resolve) => setTimeout(() => resolve(), 1100));

  // logical time is separated from the physical time so 10 in logical time still triggers things
  state.evaluate(10);
  assertState(state, "a", 10);
  assertState(state, "b", 11);

  // the program itself is updated with a different tick. The computed values stay

  state.setupProgram([test2String(1000, 100)]);
  assertState(state, "a", undefined);
  assertState(state, "b", 11);

  // this evaluation creates the new Promise.
  state.evaluate(105);
  assertState(state, "a", undefined);
  assertState(state, "b", 11);

  await new Promise((resolve) => setTimeout(() => resolve(), 1100));
  state.evaluate(110);
  assertState(state, "a", 100);
  assertState(state, "b", 101);

  return true;
}

