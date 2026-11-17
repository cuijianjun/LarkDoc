/**
 * 文档会话 —— 通知域。
 *
 * 快照 / 分页 / 已读 / 静音 / 打开线程，以及宿主的订阅与解除。
 */


export const notificationMethods = {
  _notifications() {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    if (!this.can('canView')) throw new Error('当前用户没有通知读取权限')
    const provider = this.providers.notifications
    if (!provider) throw new Error('未配置 notifications Provider')
    return provider
  },

  refreshNotifications() { return this._identityAction(() => this._notifications().snapshot()) },

  loadMoreNotifications() { return this._identityAction(() => this._notifications().loadMore()) },

  markNotificationRead(input) { return this._identityAction(() => this._notifications().markRead(input)) },

  setNotificationsMuted(input) { return this._identityAction(() => this._notifications().setMuted(input)) },

  queryNotificationOperation(id) { return this._identityAction(() => this._notifications().queryOperation(id)) },

  getNotificationOperation(id) { return (!this._identityRequired || this.can('canView')) ? this.providers.notifications?.getOperation?.(id) || null : null },

  openNotificationThread(id) { return this._identityAction(() => this._notifications().openThread(id)) },

  subscribeNotifications(listener) {
    if (this._destroyed) throw new Error('DocumentSession 已销毁')
    if (typeof listener !== 'function') throw new TypeError('notifications listener必须是函数')
    const provider = this.providers.notifications, identityGeneration = this._identityGeneration
    if (!provider) throw new Error('未配置 notifications Provider')
    let active = true
    const unsubscribe = provider.subscribe(value => {
      if (!active || this._destroyed || provider !== this.providers.notifications || !this._identityCurrent(identityGeneration)) return
      if (value.resetRequired && (this._notificationResetProvider !== provider || this._notificationResetGeneration !== value.generation) && value.reason !== 'identity-changed') {
        this._notificationResetProvider = provider; this._notificationResetGeneration = value.generation
        this.emit('notifications-reset', { reason: value.reason })
      }
      listener(value)
    })
    const stop = () => { if (!active) return; active = false; unsubscribe(); this._notificationSubscriptions.delete(stop) }
    this._notificationSubscriptions.add(stop)
    return stop
  }
}
