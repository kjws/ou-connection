import { Duplex } from 'stream';

import * as Q from 'q';
import { v4 } from 'node-uuid';

import { StreamAdapterQueue } from './adapter';

const makeId = () => v4();

const rootId = '';

const has = Object.prototype.hasOwnProperty;

export = Connection;
function Connection(conn: Duplex, local: any) {
  const root = Q.defer<any>();
  root.resolve(local);

  const locals = new Map();

  let connection: StreamAdapterQueue;
  if (conn instanceof Duplex) {
    connection = new StreamAdapterQueue(conn);
  } else {
    throw new Error("Adaptable connection required");
  }

  connection.get().then(get);
  function get(message: Buffer) {
    connection.get().then(get);
    receive(message.toString());
  }

  connection.closed.then(error => {
    locals.forEach(localDefer => localDefer.reject(error));
  });

  function receive(message: string) {
    const msgObj = JSON.parse(message);
    if (receivers[msgObj.type] && hasLocal(msgObj.to)) {
      receivers[msgObj.type](msgObj);
    }
  }

  const receivers = {
    resolve: message => {
      dispatchLocal(message.to, 'resolve', decode(message.resolution));
    },
    notify: message => {
      dispatchLocal(message.to, 'notify', decode(message.resolution));
    },
    // a "send" message forwards messages from a remote
    // promise to a local promise.
    send: message => {
      // forward the message to the local promise,
      // which will return a response promise
      let local = getLocal(message.to).promise;
      let response = local.dispatch(message.op, decode(message.args));
      let envelope: string;

      // connect the local response promise with the
      // remote response promise:

      // if the value is ever resolved, send the
      // fulfilled value across the wire
      response.then(function(resolution) {
        try {
          resolution = encode(resolution);
        } catch (exception) {
          try {
            resolution = { "!": encode(exception) };
          } catch (_exception) {
            resolution = { "!": null };
          }
        }
        envelope = JSON.stringify({
          "type": "resolve",
          "to": message.from,
          "resolution": resolution
        });
        connection.put(new Buffer(envelope));
      }, function(reason) {
        try {
          reason = encode(reason);
        } catch (exception) {
          try {
            reason = encode(exception);
          } catch (_exception) {
            reason = null;
          }
        }
        envelope = JSON.stringify({
          "type": "resolve",
          "to": message.from,
          "resolution": { "!": reason }
        });
        connection.put(new Buffer(envelope));
      }, function(progress) {
        try {
          progress = encode(progress);
          envelope = JSON.stringify({
            "type": "notify",
            "to": message.from,
            "resolution": progress
          });
        } catch (exception) {
          try {
            progress = { "!": encode(exception) };
          } catch (_exception) {
            progress = { "!": null };
          }
          envelope = JSON.stringify({
            "type": "resolve",
            "to": message.from,
            "resolution": progress
          });
        }
        connection.put(new Buffer(envelope));
      })
        .done();

    }
  };

  function hasLocal(id) {
    return id === rootId ? true : locals.has(id);
  }

  function getLocal(id) {
    return id === rootId ? root : locals.get(id);
  }

  // construct a local promise, such that it can
  // be resolved later by a remote message
  function makeLocal(id) {
    if (hasLocal(id)) {
      return getLocal(id).promise;
    } else {
      let deferred = Q.defer();
      locals.set(id, deferred);
      return deferred.promise;
    }
  }

  // a utility for resolving the local promise
  // for a given identifier.
  function dispatchLocal(id, op, value) {
    //        _debug(op + ':', "L" + JSON.stringify(id), JSON.stringify(value), typeof value);
    getLocal(id)[op](value);
  }

  // makes a promise that will send all of its events to a
  // remote object.
  function makeRemote(id) {
    return Q['makePromise']({
      when: function() {
        return this;
      }
    }, function(op, args) {
      let localId = makeId();
      let response = makeLocal(localId);
      let message = JSON.stringify({
        "type": "send",
        "to": id,
        "from": localId,
        "op": op,
        "args": encode(args)
      });
      connection.put(new Buffer(message));
      return response;
    });
  }

  // serializes an object tree, encoding promises such
  // that JSON.stringify on the result will produce
  // "QSON": serialized promise objects.
  function encode(object, memo?, path?) {
    memo = memo || new Map();
    path = path || "";
    if (object === undefined) {
      return { "%": "undefined" };
    } else if (Object(object) !== object) {
      if (typeof object == "number") {
        if (object === Number.POSITIVE_INFINITY) {
          return { "%": "+Infinity" };
        } else if (object === Number.NEGATIVE_INFINITY) {
          return { "%": "-Infinity" };
        } else if (isNaN(object)) {
          return { "%": "NaN" };
        }
      }
      return object;
    } else if (object instanceof RegExp) {
      return { "%": { "type": "RegExp", "value": object.toString() } };
    } else if (object instanceof Date) {
      return { "%": { "type": "Date", "value": object.toISOString() } };
    } else {
      let id;
      if (memo.has(object)) {
        return { "$": memo.get(object) };
      } else {
        memo.set(object, path);
      }

      if (Q.isPromise(object) || typeof object === "function") {
        id = makeId();
        makeLocal(id);
        dispatchLocal(id, "resolve", object);
        return { "@": id, "type": typeof object };
      } else if (Array.isArray(object)) {
        return object.map(function(value, index) {
          return encode(value, memo, path + "/" + index);
        });
      } else if (
        (
          object.constructor === Object &&
          Object.getPrototypeOf(object) === Object.prototype
        ) ||
        object instanceof Error
      ) {
        let result: any = {};
        if (object instanceof Error) {
          result.message = object.message;
          result.stack = object.stack;
        }
        for (let key in object) {
          if (has.call(object, key)) {
            let newKey = key.replace(/[@!%\$\/\\]/, function($0) {
              return "\\" + $0;
            });
            result[newKey] = encode(object[key], memo, path + "/" + newKey);
          }
        }
        return result;
      } else {
        id = makeId();
        makeLocal(id);
        dispatchLocal(id, "resolve", object);
        return { "@": id, "type": typeof object };
      }
    }
  }

  // decodes QSON
  function decode(object, memo?, path?) {
    memo = memo || new Map();
    path = path || "";
    if (Object(object) !== object) {
      return object;
    } else if (object["$"] !== void 0) {
      return memo.get(object["$"]);
    } else if (object["%"]) {
      if (object["%"] === "undefined") {
        return undefined;
      } else if (object["%"] === "+Infinity") {
        return Number.POSITIVE_INFINITY;
      } else if (object["%"] === "-Infinity") {
        return Number.NEGATIVE_INFINITY;
      } else if (object["%"] === "NaN") {
        return Number.NaN;
      } else if (typeof object["%"] === "object" && object["%"].type) {
        if (object["%"].type === "RegExp" && object["%"].value) {
          let match = object["%"].value.match(new RegExp('^/(.*?)/([gimy]*)$'));
          return new RegExp(match[1], match[2]);
        } else if (object["%"].type === "Date" && object["%"].value) {
          return new Date(object["%"].value);
        } else {
          return Q.reject(new TypeError("Unrecognized type: " + object["%"].type));
        }
      } else {
        return Q.reject(new TypeError("Unrecognized type: " + object["%"]));
      }
    } else if (object["!"]) {
      return Q.reject(object["!"]);
    } else if (object["@"]) {
      let remote = makeRemote(object["@"]);
      if (object.type === "function") {
        return function() {
          return Q['fapply'](remote, Array.prototype.slice.call(arguments));
        };
      } else {
        return remote;
      }
    } else {
      let newObject = Array.isArray(object) ? [] : {};
      memo.set(path, newObject);
      for (let key in object) {
        if (has.call(object, key)) {
          let newKey = key.replace(/\\([\\!@%\$\/])/, function($0, $1) {
            return $1;
          });
          newObject[newKey] = decode(object[key], memo, path + "/" + key);
        }
      }
      return newObject;
    }
  }

  // a peer-to-peer promise connection is symmetric: both
  // the local and remote side have a "root" promise
  // object. On each side, the respective remote object is
  // returned, and the object passed as an argument to
  // Connection is used as the local object.  The identifier of
  // the root object is an empty-string by convention.
  // All other identifiers are numbers.
  return makeRemote(rootId);

}
