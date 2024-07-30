
export function matrix3d (originalPos, targetPos) {
    let H, from, i, j, p, to;
    from = (function() {
        let _i, _len, _results;
        _results = [];
        for (_i = 0, _len = originalPos.length; _i < _len; _i++) {
            p = originalPos[_i];
            _results.push({
                x: p[0] - originalPos[0][0],
                y: p[1] - originalPos[0][1]
            });
        }
        return _results;
    })();
    to = (function() {
        let _i, _len, _results;
        _results = [];
        for (_i = 0, _len = targetPos.length; _i < _len; _i++) {
            p = targetPos[_i];
            _results.push({
                x: p[0] - originalPos[0][0],
                y: p[1] - originalPos[0][1]
            });
        }
        return _results;
    })();
    H = getTransform(from, to);
    return "matrix3d(" + (((function() {
        let _i, _results;
        _results = [];
        for (i = _i = 0; _i < 4; i = ++_i) {
            _results.push((function() {
                let _j, _results1;
                _results1 = [];
                for (j = _j = 0; _j < 4; j = ++_j) {
                    _results1.push(H[j][i].toFixed(20));
                }
                return _results1;
            })());
        }
        return _results;
    })()).join(',')) + ")";
}

function getTransform(from, to) {
    let A, H, b, h, i, k_i, lhs, rhs, _i, _j, _k, _ref;
    console.assert((from.length === (_ref = to.length) && _ref === 4));
    A = [];
    for (i = _i = 0; _i < 4; i = ++_i) {
        A.push([from[i].x, from[i].y, 1, 0, 0, 0, -from[i].x * to[i].x, -from[i].y * to[i].x]);
        A.push([0, 0, 0, from[i].x, from[i].y, 1, -from[i].x * to[i].y, -from[i].y * to[i].y]);
    }
    b = [];
    for (i = _j = 0; _j < 4; i = ++_j) {
        b.push(to[i].x);
        b.push(to[i].y);
    }
    h = numeric.solve(A, b);
    H = [[h[0], h[1], 0, h[2]], [h[3], h[4], 0, h[5]], [0, 0, 1, 0], [h[6], h[7], 0, 1]];
    for (i = _k = 0; _k < 4; i = ++_k) {
        lhs = numeric.dot(H, [from[i].x, from[i].y, 0, 1]);
        k_i = lhs[3];
        rhs = numeric.dot(k_i, [to[i].x, to[i].y, 0, 1]);
        console.assert(numeric.norm2(numeric.sub(lhs, rhs)) < 1e-9, "Not equal:", lhs, rhs);
    }
    return H;
}

/* globals numeric */
