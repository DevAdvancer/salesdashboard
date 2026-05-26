"use client"

import * as React from "react"
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

type DateRange = {
  from?: string
  to?: string
}

type CalendarDay = {
  date: Date
  value: string
  isCurrentMonth: boolean
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
})

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

function toDateValue(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function parseDateValue(value?: string) {
  if (!value) return undefined
  const [year, month, day] = value.split("-").map(Number)
  if (!year || !month || !day) return undefined
  return new Date(year, month - 1, day)
}

function getMonthStart(value?: string) {
  const parsed = parseDateValue(value)
  const today = new Date()
  const source = parsed ?? today
  return new Date(source.getFullYear(), source.getMonth(), 1)
}

function addMonths(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1)
}

function buildMonthDays(month: Date): CalendarDay[] {
  const start = new Date(month.getFullYear(), month.getMonth(), 1)
  const gridStart = new Date(start)
  gridStart.setDate(start.getDate() - start.getDay())

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart)
    date.setDate(gridStart.getDate() + index)

    return {
      date,
      value: toDateValue(date),
      isCurrentMonth: date.getMonth() === month.getMonth(),
    }
  })
}

function formatDisplayDate(value?: string) {
  const date = parseDateValue(value)
  if (!date) return ""
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

function splitDateTime(value?: string) {
  const [date = "", time = ""] = (value ?? "").split("T")
  const [hour = "09", minute = "00"] = time.split(":")
  return {
    date,
    hour: hour.padStart(2, "0"),
    minute: minute.padStart(2, "0"),
  }
}

function joinDateTime(date: string, hour: string, minute: string) {
  return `${date}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}`
}

function toDisplayHour(hour: string) {
  const parsedHour = Number(hour)
  const normalizedHour = Number.isFinite(parsedHour) ? parsedHour : 9
  const displayHour = normalizedHour % 12 || 12
  return String(displayHour).padStart(2, "0")
}

function toPeriod(hour: string) {
  const parsedHour = Number(hour)
  return Number.isFinite(parsedHour) && parsedHour >= 12 ? "PM" : "AM"
}

function toTwentyFourHour(displayHour: string, period: string) {
  const parsedHour = Number(displayHour)
  const normalizedHour = Number.isFinite(parsedHour) ? parsedHour : 9
  const twelveHour = normalizedHour === 12 ? 0 : normalizedHour
  return String(period === "PM" ? twelveHour + 12 : twelveHour).padStart(2, "0")
}

function minuteOptions(currentMinute: string) {
  const options = new Set(
    Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0")),
  )
  options.add(currentMinute.padStart(2, "0"))
  return Array.from(options).sort()
}

function isInRange(value: string, range: DateRange) {
  return Boolean(range.from && range.to && value > range.from && value < range.to)
}

function isRangeEdge(value: string, range: DateRange) {
  return value === range.from || value === range.to
}

function CalendarMonth({
  month,
  selected,
  range,
  minDate,
  onSelect,
}: {
  month: Date
  selected?: string
  range?: DateRange
  minDate?: string
  onSelect: (value: string) => void
}) {
  const days = buildMonthDays(month)

  return (
    <div className="min-w-0">
      <div className="mb-3 text-center text-sm font-medium text-foreground">
        {MONTH_LABEL.format(month)}
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[0.6875rem] font-medium text-muted-foreground">
        {WEEKDAYS.map((day) => (
          <div key={day}>{day}</div>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {days.map((day) => {
          const disabled = Boolean(minDate && day.value < minDate)
          const active = selected === day.value || Boolean(range && isRangeEdge(day.value, range))
          const insideRange = Boolean(range && isInRange(day.value, range))

          return (
            <button
              key={day.value}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(day.value)}
              className={cn(
                "h-8 rounded-full text-xs transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink)]",
                day.isCurrentMonth ? "text-foreground" : "text-muted-foreground/40",
                insideRange && "bg-[var(--soft-cloud)] text-foreground",
                active && "bg-[var(--ink)] text-[var(--canvas)]",
                disabled && "cursor-not-allowed opacity-30",
                !disabled && !active && "hover:bg-[var(--accent)]",
              )}
              aria-pressed={active}
            >
              {day.date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function usePopover() {
  const [open, setOpen] = React.useState(false)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [open])

  return { open, setOpen, ref }
}

export function DateRangePicker({
  id,
  value,
  onChange,
  className,
}: {
  id?: string
  value: DateRange
  onChange: (value: DateRange) => void
  className?: string
}) {
  const { open, setOpen, ref } = usePopover()
  const [visibleMonth, setVisibleMonth] = React.useState(() => getMonthStart(value.from ?? value.to))

  React.useEffect(() => {
    if (open) setVisibleMonth(getMonthStart(value.from ?? value.to))
  }, [open, value.from, value.to])

  const selectDate = (nextDate: string) => {
    if (!value.from || (value.from && value.to)) {
      onChange({ from: nextDate, to: undefined })
      return
    }

    if (nextDate < value.from) {
      onChange({ from: nextDate, to: value.from })
    } else {
      onChange({ from: value.from, to: nextDate })
    }
  }

  const label =
    value.from && value.to
      ? `${formatDisplayDate(value.from)} - ${formatDisplayDate(value.to)}`
      : value.from
        ? `${formatDisplayDate(value.from)} - Select end`
        : "Select date range"

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        id={id}
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-10 w-full items-center justify-between gap-3 rounded-[1.5rem]",
          "bg-[var(--input)] px-3 py-2 text-left text-sm text-foreground",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ink)]",
        )}
      >
        <span className={cn(!value.from && "text-muted-foreground")}>{label}</span>
        <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(42rem,calc(100vw-2rem))] rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl">
          <div className="mb-3 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--accent)]"
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div className="text-xs text-muted-foreground">
              {value.from && value.to ? "Range selected" : value.from ? "Choose an end date" : "Choose a start date"}
            </div>
            <button
              type="button"
              onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-[var(--accent)]"
              aria-label="Next month"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <CalendarMonth month={visibleMonth} range={value} onSelect={selectDate} />
            <CalendarMonth month={addMonths(visibleMonth, 1)} range={value} onSelect={selectDate} />
          </div>
          <div className="mt-4 flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => onChange({})}
              className="rounded-full px-3 py-2 text-sm text-muted-foreground hover:bg-[var(--accent)] hover:text-foreground"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-medium text-[var(--canvas)]"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function DateTimePicker({
  id,
  value,
  onChange,
  min,
  className,
  required,
  disabled,
  "aria-required": ariaRequired,
}: {
  id?: string
  value: string
  onChange: (value: string) => void
  min?: string
  className?: string
  required?: boolean
  disabled?: boolean
  "aria-required"?: boolean | "true" | "false"
}) {
  const parts = splitDateTime(value)
  const minParts = splitDateTime(min)

  const setTime = (nextHour: string, nextMinute: string) => {
    const date = parts.date || toDateValue(new Date())
    onChange(joinDateTime(date, nextHour, nextMinute))
  }

  const setDisplayTime = (nextDisplayHour: string, nextMinute: string, nextPeriod: string) => {
    setTime(toTwentyFourHour(nextDisplayHour, nextPeriod), nextMinute)
  }

  const displayValue = parts.date
    ? `${formatDisplayDate(parts.date)} ${toDisplayHour(parts.hour)}:${parts.minute} ${toPeriod(parts.hour)}`
    : "Select date and time"

  return (
    <div
      id={id}
      aria-label={displayValue}
      data-required={ariaRequired ?? required ? true : undefined}
      className={cn(
        "grid w-full grid-cols-[minmax(6.75rem,1fr)_auto_auto_auto_auto] items-center gap-0.5",
        "rounded-[1.5rem] bg-[var(--input)] px-2 py-1 text-sm text-foreground",
        "focus-within:ring-1 focus-within:ring-[var(--ink)]",
        disabled && "cursor-not-allowed opacity-40",
        className,
      )}
    >
      <input
        type="date"
        value={parts.date}
        min={minParts.date}
        disabled={disabled}
        required={required}
        aria-label="Date"
        onChange={(event) => onChange(joinDateTime(event.target.value, parts.hour, parts.minute))}
        className={cn(
          "min-w-0 bg-transparent px-2 text-sm font-medium outline-none",
          "disabled:cursor-not-allowed",
          !parts.date && "text-muted-foreground",
        )}
      />
      <select
        value={toDisplayHour(parts.hour)}
        disabled={disabled}
        onChange={(event) =>
          setDisplayTime(event.target.value, parts.minute, toPeriod(parts.hour))
        }
        className="h-7 w-[2.25rem] bg-transparent px-0 text-center text-sm font-medium outline-none disabled:cursor-not-allowed"
        aria-label="Hour"
      >
        {Array.from({ length: 12 }, (_, hour) => String(hour + 1).padStart(2, "0")).map((hour) => (
          <option key={hour} value={hour}>
            {hour}
          </option>
        ))}
      </select>
      <span className="px-0.5 text-muted-foreground">:</span>
      <select
        value={parts.minute}
        disabled={disabled}
        onChange={(event) =>
          setDisplayTime(toDisplayHour(parts.hour), event.target.value, toPeriod(parts.hour))
        }
        className="h-7 w-[2.25rem] bg-transparent px-0 text-center text-sm font-medium outline-none disabled:cursor-not-allowed"
        aria-label="Minute"
      >
        {minuteOptions(parts.minute).map((minute) => (
          <option key={minute} value={minute}>
            {minute}
          </option>
        ))}
      </select>
      <select
        value={toPeriod(parts.hour)}
        disabled={disabled}
        onChange={(event) =>
          setDisplayTime(toDisplayHour(parts.hour), parts.minute, event.target.value)
        }
        className="h-7 w-[2.75rem] bg-transparent px-0 text-center text-sm font-medium outline-none disabled:cursor-not-allowed"
        aria-label="AM/PM"
      >
        <option value="AM">AM</option>
        <option value="PM">PM</option>
      </select>
    </div>
  )
}
