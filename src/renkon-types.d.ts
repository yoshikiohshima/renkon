declare class EventsInterface {
  listener<T>(dom: HTMLElement|string, eventName:string, handler: (evt:any) => T, options?:any):T;
  delay<T>(variable:T, delay: number):T;
  timer(interval:number, toggle?: boolean):number;
  calm<T>(variable:T, interval:number):T;
  change<T>(variable:T):T;
  once<T>(variable:T):T;
  next<T>(generator:any):T;
  or(...variables:any[]):any;
  some(...variables:any[]):any[];
  collect<I, T>(init:I|Promise<I>, variable:T, updater: (c:I, v:T) => I):I;
  select<I>(init:I|Promise<I>, ...args:Array<any|((c:I, v:any) => I)>):I;
  send<T>(variable:T, value:T):void;
  receiver<T>():T;
  observe(callback:(notifier:(v:any) => void) => () => void):() => void;
  resolvePart(object:any):any;
}

declare class BehaviorsInterface {
  keep<T>(variable:T):T;
  collect<I, T>(init:I|Promise<I>, variable:T, updater: (c:I, v:T) => I):I;
  timer(interval:number, toggle?: boolean):number;
  delay<T>(variable:T, delay: number):T;
  resolvePart(object:any):any;
  select<I>(init:I|Promise<I>, ...pairs:Array<[any, (c:I, v:any) => I]>):I;
  or(...variables:any[]):any;
  some(...variables:any[]):any[];
  gather(regexp:string):any[];
  receiver<T>():T;
}

export declare const Events:EventsInterface;
export declare const Behaviors:BehaviorsInterface;
