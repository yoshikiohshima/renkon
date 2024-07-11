export function test(x, y) {
  const n = new Promise((resolve) => setTimeout(() => {resolve(100)}, 1000));
 // const n = 3;
  const m = n + 10;
  return [n, m];
}
