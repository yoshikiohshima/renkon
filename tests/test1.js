import {ProgramState} from "../dist/renkon.js";
import {equal, assert, assertState} from "./tester.js";

function testTimerString(cls, interval) {
  return `
const a = ${cls}.timer(${interval});
const b = a + 5;
`;
}

export async function test1() {
  // create a program with timer ticking at 50 ms
  const state = new ProgramState(0);
  state.setupProgram([testTimerString("Behaviors", 50)]);

  // there should be two nodes
  assert(state.nodes.size, 2);

  let a = state.resolved.get("a");
  let b = state.resolved.get("b");

  // but they are not evaluated yet.
  assert(a, undefined);
  assert(b, undefined);
  
  // evaluate the program at t=0
  state.evaluate(0);

  // then timer is evaluated and b is also evaluated
  assertState(state, "a", 0);
  assertState(state, "b", 5);

  // timer has not hit the next tick so the values are unchanged.
  state.evaluate(10);
  assertState(state, "a", 0);
  assertState(state, "b", 5);

  // the time passes the next threshold (50) so they are updated
  state.evaluate(60);
  assertState(state, "a", 50);
  assertState(state, "b", 55);

  // the program itself is updated with a different tick. The one that got a different definition is cleared.
  state.setupProgram([testTimerString("Behaviors", 100)]);
  assertState(state, "a", undefined);
  assertState(state, "b", 55);

  // the program itself is updated with a different tick. The computed values stay
  state.evaluate(105);
  assertState(state, "a", 100);
  assertState(state, "b", 105);
  return true;
}


export async function test2() {
  //

  const test2String = `
    const c = Behaviors.collect([], Events.change(a), (cur, a) => a === 100 ? cur : [...cur, a])`;

  const state = new ProgramState(0);
  state.setupProgram([testTimerString("Behaviors", 50), test2String]);

  // there should be four nodes: three top level ones and an innner one Events.change(a)
  assert(state.nodes.size, 4);

  let a = state.resolved.get("a");
  let b = state.resolved.get("b");
  let c = state.resolved.get("c");

  // but they are not evaluated yet.
  assert(a, undefined);
  assert(b, undefined);
  assert(c, undefined);
  
  // evaluate the program at t=0
  state.evaluate(0);

  // then timer is evaluated and b is also evaluated. c's initial value was [] but the updater is evaluated.
  // a is however reset
  assertState(state, "a", 0);
  assertState(state, "b", 5);
  assertState(state, "c", [0]);

  const myC = state.resolved.get("c").value;

  // timer has not hit the next tick so the values are unchanged.
  state.evaluate(10);
  assertState(state, "a", 0);
  assertState(state, "b", 5);
  assertState(state, "c", [0]);

  assert(state.resolved.get("c").value === myC, true);

  // the time passes the next threshold (50) so they are updated
  state.evaluate(60);
  assertState(state, "a", 50);
  assertState(state, "b", 55);
  assertState(state, "c", [0, 50]); 


  // the time passes the next threshold (100) so they are updated
  state.evaluate(100);

  assertState(state, "a", 100);
  assertState(state, "b", 105);
  assertState(state, "c", [0, 50]); // 100 is filtered out in the updater function

  // the program itself is updated with a different tick. The stream with a different definition is cleared
  state.setupProgram([testTimerString("Behaviors", 100), test2String]);

  assertState(state, "a", undefined);
  assertState(state, "b", 105);
  assertState(state, "c", [0, 50]);

  // the program itself is updated with a different tick. The computed values stay
  state.evaluate(150);
  assertState(state, "a", 100);
  assertState(state, "b", 105);

  return true;
}

export async function test3() {
  //

  const test2String = `
    const c = Behaviors.collect([], Events.change(a), (cur, a) => a === 100 ? cur : [...cur, a])`;

  const state = new ProgramState(0);
  state.setupProgram([testTimerString("Events", 50), test2String]);

  // there should be four nodes: three top level ones and an innner one Events.change(a)
  assert(state.nodes.size, 4);

  let a = state.resolved.get("a");
  let b = state.resolved.get("b");
  let c = state.resolved.get("c");

  // but they are not evaluated yet.
  assert(a, undefined);
  assert(b, undefined);
  assert(c, undefined);
  
  // evaluate the program at t=0
  state.evaluate(0);

  // then timer is evaluated and b is also evaluated. c's initial value was [] but the updater is evaluated.
  // a is however reset
  assertState(state, "a", undefined);
  assertState(state, "b", 5);
  assertState(state, "c", [0]);

  const myC = state.resolved.get("c").value;

  // timer has not hit the next tick so the values are unchanged.
  state.evaluate(10);
  assertState(state, "a", undefined);
  assertState(state, "b", 5);
  assertState(state, "c", [0]);

  assert(state.resolved.get("c").value === myC, true);

  // the time passes the next threshold (50) so they are updated
  state.evaluate(60);
  assertState(state, "a", undefined);
  assertState(state, "b", 55);
  assertState(state, "c", [0, 50]); 


  // the time passes the next threshold (100) so they are updated
  state.evaluate(100);

  assertState(state, "a", undefined);
  assertState(state, "b", 105);
  assertState(state, "c", [0, 50]); // 100 is filtered out in the updater function

  // the program itself is updated with a different tick. The computed values stay
  state.setupProgram([testTimerString("Events", 100), test2String]);

  assertState(state, "a", undefined);
  assertState(state, "b", 105);
  assertState(state, "c", [0, 50]);

  // the program itself is updated with a different tick. The computed values stay
  state.evaluate(105);
  assertState(state, "a", undefined);
  assertState(state, "b", 105);

  return true;
}

export async function test4() {
  //

  const test4String = `
    const a = Events.timer(50);
    const b = Behaviors.timer(100);
    const c = Events.collect([], a, (cur, a) => a === 100 ? cur : [...cur, a]);
    const d = Behaviors.collect([], Events.change(b), (cur, a) => a === 100 ? cur : [...cur, a])`;

  const state = new ProgramState(0);
  state.setupProgram([test4String]);

  // there should be four nodes: three top level ones and an innner one Events.change(a)
  assert(state.nodes.size, 5);

  let a = state.resolved.get("a");
  let b = state.resolved.get("b");
  let c = state.resolved.get("c");
  let d = state.resolved.get("d");


  // but they are not evaluated yet.
  assert(a, undefined);
  assert(b, undefined);
  assert(c, undefined);
  assert(d, undefined);

  // evaluate the program at t=0


  state.evaluate(0);

  // then timer is evaluated and b is also evaluated.
  // a and c is however reset

  assertState(state, "a", undefined);
  assertState(state, "b", 0);
  assertState(state, "c", undefined);
  assertState(state, "d", [0]);

  const myScratch = state.scratch.get("c").current;

  assert(equal(myScratch, [0]), true);

  // timer has not hit the next tick so the values are unchanged.
  state.evaluate(10);
  assertState(state, "a", undefined);
  assertState(state, "b", 0);
  assertState(state, "c", undefined);
  assertState(state, "d", [0]);

  assert(state.scratch.get("c").current === myScratch, true);

  // the time passes the next threshold (50) so they are updated
  state.evaluate(60);
  assertState(state, "a", undefined);
  assertState(state, "b", 0);
  assertState(state, "c", undefined);
  assertState(state, "d", [0]); 

  assert(state.scratch.get("c").current, [0, 50]);

  // the time passes the next threshold (100) so they are updated
  state.evaluate(100);

  assertState(state, "a", undefined);
  assertState(state, "b", 100);
  assertState(state, "c", undefined);
  assertState(state, "d", [0]);

  assert(state.scratch.get("c").current, [0, 50]);

  return true;
}
