// Production entry point (`npm start`). Sets NODE_ENV here rather than with a
// `NODE_ENV=production …` shell prefix, which doesn't work in Windows shells.
process.env.NODE_ENV ??= "production";
await import("./index.ts");

export {};
