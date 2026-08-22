#!/usr/bin/env node
import { runCli } from '../packages/plugin/src/control/cli.ts'

process.exitCode = await runCli()
