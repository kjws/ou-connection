import { Duplex, Readable, Writable } from 'stream';

import * as Q from 'q';

import Queue = require('./queue');
import BufferChunkSplitter = require('./bufferChunkSplitter');

const _out = Symbol('_out');
const _delimiter = Symbol('_delimiter');
const _isClosed = Symbol('_isClosed');

export class StreamAdapterQueue extends Queue<Buffer> {
  static delimiter = new Buffer([0, 0, 0]);

  constructor(inAndOut: Duplex);
  constructor(input: Readable, output: Writable);
  constructor(input: any, output?: any) {
    super();
    this[_delimiter] = StreamAdapterQueue.delimiter;
    let bcs = new BufferChunkSplitter(StreamAdapterQueue.delimiter);
    let _in: Readable;

    if (input instanceof Duplex && !output) {
      _in = this[_out] = input;
    } else if (
      input instanceof Readable &&
      output instanceof Writable) {
      _in = input;
      this[_out] = output;
    } else {
      throw new Error("Adaptable stream(s) required");
    }

    const onInClose = () => this.close();
    const onOutFinish = onInClose;
    const onInData = data => bcs && bcs.push(data);
    const onBcsChunk = chunk => super.put(chunk);

    _in.on('close', onInClose).on('data', onInData);
    (this[_out] as Writable).on('finish', onOutFinish);
    bcs.on('chunk', onBcsChunk);

    this.closed.then(() => {
      this[_isClosed] = true;
      _in.removeListener('close', onInClose);
      _in.removeListener('data', onInData);
      (this[_out] as Writable).removeListener('finish', onOutFinish);
      bcs.removeListener('chunk', onBcsChunk);

      _in = null;
      delete this[_out];
      bcs = null;
    });
  }

  put(value: Buffer): Q.Promise<boolean> {
    if (this[_isClosed]) { return Q(false); }
    if (!this[_out]) { return Q(false); }
    return Q<boolean>(
      (this[_out] as Writable)
        .write(Buffer.concat([value, this[_delimiter]]))
    );
  }

  close(error?: Error): Q.Promise<Error> {
    if (this[_isClosed]) { return this.closed; }
    if (this[_out]) { (this[_out] as Writable).end(); }
    return super.close(error);
  }
}
