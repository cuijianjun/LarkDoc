'use strict'

const expectedNode = 'v14.21.3'
const expectedNpm = '8.19.4'
const actualNpm = process.env.npm_config_user_agent && process.env.npm_config_user_agent.match(/npm\/([^\s]+)/)

if (process.version !== expectedNode) {
  console.error(`需要 Node ${expectedNode}，当前为 ${process.version}`)
  process.exit(1)
}

if (!actualNpm || actualNpm[1] !== expectedNpm) {
  console.error(`需要 npm ${expectedNpm}，当前 user-agent 为 ${process.env.npm_config_user_agent || 'unknown'}`)
  process.exit(1)
}

console.log(`runtime ok: Node ${process.version}, npm ${actualNpm[1]}`)
