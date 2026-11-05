import { createVue2Adapter } from '../../legacy-vue/createVue2Adapter'

const props = {
  config: { type: Object, default: () => ({}) }, templates: { type: Array, default: null }, persistence: { type: Object, default: null },
  saveHtml: { type: Boolean, default: false }, session: { type: Object, default: null }, documentId: { type: [String, Number], default: null },
  user: { type: Object, default: null }, capabilities: { type: Object, default: null }, initialTitle: { type: String, default: null },
  initialContent: { type: [String, Object], default: null }, contentFormat: { type: String, default: 'auto' }, readonly: { type: Boolean, default: false },
  uploader: { type: [Object, Function], default: null }, uploadImage: { type: Function, default: null },
  uploadFile: { type: Function, default: null }, resolveFileUrl: { type: Function, default: null },
  aiProvider: { type: [Object, String, Function], default: null },
  onEmbedTitle: { type: Function, default: null }, onEmbedSave: { type: Function, default: null }, onEmbedCardAction: { type: Function, default: null },
  embedProviders: { type: Array, default: null }, onBookmarkOpen: { type: Function, default: null }, unfurlProvider: { type: Function, default: null },
  embedSandbox: { type: String, default: null }, embedAllow: { type: String, default: null },
}

export default createVue2Adapter({
  name: 'LarkDocWorkspace', props,
  mapProps: vm => ({ ...vm.$props, foldPersistKey: String(vm.documentId || 'local') }),
})
