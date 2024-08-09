# Renkon: A reactive UI framework.

## Introduction

Renkon is a UI framework for building an interactive web
application. The basic concept is based on Functional Reactive
Programming (FRP). A program consists of a set of reactive nodes. Each
node reacts to input change and produce an output. Other nodes that
depends on the output in turn produces their outputs, and updates on
nodes propagates though the "dependency network".

Renkon stands out from other reactive web UI frameworks in three ways:

- Native Promises and Generators of JavaScript is integrated cleanly.
- Following the original FRP, discreet events and continuous values are separated.
- The definition of reactive nodes can be edited dynamically from within the environment itself.

This results in a very simple yet powerful compared to some existing frameworks:

- No need to have "duct tapes" like `useEffect`. Asynchronous actions and state updates are nicely integrated.
- No need to manually create reactive state values and manage them by resetting them.
- Existing libraries such as interfaces to an LLM can be directly used.
- Quickly explore by modifying code in the live environment.
- The program is isomorphic to box and wire diagram. It opens up the possibility of different editing modes.

Here is a simple example code:

```JavaScript
const mod = import("./foo.js");
const hundred = new Promise((resolve) => setTimeout(() => resolve(100), 500));
const timer = Events.timer(1000);
console.log(mod.ten() + hundred + timer);
```

The first line with `import` returns a promise that resolves to a
JavaScript Module. Let us assume that it exports a function called `ten()` that
returns 10. The node `hundred` is a Promise that resolves to 100
after 500ms. `timer` is an event that produces a new value at every
1000ms. The last line with `console.log()` call depends three nodes
(`mod`, `hundred`, and `timer`), and when each of those has a value,
the `console.log` function is executed and you see an output in the
console. after `mod` and `hundred` have resolved, each time `timer`
updates `console.log()` line is reevaluated. Consequently, you'd see a
new console.log output added to a sequence like `1110`, `2110`,
`3110`... .

## FRP in nutshell

Functional Reactive Programming is a clean way to describe an
application as an acyclic graph of data dependency. Lately all popular
UI frameworks have reactivity.

However, the original FRP had two concepts that recent reactive
frameworks missed to incorporate. One is the clear definition of
logical time and functions on the time domain. The other is clear
separation between "events" that only exist on certain instants on the
time domain and "behaviors" that exist continuously on the time
domain. As you use Renkon, and read this document, you see the
benefits of those concepts.

When you construct an application in FRP, you think the application
state is a set of "nodes", and each node's value is a function of time
<i>t</i>. A node is a function that uses values from other nodes and
compute its value. IOW, a node depends on other nodes, and the
dependency relationship forms a graph. When a "leaf" node changes its
value as due to an event occurring at time t, the changes are
propagated through the dependency graph. The result is that the
application state is computed consistently for logical time t. This
time is called logical time because evaluation of those nodes is done
at the "same time", or the logical time does not advance while
evaluating the dependency graph. This notion is sometimes called
"synchronous", in the sense that all computation takes exactly 0 time.

As described above, an event is a function that has a value only at certain instant on the timeline. What is the value of an event when there is no value in Renkon? Renkon is based on JavaScript, and JavaScript conveniently has `undefined` and `null`. They may be treated interchangeably in a regular JavaScript program, but Renkon uses `undefined` to indicate that the value does not exist at the time, while `null` is used to indicates that the value does exist but it is empty. IOW, a node won't be evaluated wwhen one of the dependencies is `undefined`.

Let us describe some more building parts of Renkon. Those are called
"combinators" that combines other FRP nodes to do more things.

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
new value when one of the arguments, in this case, `button` or `timer`
gets a value. `Behaviors.collect` is a combinator that starts from the
initial value, in this case `[]`. When the second argument, in this
case `Events.or(button, timer)` gets a value, which serves as a
trigger to update the value of the combinator, the updater function as
the third argument is evaluated. It is called with the current value
and new value, and the value returned from it becomes the new
value. (In other languages the combinator may be called `followed by`
or `fby`; is it is an initial value followed by updates.)

The `button` node is created by the `Events.listener` call. It adds a
DOM event listener (in this case `click`) to the button named
`myButton`.

Because `Event.or` combinator "forwards" the value from one of the
arguments , the `value` argument for the updater is either a DOM click
event coming from the button click, or a number coming from
`timer`. The body checks the type of `value`, and if it is a number it
appends the value to the collection. If not it resets `collection` to
an empty array. In effect, collection gets a new element at each
second but reset when the user presses the button.

Some combinators have both the "Event" variant and "Behavior" variant,
whether the value should be available only at the instant, or kept
until it changes again. In the example above, `collect` and `timer`
have both variants, but `Events.or` does not have a Behavior
counterpart. (At the moment; it could be a kind of select operation
that keeps the last value from whichever arguments). In general,
anything that is used as a kind of "trigger" should be an event, whose
value is cleared after the event's time t. In the above example,
`Behaviors.collect` can be changed to `Events.collect` and the program
would produce the same sequence of output in the developer console; as
the collection value is computed and the console.log line that depends
on collection is executed at time t. But if you want to use the array
in other parts of the program at later time, it should be a behavior
that keeps the value.

A constant value is treated as a behavior, meaniing that it is a
function that always returns the same value:

```JavaScript
const a = 3;
const b = a + 4;
```

In the program above, `a` is a behavior that is always 3, and `b` is
also a behavior that is always 7.

A Promise is treated as a Behavior. It means that the value of the
node is `undefined` until the Promise resolves, and then becomes the
resolved value and it stays.

A Generator, on the other hand, typically generate values repeatedly
over time. A typical use case is to treat the result as an
event. Imagine that there is a JS library that returns a word from an
LLM at a time.  Let us say that there is a library called `llama` that
returns an async generator. We have a combinator called `Events.next`
that gets a new value when the generator produces it.

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
the last value of the event is the current value of the behavior.

```JavaScript
const anEvent = Events.timer(1000);
const b = Behaviors.keep(anEvent);
```

To create an event from a behavior, which assumes some implementation
details and changes on the behavior's value is discretized, and event
fires when the value of the behavior changes.

```JavaScript
const aBehavior = Behaviors.timer(1000);
const e = Events.change(aBehavior);
```

## Creating DOM elements as values.

Renkon is agnostic from the way display and DOM manipulation
mechanism. For example, one can write this in a page that has a `div`
called "output", and its text content updates at every second.

```JavaScript
const timer = Events.timer(1000);
document.querySelector("#output").textContent = `${timer}`;
```

But this way of assigning a value is hard to manage.

One can use the HTM library (Hyperscript Tagged Markup) from the
Preact community. HTM is like JSX that is used by React and other
frameworks, but it instead uses the JavaScript's built-in "tagged
templates" feature to construct virtual DOM elements. It can "render"
virtual DOM elements as actual DOM elements. HTM is a great match
with a reactive framework as the virtual DOM elements themselves can
be used as the value in the framework. IOW, instead of writing code
that "does" something on a DOM element to make it so, you write code
to produce a value that say the DOM should "be" like this. If you have
the `collection` in the example above, you can make a list of `span`s
for each element and "render" them:

```JavaScript
const preactModule = import('https://unpkg.com/htm/preact/standalone.module.js');
const html = preactModule.html;
const render = preactModule.render;

const dom = html`<div class="foo">${collection.map((word) => html`<span>${word}</span>`)}</div>`;
render(dom, document.querySelector("#output"));

```

Yes, Renkon is agnostic of the display mechanism means that you can
load HTM from your program dynamically and use it.

The `dom` behavior is computed whenever `collection` changes, and the
`render` function is invoked as its dependency, `dom` is updated.

## Breaking out a cyclic dependecy

FRP has a strong notion that an event or a behavior has at most one
value at a given time t. If your program has a cyclic dependency such
as:

```JavaScript
const a = b + 1;
const b = a + 1;
```

Then the system cannot compute a consistent result for time t. Your program is invalid.

However, this restriction is too strong for practical cases. Let us
say that you want to create the reset button in the above example
dynamically only when there is certain number of elements. This means
that the dynamically created button depends on the value of
`collection` but `collection` depends on the output from the
`button`. This is circular.

So there are two ways to break such typical cyclic dependencies. One
is called "send/receive". A `send` combinator can request a "future"
update on the receiver.

```JavaScript
const preactModule = import('https://unpkg.com/htm/preact/standalone.module.js');
const html = preactModule.html;
const render = preactModule.render;

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

In this example, `reset` combinator gets a value in the "next evaluation time" when the `Events.send` combinator was invoked. the `resetter` is a vanilla JS function so that it can be attached to the HTM virtual DOM as an event handler (`onClick`). The `buttonHTM` is either a button virtual DOM or empty `div`.

Another way to accommodate cyclic dependency is to use the "$-variable" specification. Let us say that we want to keep the HTML feature of `AbortController` (that can be used to stop a `fetch` request). While an LLM typically takes time to generate words, so a fetch call typically has `Connection: "keep-live"` mode, but that request can be aborted when the AbortController signals. The below is code taken from the popular llama.cpp client code:

```JavaScript
const response = await fetch(config.url || "/completion", {
    method: 'POST',
    body: JSON.stringify(completionParams),
    headers: {
        'Connection': 'keep-alive',
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream',
        ...(params.api_key ? {'Authorization': `Bearer ${params.api_key}`} : {})
    },
    signal: abortController.signal,
});
```

Notice that the `headers` property has `'Connection': 'keep-alive'` and the `signal` property uses an AbortController.

Because a program would call this fetchh call multiple times, though the AbortController can be used only once for a fetch call, an AbortController instance needs to be created when a request completes. Let us say that upon the completion of the request, an array called `responses` gets a new element at the end. In this setting, `responses` depends on the abortController but abortController depends on `responses` as the abortController node needs to get a new value upon the completion of a request.

```JavaScript
const abortController = Behaviors.collect(
    new AbortController(),
    Events.change($responses),
    (a, b) => {
        a.abort(); 
        return new AbortController();
    });

const responses = Behaviors.collect([], result, (chunks, resp) => {
    if (resp.done) return [...chunks, resp.value];
    return chunks;
});

```

The trigger for `abortController` combinator is
`Events.change($responses)`. The dollar sign means that the trigger
depends on the previous cycle of `responses` value. (You could imagine
that a program language that allows a "prime" (') in a variable name,
it'd be written as `response'`.)  `Events.change` combinator fires
when there is a change in `responses`.

For `responses`, the `result` trigger is a result from a generator
that has the sentence from the generator and `done` property that
indicates that the generator exited. That means the request is
completed so the responses array gets updated. The `return chunks`
part means that the fetch call is on going and a words are generated
over time, so chunks it simply returns the current value.

In a way, `collect` is another way to break cyclic dependency; the
node depends on itself, but updater uses the value of itself as the
"previous" value, and with the current input at time t, it produces a
value for time t.

## Live Editing

We explained the language in isolation in above, but it is a part of a
live-editable environment. One can have a text editor in the same page
of your application.

We discussed the dependency graph in the above, but how does a node determines what other nodes it depends on? The answer is the "variable names". When `b` depends on `a` in the following program:

```JavaScript
const a = 3;
const b = a + 4;
```

The definition of `b` (`a + 4`) is examined, and it figures out that
it needs "something named `a`. It does not know what `a` is or is
going to be; `b` just remembers that it depends on the name `a`. To
evaluate `b`, the value associated with `a` is looked up, and if the
value is different from the last time `b` was evaluated, then b is
updated with the new value.

In this way, one can simply swap out the definition of `a` at
runtime. This is the basis of the Live editing of Renkon program.

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

