import * as Q from 'q';

const _endResolve = Symbol('_endResolve');
const _endPromise = Symbol('_endPromise');
const _closedDefer = Symbol('_closedDefer');
const _isClosed = Symbol('_isClosed');

interface promiseLinkedListNode<T> {
  value: T,
  next: Q.Promise<promiseLinkedListNode<T>>
}

export = Queue;
class Queue<T> {
  get closed(): Q.Promise<Error> {
    return (this[_closedDefer] as Q.Deferred<Error>).promise;
  }

  constructor() {
    const endDefer = Q.defer<promiseLinkedListNode<T>>();
    this[_endResolve] = endDefer.resolve;
    this[_endPromise] = endDefer.promise;
    this[_closedDefer] = Q.defer<Error>();
    (this[_closedDefer] as Q.Deferred<Error>)
      .promise.then(() => this[_isClosed] = true);
  }

  put(value: T) {
    if (this[_isClosed]) { return; }
    const nextDefer = Q.defer<promiseLinkedListNode<T>>();
    (this[_endResolve] as (v: promiseLinkedListNode<T>) => void)
      ({ value, next: nextDefer.promise });
    this[_endResolve] = nextDefer.resolve;
  }

  get(): Q.Promise<T> {
    const valuePromise: Q.Promise<T> = this[_endPromise].get('value');
    const failHook = error => {
      this[_closedDefer].resolve(error);
      throw error;
    };

    this[_endPromise] = this[_endPromise].get('next');

    return valuePromise.fail<T>(failHook as (any) => T);
  }

  close(error?: Error): Q.Promise<Error> {
    if (this[_isClosed]) { return this.closed; }
    error = error || new Error("Can't get value from closed queue");
    const end: any = { value: Q.reject(error) };
    end.next = end;
    this[_endResolve](end);
    return this.closed;
  }

  from(queue: Queue<T>): this {
    if (queue === this) { throw new Error("Can't do from self"); }
    const get = (value: T) => {
      queue && queue.get().then(get);
      this.put(value);
    };
    queue.get().then(get);
    queue.closed.then(() => queue = null);
    return this;
  }

  to(queue: Queue<T>): this {
    if (queue === this) { throw new Error("Can't do to self"); }
    const get = (value: T) => {
      queue && this.get().then(get);
      queue && queue.put(value);
    };
    this.get().then(get);
    this.closed.then(() => queue = null);
    return this;
  }
}
