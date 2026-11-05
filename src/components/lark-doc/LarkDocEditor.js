import { createVue2Adapter } from '../../legacy-vue/createVue2Adapter'
import { mergeLegacyConfig } from './larkDocConfig'

const props = {
  value: { type: String, default: '<p></p>' }, title: { type: String, default: '' }, readonly: { type: Boolean, default: false },
  config: { type: Object, default: () => ({}) }, maxLength: { type: Number, default: null }, imageMaxSize: { type: Number, default: null },
  templates: { type: Array, default: () => [] }, uploadImage: { type: Function, default: null }, msgId: { type: [Number, String], default: null },
  uploadFile: { type: Function, default: null }, resolveFileUrl: { type: Function, default: null }, session: { type: Object, default: null },
  contentFormat: { type: String, default: 'auto' }, foldPersistKey: { type: String, default: '' }, collab: { type: Object, default: null },
  onEmbedTitle: { type: Function, default: null }, onEmbedSave: { type: Function, default: null }, onEmbedCardAction: { type: Function, default: null },
  embedProviders: { type: Array, default: null }, onBookmarkOpen: { type: Function, default: null }, unfurlProvider: { type: Function, default: null },
  embedSandbox: { type: String, default: null }, embedAllow: { type: String, default: null },
  mentionSource: { type: [Array, Function, Object], default: null }, calendarSource: { type: [Array, Function, Object], default: null },
  onCalendarEventJoin: { type: Function, default: null }, calendarEventRefetch: { type: Function, default: null },
}

export default createVue2Adapter({
  name: 'LarkDocEditor', props, editor: true,
  mapProps(vm) {
    const config = mergeLegacyConfig(vm.config, { maxLength: vm.maxLength, imageMaxSize: vm.imageMaxSize })
    return {
      ...vm.$props, initialContent: vm._pendingHTML ?? vm.value, initialTitle: vm.title,
      config: { ...config, features: { ...config.features, persistence: false } },
    }
  },
})
