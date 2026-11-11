// Prebuilt SDKs must create collaboration plugins with their own ProseMirror runtime.
// Keep this optional: ordinary editors do not load Yjs or its transports.
export function loadCollaboration() {
  return import(/* webpackChunkName: "collaboration" */ './collab/index')
}
