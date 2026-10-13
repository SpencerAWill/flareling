// `wrangler types` only infers the main module's exports when `main` is a
// local file. Here it is a package specifier, so `exports` from
// "cloudflare:workers" would be typed `{}` without this declaration.
// test/worker.ts re-exports the same entry, so the type is the real one.
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./worker.ts");
  }
}
