/*
  We follow some good ideas in the Observable Framework.

  A block of code can have top-level variables that are by default reactive.

  The declaration of a top level variable becomes known to it.

  a top-level variable can contain a promise or generator or a regular value.

  We figure out the dependency graph of the top level variables. We keep the idea of blocks and simply re-evaluate the block accordingly.

  we also have the code edited and reloaded. The basic idea was to keep the values of behaviors but not events' .Can we do it?

  Do we use the trick of using undefined as undefined, or rather, 

  Let us make sure that basic combinators can be implemented.

  The line between behaviors and events are murky. A normal value in program text is a behavior. A loading event or promise firing is an event. a cached value would be an event converted to a behavior. animation frame is an event.

  implicit conversion between Bs and Es are ok. Unless it is explicitly prevented perhaps with a different combinator, a computed value would become a behavior upon storing into the state.

  const y = new Promise((resolve) => setTimeout(() => resolve(42), 1000));
  // y would be considered event
  
  const x = y + 3;
  // x is undefined until 1000 ms passes. 3 is a behavior and the computed value is an event but the resulting x a behavior.

  oneE: a normal value that is used on reload.
  zeroE: if we use the undefined trick it is that.
  mapE: a simple expression.
  mergeE: it'd have to be combinator.

  switchE: we will do things without this.
  condE: a combinator (but probably not actually needed)

  filterE: would need the undefined trick
  ifE: would be easy to use ?:

  collectE: this is interesting as it won't have the access to the previous value. perhaps we can have a $-prefixed variable to indicate the previous value.

  andE, orE, notE: simple expressions
  
  delayE: will be a combinator, in a way, basically a syntax sugar of setTimeout

  blineE: a combinator
  calmE: a combinator

  timeE: a syntax sugar of setInterval but returns a promise that would be replaced with a fresh one upon computing values.

  
  We can have a class called Stream. it represents a time varying value.

  Observable Framework uses Acorn parser. I think we can do that too.

  Another good feature is the integration with DOM input elements.
  
  */
  
