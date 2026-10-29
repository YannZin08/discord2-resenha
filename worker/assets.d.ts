// Binary files bundled into the worker (wrangler.toml [[rules]] type = "Data").
declare module '*.png' {
  const data: ArrayBuffer;
  export default data;
}
