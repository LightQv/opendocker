const env = {
  OPENDOCKER_VERSION: process.env["OPENDOCKER_VERSION"],
}


const VERSION = await (async () => {
  if (env.OPENDOCKER_VERSION) return env.OPENDOCKER_VERSION.replace(/^v/, "")

  const pkg = await Bun.file(new URL("../../cli/package.json", import.meta.url)).json()
  return pkg.version ?? "0.0.0"
})()


export const Script = {
  get version() {
    return VERSION
  },
}


console.log(`opendocker script`, JSON.stringify(Script, null, 2))
