// What world expects of its peer: ctx.use('hello') returns this type.
export {};

declare module '@agentage/cli/extension' {
  interface ExtensionApis {
    hello: { greet: () => string };
  }
}
