/** Test-only external CLI protocol endpoint; no Cordis application is launched here. */
import { connect } from 'node:net'
import { createInterface } from 'node:readline'

const socket = connect({ host: '127.0.0.1', port: Number(process.argv[2]) })
const args = process.argv.slice(3)
const consume = args.includes('consume')
socket.on('connect', () => {
  socket.write(JSON.stringify({ kind: consume ? 'consume' : 'reply', args }) + '\n')
})
const reader = createInterface({ input: socket })
reader.on('line', line => {
  const command = JSON.parse(line)
  if (command.ready) process.stderr.write('[event] ready event_key=im.message.receive_v1\n')
  if (command.stdout) process.stdout.write(command.stdout)
  if (command.stderr) process.stderr.write(command.stderr)
  if ('event' in command) process.stdout.write(JSON.stringify(command.event) + '\n')
  if ('reply' in command) {
    process.stdout.write(JSON.stringify(command.reply) + '\n')
    process.exitCode = command.exitCode ?? 0
    socket.end()
  }
  if ('exitCode' in command && !('reply' in command)) {
    process.exitCode = command.exitCode
    socket.end()
    process.stdin.destroy()
  }
})
if (consume) {
  process.stdin.resume()
  process.stdin.on('end', () => { if (!args.includes('--ignore-stdin')) socket.end() })
}
socket.on('end', () => { reader.close(); process.stdin.destroy() })
socket.on('error', error => { process.stderr.write(error.message); process.exitCode = 1; process.stdin.destroy() })
