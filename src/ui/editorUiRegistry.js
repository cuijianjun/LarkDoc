export function createEditorUiRegistry() {
  const entries = []

  return {
    register(instance) {
      entries.push(instance)
      return instance
    },

    mount(...args) {
      entries.forEach((instance) => {
        if (typeof instance.mount === 'function') instance.mount(...args)
      })
    },

    update(...args) {
      entries.forEach((instance) => {
        if (typeof instance.update === 'function') instance.update(...args)
      })
    },

    destroy(...args) {
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const instance = entries[index]
        if (typeof instance.destroy === 'function') instance.destroy(...args)
      }
    },
  }
}
