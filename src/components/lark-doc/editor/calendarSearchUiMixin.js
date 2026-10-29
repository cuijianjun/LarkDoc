import { createCalendarSearch } from '../../../ui/calendarSearch'

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
      this._calendarSearchUi = createCalendarSearch({
        host,
        handlers: {
          onClose: () => this.closeCalendarSearch(),
          onQuery: event => this.onCalendarQueryInput(event),
          onMove: step => this.moveCalendarActive(step),
          onChoose: item => this.chooseCalendarEvent(item),
          onActive: index => this.setCalendarActive(index),
          onBlur: () => this.onCalendarBlur(),
        },
      })
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
