export function equal(a, b) {
    if (typeof a !== typeof b) {
        return false;
    }
    if (typeof a === "object") {
        if (a === null || b === null) {
            return a === b;
        }
        if (a.constructor !== b.constructor) {
            return false;
        }
        if (a.constructor === Array) {
            if (a.length !== b.length) {
                return false;
            }
            for (let i = 0; i < a.length; i++) {
                if (!equal(a[i], b[i])) {
                    return false;
                }
            }
            return true;
        }

        if (a.constructor === Map) {
            if (a.size !== b.size) {
                return false;
            }

            for (let k of a.keys()) {
                if (!equal(a.get(k) ,b.get(k))) {
                    return false;
                }
            }
            return true;
        }

        let aKey = Object.keys(a);
        let bKey = Object.keys(b);
        if (aKey.length !== bKey.length) {return false;}
        for (let k in a) {
            if (!equal(a[k] ,b[k])) {
                return false;
            }
        }
    }
    return a === b;
}

export function assert(a, b) {
  if (!equal(a, b)) {
    console.log("!==", a, b);
  }
}

export function assertState(state, aName, value) {
  const a = state.resolved.get(aName)?.value;
  return assert(a, value);
}
