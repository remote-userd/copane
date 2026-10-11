/** Files imported `with { type: "file" }`: a path, embedded in the compiled binary. */
declare module "*.ttf" {
  const path: string
  export default path
}
