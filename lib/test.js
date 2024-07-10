export function test(x, y) {
  const a = new Promise((resolve) => setTimeout(() => resolve(100), 1000));
  const b = a + 10;
  return [a, b]
}
  
