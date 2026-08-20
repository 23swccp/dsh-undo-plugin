/** Isolate per-spawn overhead: trivial git invocations vs other executables. */
import { spawn } from 'node:child_process'

function run(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const child = spawn(cmd, args, { cwd, windowsHide: true, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = '', err = ''
    child.stdout.on('data', c => { out += c })
    child.stderr.on('data', c => { err += c })
    child.once('error', reject)
    child.once('exit', code => code === 0
      ? resolve(Date.now() - t0)
      : reject(new Error(`${cmd} ${args.join(' ')}: ${err.slice(0, 100)}`)))
  })
}

const series = async (label, cmd, args, cwd, n = 5) => {
  const times = []
  for (let i = 0; i < n; i++) times.push(await run(cmd, args, cwd))
  console.log(`${label}: ${times.join(' ')} ms`)
}

await series('git --version (no repo)     ', 'git', ['--version'], process.env.TEMP)
await series('git rev-parse (tiny repo)  ', 'git', ['rev-parse', '--git-dir'], 'C:/Users/34293/Desktop/对话')
await series('git status --porcelain tiny', 'git', ['status', '--porcelain'], 'C:/Users/34293/Desktop/对话')
await series('node -e "" (baseline)      ', 'node', ['-e', ''], process.env.TEMP)
await series('where git (spawn cmd)      ', 'cmd', ['/c', 'echo'], process.env.TEMP)
console.log('git path:', process.env.PATH.split(';').find(p => p.toLowerCase().includes('git')) ?? 'not in PATH scan')
