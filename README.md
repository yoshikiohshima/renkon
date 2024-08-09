# Renkon: A reactive UI framework.

## Introduction

Renkon is a UI framework that lets you build an interactive web applications. The basic concept is based on Functional Reactive Programming (FRP). A program consists of a set of reactive nodes. Each node reacts to input change and produce an output. Other nodes that depends on the output in turn produces their outputs, and updates on nodes propagates though the "dependency network".

Renkon stands out from other reactive web UI frameworks in three ways:

- Native Promises and Generators of JavaScript is integrated cleanly.
- The definition of reactive nodes can be edited dynamically from within the environment itself.
- Following the original FRP, discreet events and continuous values are separated.

An example code looks like:

```JavaScript
const mod = import("./foo.js");
const hundred = new Promise((resolve) => setTimeout(() => resolve(100), 500));
const timer = Events.timer(1000);
console.log(mod.ten() + hundred + timer);
```

`import` returns a promise that resolves to a Module. Let us assume that it exports a function called `ten()` that returns 10. The hundred variable gets a Promise that resolves to 100 after 500ms. `timer` is an "event" that produces a new value at every 1000ms. The last line with `console.log()` call uses three nodes (`mod`, `hundred`, and `timer`), and when each of those has a value, the console.log function is executed and you see an output in the console. after `mod` and `hundred` have resolved, each time `timer` updates `console.log()` line is reevaluated. Consequently, you'd see a new console.log output added to a sequence like `1110`, `2110`, `3110`... .

## FRP in nutshell

Functional Reactive Programming is a clean way to describe an application as an acyclic graph of data dependency. Lately all popular UI frameworks have reactivity. (Though one historical tidbit to point out that Dr. Alan Kay's thesis in 1969 was titled "The Reactive Engine" and the language described in the paper was reactive).

Two important concepts that the original FRP have but recent reactive frameworks often miss are the clear notion of time as the domain of functions that yield values based on the time, and clear separation between a discreet event that is defined on the time domain only at certain instants vs. a continuous time varying variable. You can think that an application state is a function of time <i>t</i>; when an event at Time t occurs, the values in the dependency graph are recomputed and eventually the entire set of nodes gets the values at the logical time. Some values in the graph can be used in subsequent computation but some values are cleared as the logical time advances from <i>t</i>. The benefits of this may not be apparent at the beginning but you will appreciate this as you go.

Let us describe some more building parts of Renkon. Those are called "combinators" that combines other FRP nodes to do more things.

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

In the example above, `Events.or()` is a combinator that produces a new value when one of the arguments in this case, timer or button gets a value. `Behaviors.collect` is a combinator that starts from the initial value, in this case `[]`. When the second argument, in this case `Events.or(button, timer)` gets a value, it servces as a trigger to update the value of the combinator. The updater function, the third argument, is called with the current value and new value, and the value returned from it becomes the new value.

The `button` node is created by `Events.listener` call. It adds a DOM event listener (in this case `click`) to the button named `myButton`.

Because the "trigger" for `collection` is an `Event.or` combinator, the `value` argument for the updater is either a DOM click event coming from the button click, or a number coming from `timer`. The code checks the type of `value`, and if it is a number it appends the value to the collection. If not it resets `collection` to an empty array. In effect, collection gets a new element at each second but reset when the user presses the button.

Some combinators have the "Events" variant as well as "Behaviors" variant, whether the value should be available only at the instant . In the example above, `collect` and `timer` have both variants, but `Events.or` does not have a Behavior counterpart. In general, anything that is used as a kind of "trigger" should be an event, whose value is cleared after the event's time t. In the above example, `Behaviors.collect` can be changed to `Events.collect` and the program would produce the same sequence of output in the developer console; as the collection value is computed and the console.log line that depends on collection is executed at time t. But if you want to use the array in other parts of the program at later time, it should be a behavior that keeps the value.

a constant value is treated as a behavior, meaniing that it is a function that always returns the same value:

```JavaScript
const a = 3;
const b = a + 4;
```

In the program above, `a` is a behavior that is always 3, and `b` is also a behavior that is always 7.

A Promise is treated as a Behavior. It means that the value of the node is `undefined` until the Promise resolves, and then becomes the resolved value and it stays.

A Generator, on the other hand, typically generate values repeatedly over time. A typical use case is to treat the result as an event. Imagine that there is a JS library that returns a word from an LLM at a time.  Let us say that there is a library called `llama` that returns an async generator. We have a combinator called `Events.next` that gets a new value when the generator produces it.

```JavaScript
...    
const gen = llama.llama(enter, {...config.params}, config);
const v = Events.next(gen);

const log = Behaviors.collect([], v, (a, b) => {
    if (b.done) return [...a, b.value];
    return a;
});

```

There are "natural conversions" between Events and Behaviors. You can convert an event to a behavior by making it a "step function" where the last value of the event is the current value of the behavior.

```JavaScript
const anEvent = Events.timer(1000);
const b = Behaviors.keep(anEvent);
```

To create an event from a behavior, which assumes some implementation details and changes on the behavior's value is discretized, and event fires when the value of the behavior changes.

```JavaScript
const aBehavior = Behaviors.timer(1000);
const e = Events.change(aBehavior);
```

## Creating DOM elements as values.

Renkon is totally agnostic from the way the programmer wishes to manipulate the DOM elements. For example, one can write this in a page that has a `div` called "output", and its text content updates at every second.

```JavaScript
const timer = Events.timer(1000);
document.querySelector("#output").textContent = `${timer}`;
```

But this way of assigning a value is hard to manage.

One can use the HTM library (Hyperscript Tagged Markup) from the Preact community. HTM is like JSX that is used by React, but instead uses the JavaScript's built in feature of "tagged templates" to construct a kind of virtual DOM elements and then "render" them as actual DOM. This is a great match with a reactive framework as the virtual DOM elements themselves can be used as the value in the framework. IOW, instead of writing code that "does" something on a DOM element to make it so, you write code to produce a value that say the DOM should "be" like this. If you have the `collection` in the example above, you can make a list of `span`s for each element and "render" them:

```JavaScript
const preactModule = import('https://unpkg.com/htm/preact/standalone.module.js');
const html = preactModule.html;
const render = preactModule.render;

const dom = html`<div class="foo">${collection.map((word) => html`<span>${word}</span>`)}</div>`;
render(dom, document.querySelector("#output"));

```

The `dom` behavior is computed whenever `collection` changes, and the `render` function is invoked as its dependency, `dom` is updated.

## Breaking out a cyclic dependecy

FRP has a strong notion that an event or a behavior has at most one value at a given time t. If your program has a cyclic dependency such as:

```JavaScript
const a = b + 1;
const b = a + 1;
```

This means that there is no value for any time t therefore this is an invalid program.

However, this simple restriction is too strong for many practical cases. Let us say that you want to create the reset button in the above example dynamically only when there is certain number of elements. This means that the dynamically created button depends on the `collection` but have the button the ability to reset `collection` means that the value of `collection` depends on the dynamically created button.

Also, in some cases, you have a value that is used to generate a collection of values but reinitialize the value upon the conclusion of the sequence of value generation so that it is ready for the next set.

So there are two ways to break such typical cyclic dependencies. One is called "send/receive". A `send` combinator can request a "future" update on the receiver.

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
   return undefined;
})(collection);

render(buttonHTM, document.querySelector("#buttonHolder"));
```

In this example, `reset` updates in the "next evaluation cycle" when the `Events.send` combinator was invoked. the `resetter` is a vanilla JS function so that it can be passed to the HTM virtual DOM as an event handler. The `buttonHTM` is either a button virtual DOM or `undefined` and `render` gets invoked only when the value is not `undefined`.