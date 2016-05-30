import { EventEmitter } from 'events';

const _startsWith = Symbol('_startsWith');
const _endsWith = Symbol('_endsWith');

type BufferStartsWith = (buf: Buffer) => boolean;
type BufferEndsWith = BufferStartsWith;

Buffer.prototype[_startsWith] = BufferProto_startsWith;
function BufferProto_startsWith(buf: Buffer): boolean {
  let result = true;
  for (let i of buf.keys()) {
    if (buf[i] !== this[i]) {
      result = false;
      break;
    }
  }
  return result;
}

Buffer.prototype[_endsWith] = BufferProto_endsWith;
function BufferProto_endsWith(buf: Buffer): boolean {
  let result = true;
  for (let i of buf.keys()) {
    if (buf[i] !== this[this.length - buf.length + i]) {
      result = false;
      break;
    }
  }
  return result;
}

const _delimiter = Symbol('_delimiter');
const _recvBuf = Symbol('_recvBuf');
const _checkpoint = Symbol('_checkpoint');
const _procRecvImmediate = Symbol('_procRecvImmediate');

export = BufferChunkSplitter;
class BufferChunkSplitter extends EventEmitter {

  constructor(delimiter: Buffer) {
    super();
    this[_delimiter] = delimiter;
    this[_recvBuf] = new Buffer(0);
    this[_checkpoint] = 0;
  }

  push(buf: Buffer) {
    this[_recvBuf] = Buffer.concat([this[_recvBuf], buf]);

    if (!this[_procRecvImmediate]) {
      this[_procRecvImmediate] = setImmediate(() => this._procRecv());
    }
  }

  private _procRecv() {
    clearImmediate(this[_procRecvImmediate]);
    this[_procRecvImmediate] = null;

    const checkpoint: number = this[_checkpoint];
    this[_checkpoint] = this[_recvBuf].length;

    for (let i = checkpoint; i < this[_recvBuf].length; i++) {
      const testee: Buffer =
        this[_recvBuf].slice(0, this[_delimiter].length + i);
      if ((testee[_endsWith] as BufferStartsWith)(this[_delimiter])) {
        const chunk =
          testee.slice(0, testee.length - this[_delimiter].length);

        this.emit('chunk', chunk);

        this[_recvBuf] = this[_recvBuf].slice(testee.length);
        this[_checkpoint] = 0;
        break;
      }
    }

    if (this[_checkpoint] === 0 && this[_recvBuf].length) {
      this[_procRecvImmediate] = setImmediate(() => this._procRecv());
    }
  }
}
