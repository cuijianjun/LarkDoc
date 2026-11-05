import { createApp } from 'vue'
import App from './App.vue'

const app = createApp(App)
app.mount('#app')
window.addEventListener('pagehide', event => {
  if (!event.persisted) app.unmount()
})
