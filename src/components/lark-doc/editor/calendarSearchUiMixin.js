import { createLazyView } from '../../../ui/lazy'

export default {
  watch: {
    calendarOpen() { this.refreshCalendarSearch() },
    calendarStyle: { deep: true, handler() { this.refreshCalendarSearch() } },
    calendarQuery() { this.refreshCalendarSearch() },
    calendarResults: { deep: true, handler() { this.refreshCalendarSearch() } },
    calendarActiveIndex() { this.refreshCalendarSearch() },
    calendarLoading() { this.refreshCalendarSearch() },
  },
  methods: {
    mountCalendarSearch() {
      const host = this.$refs.calendarSearchHost
      if (!host) return
      this._calendarSearchUi = createLazyView(() => import('../../../ui/calendarSearch'), 'createCalendarSearch', {
        host,
        handlers: {
          onClose: () => this.closeCalendarSearch(),
          onQuery: event => this.onCalendarQueryInput(event),
          onMove: step => this.moveCalendarActive(step),
          onChoose: item => this.chooseCalendarEvent(item),
          onActive: index => this.setCalendarActive(index),
          onBlur: () => this.onCalendarBlur(),
        },
      }, { onError: () => { this.error = '界面暂时无法打开，请关闭后重试' }, onReady: () => this.positionCalendarSearch() })
      this.refreshCalendarSearch()
    },
    buildCalendarSearchState() {
      return {
        open: !!this.calendarOpen,
        style: this.calendarStyle,
        query: this.calendarQuery,
        results: this.calendarResults,
        activeIndex: this.calendarActiveIndex,
        loading: this.calendarLoading,
      }
    },
    refreshCalendarSearch() {
      if (this._calendarSearchUi) this._calendarSearchUi.update(this.buildCalendarSearchState())
    },
    destroyCalendarSearch() {
      if (this._calendarSearchUi) { this._calendarSearchUi.destroy(); this._calendarSearchUi = null }
    },
  },
}
