#!/usr/bin/env bun

import { $ } from "bun"

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

function normalizeVersion(value: string): string {
  const trimmed = value.trim()
  const match = SEMVER_RE.exec(trimmed)
  if (!match) {
    throw new Error(`Invalid version: ${value}`)
  }
  return `${match[1]}.${match[2]}.${match[3]}`
}

function bumpVersion(value: string, bump: string): string {
  const [major = 0, minor = 0, patch = 0] = normalizeVersion(value).split(".").map(Number)

  if (bump === "major") return `${major + 1}.0.0`
  if (bump === "minor") return `${major}.${minor + 1}.0`
  if (bump === "patch") return `${major}.${minor}.${patch + 1}`

  throw new Error(`Invalid bump: ${bump}`)
}

async function latestTag(): Promise<string | undefined> {
  const tags = await $`git tag --list "v[0-9]*" --sort=-v:refname`.text().catch(() => "")
  return tags.split("\n").find(Boolean)
}

async function packageVersion(): Promise<string> {
  const pkg = await Bun.file(new URL("../packages/cli/package.json", import.meta.url)).json()
  return normalizeVersion(pkg.version ?? "0.0.0")
}

async function releaseNotes(fromTag: string | undefined): Promise<string> {
  const range = fromTag ? `${fromTag}..HEAD` : "HEAD"
  const log = await $`git log ${range} --pretty=format:%s -- packages/cli packages/script script .github README.md install.sh`.text().catch(() => "")
  const lines = log
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(release:|chore:|ci:|test:|ignore:)/i.test(line))
    .map((line) => `- ${line}`)

  return lines.length > 0 ? lines.join("\n") : "No notable changes"
}

const tag = await latestTag()
const explicitVersion = process.env.OPENDOCKER_VERSION?.trim()
const bump = process.env.OPENDOCKER_BUMP?.trim().toLowerCase()
const baseVersion = tag ? normalizeVersion(tag) : await packageVersion()
const version = explicitVersion
  ? normalizeVersion(explicitVersion)
  : tag || bump
    ? bumpVersion(baseVersion, bump || "patch")
    : baseVersion
const releaseTag = `v${version}`
const notes = await releaseNotes(tag)
const notesFile = `${process.env.RUNNER_TEMP ?? "/tmp"}/opendocker-release-notes.txt`
const output = [
  `version=${version}`,
  `tag=${releaseTag}`,
  `notes_file=${notesFile}`,
]

await Bun.write(notesFile, notes)

if (process.env.GITHUB_OUTPUT) {
  await Bun.write(process.env.GITHUB_OUTPUT, `${output.join("\n")}\n`)
}

console.log(`Prepared release ${releaseTag}`)
