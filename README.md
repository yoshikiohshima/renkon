# Renkon-Core: An FRP evaluator

## Introduction

Renkon is an FRP (Functional Reactive Programming) evaluator for building interactive web
and Node.js applications. A program consists of a set of reactive nodes. Each
node reacts to input changes and produces an output. Other nodes that
depend on the output, in turn, produce their outputs, and updates on
nodes propagate through the "dependency network."

Renkon stands out from other reactive web UI frameworks in three ways:

- Native Promises and Generators in JavaScript are integrated cleanly.
- Following the original FRP, discrete events and continuous values are separated.
- The definition of reactive nodes can be edited dynamically, even from within the environment itself.

This results in a very simple yet powerful framework compared to some existing ones:

- No need for "duct tapes" like `useEffect`. Asynchronous actions and state updates are nicely integrated.
- No need to manually create reactive state values and manage them by resetting them.
- Existing libraries, such as interfaces to an LLM, can be directly used.
- Quickly explore by modifying code in the live environment.
- The program is isomorphic to a box and wire diagram, opening up the possibility of different editing modes.

Here is a simple example code:

```JavaScript
const mod = import("./foo.js");
const hundred = new Promise((resolve) => setTimeout(() => resolve(100), 500));
const timer = Events.timer(1000);
console.log(mod.ten() + hundred + timer);
```

The first line with `import` returns a promise that resolves to a
JavaScript module. Let us assume that it exports a function called
`ten()` that returns number ten (10). The node `hundred` is a Promise that resolves
to 100 after 500ms. `timer` is an event that produces a new value
every 1000ms. The last line with the `console.log()` call depends on
three nodes (`mod`, `hundred`, and `timer`), and when each of these
has a value, the `console.log` function is executed, and you see an
output in the console. After `mod` and `hundred` have resolved, each
time `timer` updates, the `console.log()` line is
reevaluated. Consequently, you'd see a new `console.log` output added
to a sequence like `1110`, `2110`, `3110`...

Note that Renkon is a different language from JavaScript, though the
surface syntax of it draws upon JavaScript. In other words, a
JavaScript parser can parse any Renkon program but they work
differently.

## FRP in Nutshell

Functional Reactive Programming is a clean way to describe an
application as an acyclic graph of data dependency. Lately, all
popular UI frameworks have reactivity based on the same basic idea.

However, the original FRP had two concepts that recent reactive
frameworks failed to incorporate. One is the clear definition of
logical time and functions on the time domain. The other is the clear
separation between "events" that only exist at certain instants on the
time domain and "behaviors" that exist continuously on the time
domain. As you use Renkon and read this document, you will see the
benefits of these concepts.

When you construct an application in FRP, you think of the application
state as a set of "nodes," and each node's value is a function of time
<i>t</i>. A node is a function that uses values from other nodes and
computes its value. In other words, a node depends on other nodes, and
the dependency relationship forms a graph. When a "leaf" node changes
its value due to an event occurring at time _t_, the changes are
propagated through the dependency graph. The result is that the
application state is computed consistently for logical time _t_. When
a set of nodes compute the values the computation is done at the same
logical time, regardless of how much CPU time they actually use.  This
notion is sometimes called "synchronous," in the sense that all
computation takes exactly 0 time.

As described above, an event is a function that has a value only at
certain instants on the timeline. What is the value of an event when
there is no value in Renkon? Renkon is based on JavaScript, and
JavaScript conveniently has `undefined` and `null`. They may be
treated interchangeably in a regular JavaScript program, but Renkon
uses `undefined` to indicate that the value does not exist at the
time, while `null` is used to indicate that the value does exist but
is empty. In other words, a node won't be evaluated when one of the
dependencies is `undefined`.

## Renkon-Core, Renkon-Web and Renkon-Node
The evaluator of Renkon is written in JavaScript (TypeScript), and it independent from Web-based or Node-based execution enviornment. [Renkon-Web](https://github.com/yoshikiohshima/renkon-web) is the web-based environment with in-world code editor. [Renkon-Node](https://github.com/yoshikiohshima/renkon-node) is the Node.js based environment that can load a program from a file.

Refer to the README of each of those for their specifics, including how to set up your program.

## Renkon by Examples

Let us describe some more building blocks of Renkon. These are called
"combinators," which combine other FRP nodes to do more things.

The examples below assumes the web-based environment, where the browser built-in features such as `document.querySelector()` is available.

```JavaScript
const collection = Behaviors.collect([], Events.or(button, timer), (current, value) => {
    if (typeof value === "number") {
         return [...current, value];
    }
    return [];
});
const timer = Events.timer(1000);
const button = Events.listener(document.querySelector("#myButton"), "click", evt => evt);
console.log(collection);
```

In the example above, `Events.or()` is a combinator that produces a
new value when one of the arguments, in this case, `button` or
`timer`, gets a value. `Behaviors.collect` is a combinator that starts
from the initial value specified as the first argument, in this case
`[]`. The combinator uses the second argument, in this case
`Events.or(button, timer)` as the trigger. When the trigger gets a
value, the value of the combinator is computed by applying the updater
function as the third argument to the current value, and the value
from the trigger, and the value returned from it becomes the new
value. (In other languages, the combinator may be called `followed by`
or `fby`; it is an initial value followed by updates.)

The `button` node is created by the `Events.listener` call. It adds a
DOM event listener (in this case, `click`) to the button named
`myButton`.

Because the `Event.or` combinator "forwards" the value from one of the
arguments, the `value` argument for the updater is either a DOM click
event coming from the button click or a number coming from
`timer`. The body of the updater checks the type of `value`, and if it
is a number, it appends the value to the collection. If not, it resets
`collection` to an empty array. In effect, the collection gets a new
element each second but resets when the user presses the button.

Some combinators have both the "Event" variant and "Behavior" variant,
depending on whether the value should be available only at the instant
or kept until it changes again. In the example above, `collect` and
`timer` have both variants, but `Events.or` does not have a Behavior
counterpart. (... at the moment at least; it could be a kind of select operation
that keeps the last value from whichever argument). In general,
anything that is used as a kind of "trigger" should be an event, whose
value is cleared after the event's time t. In the above example,
`Behaviors.collect` can be changed to `Events.collect`, and the
program would produce the same sequence of output in the developer
console, as the collection value is computed and the console.log line
that depends on the collection is executed at time t. But if you want
to use the array in other parts of the program at a later time, it
should be a behavior that keeps the value.

A constant value is treated as a behavior, meaning that it is a
function that always returns the same value:

```JavaScript
const a = 3;
const b = a + 4;
```

In the program above, `a` is a behavior that is always 3, and `b` is also a behavior that is always 7.

A Promise is treated as something resolves to a value treated as
Behavior.This means that the value of the node is `undefined` until
the Promise resolves, and then the resolved value is available later on.

A Generator typically generates values repeatedly over time, and each
result is treated as an event. Imagine that there is a JS library
named "llama" that returns a word from an LLM at a time. In the
following code, `llama.llama()` returns an async generator. We have a
combinator called `Events.next` that gets a new value when the
generator produces it.

```JavaScript
...
const gen = llama.llama(enter, {...config.params}, config);
const v = Events.next(gen);

const log = Behaviors.collect([], v, (a, b) => {
    if (b.done) return [...a, b.value];
    return a;
});

```

There are "natural conversions" between Events and Behaviors. You can
convert an event to a behavior by making it a "step function" where
the last value of the event becomes the current value of the behavior.


```JavaScript
const anEvent = Events.timer(1000);
const b = Behaviors.keep(anEvent);
```

To create an event from a behavior, we assume that the behavior's time
domain is discretized in the implementation, and make an event that
fires when the value of the behavior changes.

```JavaScript
const aBehavior = Behaviors.timer(1000);
const e = Events.change(aBehavior);
```

## Creating DOM Elements as Values.

Renkon is agnostic to the display and DOM manipulation mechanism. For
example, one can write this on a page that has a `div` called
"output," and its text content updates every second:

```JavaScript
const timer = Events.timer(1000);
document.querySelector("#output").textContent = `${timer}`;
```

But this way of assigning a value quickly becomes unwieldy.

One can use the HTM library (Hyperscript Tagged Markup) from the
Preact community. HTM is like JSX used by React and other frameworks,
but it instead uses JavaScript's built-in "tagged templates" feature
to construct virtual DOM elements. It can "render" virtual DOM
elements as actual DOM elements. HTM is a great match with a reactive
framework, as the virtual DOM elements themselves can be used as
values within the framework. In other words, instead of writing code
that "does" something on a DOM element to make it so, you write code
to produce a value that says the DOM should "be" like this. If you
have the `collection` in the example above, you can make a list of
`span`s for each element and "render" them:

```JavaScript
const preactModule = import('https://unpkg.com/htm/preact/standalone.module.js');
const html = preactModule.html;
const render = preactModule.render;

const dom = html`<div class="foo">${collection.map((word) => html`<span>${word}</span>`)}</div>`;
render(dom, document.querySelector("#output"));

```

Yes, Renkon being agnostic of the display mechanism means that you can
load HTM dynamically from your program and use it.

The `dom` behavior is computed whenever `collection` changes, and the
`render` function is invoked as its dependency, `dom`, is updated.

## Breaking out a Cyclic Dependency

FRP has a strong notion that an event or a behavior has at most one
value at a given time _t_. If your program has a cyclic dependency, for example:


```JavaScript
const a = b + 1;
const b = a + 1;
```

then the system cannot compute a consistent result for time _t_. This program is invalid.

However, this restriction is too strong in many practical use
cases. Let us say that you want to create the reset button in the
above example from your program dynamically, but only when there is a certain number of
elements. This means that the dynamically created button depends on
the value of `collection`, but `collection` depends on the output from
the `button`. This is circular.

There are two ways to break such typical cyclic dependencies. One
is called "send/receive." A `send` combinator can request a "future"
update on the receiver:


```JavaScript
...

const reset = Events.receiver();
const resetter = (evt) => Events.send(reset, "reset");
const timer = Events.timer(1000);
const collection = Behaviors.collect([], Events.or(reset, timer), (current, value) => {
    if (typeof value === "number") {
        return [...current, value];
    }
    if (value === "reset") {return [];}
})

const buttonHTM = ((collection) => {
   if (collection.length > 5) {
       return html`<button onClick=${resetter}>reset</button>`
   }
   return html`<div></div>`;
})(collection);

render(buttonHTM, document.querySelector("#buttonHolder"));
```

In this example, the `reset` node created by `Events.receiver()` gets a value in the "next
evaluation cycle" when the `Events.send` combinator is invoked. The
`resetter` is a vanilla JS function, so it can be attached to the HTM
virtual DOM as an event handler (`onClick`). The `buttonHTM` is either
a button virtual DOM or an empty `div`.

Another way to accommodate cyclic dependency is to use the
"$-variable" specification. Let us say that we want to use the HTML's
`AbortController`, which is used to stop a `fetch` request in the
middle. Because an LLM typically generates output words one at a time,
a `fetch` call typically uses the `Connection: "keep-alive"` mode. The
long running request can be aborted when the AbortController
signals. The following is code taken from the popular llama.cpp client
code:

```JavaScript
const response = await fetch(config.url, {
    method: 'POST',
    body: JSON.stringify(completionParams),
    headers: {
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
    },
    signal: abortController.signal,
});
```

Notice that the `headers` property has `'Connection': 'keep-alive'`
and the `signal` property uses an AbortController.

A chat interface would call this code multiple times, but a new
`AbortController` needs to be created for each call. Let us say that
upon the completion of the request, an array called `responses` that
holds onto the all responses from the LLM gets a new element at the
end. In this setting, `responses` depends on the `abortController`
because the `fetch` call that uses the `abortController` updates
it. At the same time, the `abortController` depends on `responses` as
the `abortController` node needs to get a new value upon the
completion of a request.

```JavaScript
const abortController = Behaviors.collect(
    new AbortController(),
    Events.change($responses),
    (old, _new) => {
        old.abort(); 
        return new AbortController();
    });

const responses = Behaviors.collect([], result, (chunks, resp) => {
    if (resp.done) return [...chunks, resp.value];
    return chunks;
});

```

The trigger for the `abortController` node is
`Events.change($responses)`. The dollar sign ("$") means that the trigger
depends on the value of `responses` in previous evaluation cycle. You could
imagine that in a programming language that allows a "prime" (') in a
variable name, it would be written as `response'`. The
`Events.change` combinator fires when there is a change in
`responses`, effectively when responses gets a new element.

For `responses`, the `result` trigger is the result from a generator
that includes the sentence from the generator. Its `done` property
indicates whether the generator has exited or not. if `done` is true,
it means the request is completed, so the responses array gets
updated. The `return chunks` part means that the fetch call is still
ongoing, so `chunks` simply returns the current value.

You can think that `collect` is the third way to break cyclic
dependency; the node depends on itself, but the updater uses its own
value as the "previous" value, and with the current input at time _t_,
it produces a value for time _t_.

## Live Editing

We explained the language in isolation above, but it is part of a
live-editable environment. One can have a text editor on the same page
as your application.

We discussed the dependency graph above, but how does a node determine
what other nodes it depends on? The answer is "it uses variable
names." Let's see what it means with a simple example:

```JavaScript
const a = 3;
const b = a + 4;
```

The language system examines the definition of each node. For `a`, it
determines that `a` does not depend on any other variable. It also
examines `b` (`a + 4`), and it figures out that `b` needs "something
named `a` to compute `b`'s value. The system does not need to know what actually is `a`; `b` just
remembers that it depends on a node named `a`. To evaluate `b`, the value
associated with `a` is looked up, and if the value is different from
the last time `b` was evaluated, then b is updated with the new value.

In this way, one can simply swap out the definition of `a` at
runtime. This is the basis of the Live editing of Renkon program.

One could imagine to update the definition of `a` in the live manner to this:

```JavaScript
const a = new Promise((resolve) => setTimeout(() => resolve(10), 1000));
const b = a + 4;
```

When you make this live edit, the value of `a` becomes undefined but
`b` keeps its current value. When the Promise resolves, `b` is
evaluated to become 14.

One can experiment Renkon code in the default Renkon page. Check the
following video.

https://github.com/user-attachments/assets/cbbc331e-abe5-49da-b74b-3caf50d76840

<video controls width="800">
  <source src="./docs/color.mov" type="video/mp4"/>
</video>

You open the editor in the drawer, and paste the
code. Note that the pasted test has `<script type="reactive">` that
surrounds the program part, and then a `div` element named `output`.

When you press the "Update" button, the content as is is added to the
document. So you can include DOM elments as well as code. If you open
the developer console, you can see that what you put in the editor
indeed is a part of the HTML.

You can simply edit the code in the editor, in this video add some
style to the "words". Notice that the `collection` array is kept when
you update code so that you can experiment things quickly.

## Combinators

There are numbers of combinators that can be used to combine other FRP nodes.

### Events.listener

```TypeScript
Events.listener(dom: HTMLElement|string, eventName:string,
                                 handler: (evt:any) => void, options?:any)
```

`Events.listener` creates an event node that fires when a specified DOM event occurs. The first argument can be a string; in that case, the element found with `querySelector` is used.

### Events.delay

```TypeScript
Events.delay(node, delay: number)
```
The event specified in the first argument will trigger `delay` logical milliseconds later. The first argument can be either a behavior or an event; if it is a behavior, the `change` will be delayed with this combinator.

### Events.timer

```TypeScript
Events.timer(interval: number)
```
This creates a node that fires at the specified interval in logical time. The value is a multiple of the interval.

### Events.change

```TypeScript
Events.change(value:Behavior)
```
This converts a behavior to an event. When the value chagnes in the behavior, the event fires.

### Events.or

```TypeScript
Events.or(...values:Events)
```
This event fires when one of the dependencies fires. If two or more dependencies fire at the same logical time, the implementatio chooses the left-most one. The value of the event is the value of the dependency that fired.

### Events.collect

```TypeScript
Events.collect<I, T>(init:I, event:Event, updater: (c: I, v:T) => I)
```
This event fires when the event argument fires. the previous value, starting from the init and the new value of the event is passed to the updater function and the returned value is used as the value of the event. Because this is an event, even though the value is kept internally, the value is not available at the other logical time.

### Events.observe

```TypeScript
Events.observe(callback:ObserveCallback, options?:any)
```

This creates an event that fires when the callback function is invoked. For example:

```JavaScript
const inputs = Events.observe((notifier) => {
    window.onmessage = (event) => {
        notifier(event.data);
    }
    return () => window.onmessage = null;
}, {queued: true});
```
The optional argument can specify "queued", which returns an array of potentially a multiple values for the same logical time.

### Events.resolvePart

```TypeScript
Events.resolvePart(object:any)
```
The event shallowly scan the object's properties (it may be an array or an object). If there are promises found, they are waited to resolve, and the shallow copy of the object with resolved values is used as the value of the event.

### Events.next

```TypeScript
Events.next<T>(generator:Generator<T>)
```
This event takes an async generator as its argument. The event gets a new value when the promise returned from the generator resolves.

```JavaScript
const gen = llama(aString, params, config);  // the llama function from the llamacpp 
const value = Events.next(gen);
```

### Behavior.keep

```TypeScript
Behaviors.keep(value:Event)
```
This behavior takes an event as argument, and keeps the last value fired as its state.

### Behaviors.collect
```TypeScript
Events.collect<I, T>(init:I, event:Event, updater: (c: I, v:T) => I)
```
This event fires when the event argument fires. the previous value, starting from the init and the new value of the event is passed to the updater function and the returned value is used as the value of the event.

### Behaviors.timer

```TypeScript
Behaviors.timer(interval:number)
```
This creates a node that fires at the specified interval in logical time. The value is a multiple of the interval.

### Behaviors.delay

```TypeScript
Behaviors.delay(stream, delay: number)
```
The behavior or event specified in the first argument will become the value of the behavior after `delay` logical milliseconds. The first argument can be either a behavior or an event.

### Behaviors.resolvePart

```TypeScript
Events.resolvePart(object:any)
```
The event shallowly scan the object's properties (it may be an array or an object). If there are promises found, they are waited to resolve, and the shallow copy of the object with resolved values is used as the value of the event.

## Comparison to Other Frameworks

### No `useEffect` Needed

Renkon does not need the equivalent of `useEffect` in React. React
forces you to manually provide the dependencies in the array for
`useEffect`, yet it does not have the equivalent of `Events.or`. So if
you want to have a block that uses two possible update sources, but
typically only one updates, you'd have to check which dependency was
updated manually.

### No `await`, `async`, `then`, and `Promise.all` Needed

Promises in JavaScript are powerful and useful, but the extra syntax
and understanding how execution works require some experience. Renkon
makes those integrated.

### No Signals Needed

Renkon does not need a new construct to have a reactive value. There
are proposals to add "Signals" to JavaScript, but they require you to
assign your value to the `value` property.

Signals are conceptually close to Behaviors, but not having the Events
counterpart complicates your program.

In the [tutorial of Preact's
Signals](https://preactjs.com/guide/v10/signals/), the `addToDo`
function needs to explicitly clear `text.value`. Imagine that someone
wants to add two to-do items that happen to have the same text. If you
don't clear the value, the user cannot do it. But then, how would the
creator of the program know that `addToDo` is the right place to clear
the value? Later on, the app gets a feature that requires the use of
`text.value`.

If one were to write a similar To-Do program in Renkon, the "text"
node would be an event that depends on the user click event. The
dependency graph is updated at the event's time _t_, with all places
that use `text` being updated, then the value becomes
unavailable. Next time, the user may submit the exact same content for
`text`, and the program adds the second entry as expected.

`computed()`, `effect()`, and `batch()` of Signals are also not necessary in Renkon.

### Maps and Sets Can Be Used in a Sane Way

One of the issues with building a large application in React is that
it is not easy to get it right with Maps and Sets in data. Imagine if
you have 1,000 elements in a Map and make a list of virtual DOM
elements for each, and then render it. First, an element added itself
may not trigger the update detection, so you might have to copy the
Map with 1,000 elements and then add a new entry. React's
reconciliation logic tries to be fast, but it would still need to
compare two long lists of data to add one element.

In Renkon, one could add the new entry to the Map as data and just add
a new virtual DOM element to the already existing list of virtual DOM,
or you can actually call `appendChild()` directly.

### No Excess Screen Updates

Signals are touted as a way to reduce unnecessary DOM updates, and
using HTM+Preact with Renkon has the same benefits. The
above-mentioned Preact's Signal tutorial mentions some rendering
optimizations; as shown above, Renkon allows even more direct DOM
manipulation.
