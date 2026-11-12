import { createReminder } from '../../../ui/reminder'

export default {
  watch: {
    session() { if (this.reminderOpen && !this.reminderContextMatches()) this.closeReminderPopover() },
    documentId() { if (this.reminderOpen && !this.reminderContextMatches()) this.closeReminderPopover() },
    reminderHasTime() { this.refreshReminder() },
    reminderNotify() { this.refreshReminder() },
    reminderNotifyOffset() { this.refreshReminder() },
    reminderCalendarMode() { this.refreshReminder() },
    reminderOffsetsOpen() { this.refreshReminder() },
    reminderTone() { this.refreshReminder() },
    reminderTimeDraft() { this.refreshReminder() },
    reminderPeriodCells: { deep: true, handler() { this.refreshReminder() } },
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
    effectiveReadonly() { if (!this.reminderEditable()) this.closeReminderPopover(); this.refreshReminder() },
    larkDocConfig: { deep: true, handler() { if (!this.reminderEditable()) this.closeReminderPopover(); this.refreshReminder() } },
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
          onEditTime: value => this.editReminderTime(value),
          onCommitTime: value => this.commitReminderTime(value),
          onBlurTime: () => this.blurReminderTime(),
          onOpenTimes: () => { if (!this.reminderTimesOpen) this.toggleReminderTimes() },
          onTimeEscape: event => { const handled = this.onReminderKeydown(event); this.refreshReminder(); return handled },
          onHasTime: value => this.setReminderHasTime(value),
          onNotify: value => this.setReminderNotify(value),
          onToggleOffsets: () => this.toggleReminderOffsets(),
          onChooseOffset: value => this.chooseReminderOffset(value),
          onCalendarMode: mode => this.setReminderCalendarMode(mode),
          onChoosePeriod: value => this.chooseReminderPeriod(value),
        },
      })
      this._reminderBoundEditor = this.editor
      this._reminderBoundEditor.on('transaction', this.onReminderTransaction)
      this.refreshReminder()
    },
    buildReminderState() {
      return {
        open: !!this.reminderOpen,
        hasTime: this.reminderHasTime,
        notify: this.reminderNotify,
        offsetsOpen: !!this.reminderOffsetsOpen,
        offsetOptions: this.reminderOffsetOptions,
        selectedOffset: this.reminderNotifyOffset,
        calendarMode: this.reminderCalendarMode,
        periods: this.reminderPeriodCells,
        viewYear: this.reminderView.year,
        viewMonth: this.reminderView.month,
        tone: this.reminderTone,
        timesOpen: !!this.reminderTimesOpen && !!this.reminderOpen,
        style: this.reminderStyle,
        timesStyle: this.reminderTimesStyle,
        viewTitle: this.reminderViewTitle,
        weekdays: this.reminderWeekdays,
        cells: this.reminderCells,
        selectedTime: this.reminderSelectedTime,
        timeDraft: this.reminderTimeDraft,
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
      this._reminderBoundEditor?.off('transaction', this.onReminderTransaction)
      this._reminderBoundEditor = null
      this._reminderUi.destroy()
      this._reminderUi = null
    },
  },
}
