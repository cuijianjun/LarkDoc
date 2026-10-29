import { createReminder } from '../../../ui/reminder'

export default {
  watch: {
    reminderOpen() { this.refreshReminder() },
    reminderTimesOpen() { this.refreshReminder() },
    reminderStyle: { deep: true, handler() { this.refreshReminder() } },
    reminderTimesStyle: { deep: true, handler() { this.refreshReminder() } },
    reminderViewTitle() { this.refreshReminder() },
    reminderWeekdays: { deep: true, handler() { this.refreshReminder() } },
    reminderCells: { deep: true, handler() { this.refreshReminder() } },
    reminderSelectedTime() { this.refreshReminder() },
    reminderRepeatText() { this.refreshReminder() },
    reminderUser() { this.refreshReminder() },
    reminderTimeOptions: { deep: true, handler() { this.refreshReminder() } },
    effectiveReadonly() { this.refreshReminder() },
  },
  methods: {
    mountReminder() {
      if (this._reminderUi) return
      const host = this.$refs.reminderHost
      if (!host) return
      this._reminderUi = createReminder({
        host,
        handlers: {
          onShiftMonth: (step) => this.shiftReminderMonth(step),
          onChooseDay: (cell) => this.chooseReminderDay(cell),
          onToggleTimes: () => this.toggleReminderTimes(),
          onChooseTime: (slot) => this.chooseReminderTime(slot),
        },
      })
      this.refreshReminder()
    },
    buildReminderState() {
      return {
        open: !!this.reminderOpen,
        timesOpen: !!this.reminderTimesOpen && !!this.reminderOpen,
        style: this.reminderStyle,
        timesStyle: this.reminderTimesStyle,
        viewTitle: this.reminderViewTitle,
        weekdays: this.reminderWeekdays,
        cells: this.reminderCells,
        selectedTime: this.reminderSelectedTime,
        repeatText: this.reminderRepeatText,
        user: this.reminderUser,
        timeOptions: this.reminderTimeOptions,
      }
    },
    refreshReminder() {
      if (this._reminderUi) this._reminderUi.update(this.buildReminderState())
    },
    destroyReminder() {
      if (!this._reminderUi) return
      this._reminderUi.destroy()
      this._reminderUi = null
    },
  },
}
