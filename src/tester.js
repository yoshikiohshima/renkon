import {setupProgram, evaluator, evaluate, ProgramState} from "../dist/renkon.js";

function assert(a, b) {
  if (a !== b) {
    console.log("!==", a, b);
  }
}

function assertState(state, aName, value) {
  const a = state.resolved.get(aName)?.value;
  return assert(a, value);
}

function testTimerString(interval) {
  return `
const a = Behaviors.timer(${interval});
const b = a + 5;
`;
}

export function test1() {
  // create a program with timer ticking at 50 ms
  const state = new ProgramState(0);
  setupProgram([testTimerString(50)], state);

  // there should be two nodes
  assert(state.nodes.size, 2);

  let a = state.resolved.get("a");
  let b = state.resolved.get("b");

  // but they are not evaluated yet.
  assert(a, undefined);
  assert(b, undefined);
  
  // evaluate the program at t=0
  evaluate(state, 0);

  // then timer is evaluated and b is also evaluated
  a = state.resolved.get("a");
  b = state.resolved.get("b");
  assertState(state, "a", 0);
  assertState(state, "b", 5);

  // timer has not hit the next tick so the values are unchanged.
  evaluate(state, 10);
  assertState(state, "a", 0);
  assertState(state, "b", 5);

  // the time passes the next threshold (50) so they are updated
  evaluate(state, 60);
  assertState(state, "a", 50);
  assertState(state, "b", 55);

  // the program itself is updated with a different tick. The computed values stay
  setupProgram([testTimerString(100)], state);
  assertState(state, "a", 50);
  assertState(state, "b", 55);

  // the program itself is updated with a different tick. The computed values stay
  evaluate(state, 105);
  assertState(state, "a", 100);
  assertState(state, "b", 105);
}
