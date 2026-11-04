import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DIST = resolve(ROOT, 'dist')

const TARGETS = {
  adapters: {
    entries: {
      'lark-doc-vue3': resolve(ROOT, 'src/adapters/vue3/index.js'),
      'lark-doc-react': resolve(ROOT, 'src/adapters/react/index.js'),
    },
    external: () => false,
    output: {
      dir: DIST,
      format: 'es',
      entryFileNames: '[name].mjs',
      chunkFileNames: 'rollup-[name]-[hash].mjs',
      inlineDynamicImports: false,
      sourcemap: false,
    },
  },
  collab: {
    entries: {
      'lark-doc-collab': resolve(ROOT, 'src/collab/index.js'),
    },
    // Collaboration dependencies must remain owned by the host. This prevents
    // duplicate Yjs/Tiptap/ProseMirror instances in a consuming application.
    external: (id) => !id.startsWith('.') && !id.startsWith('/') && !id.startsWith('\\'),
    output: {
      dir: DIST,
      format: 'es',
      entryFileNames: '[name].esm.js',
      chunkFileNames: 'rollup-[name]-[hash].esm.js',
      inlineDynamicImports: false,
      sourcemap: false,
    },
  },
}

export function getRollupConfig(target = process.env.ROLLUP_TARGET || 'adapters') {
  const selected = TARGETS[target]
  if (!selected) {
    throw new Error(`Unknown ROLLUP_TARGET: ${target}. Expected adapters or collab.`)
  }

  return {
    input: selected.entries,
    external: selected.external,
    plugins: [
    ],
    output: selected.output,
    treeshake: true,
    onwarn(warning, defaultHandler) {
      if (warning.code === 'CIRCULAR_DEPENDENCY') return
      defaultHandler(warning)
    },
  }
}

export default getRollupConfig()
