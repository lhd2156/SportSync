/**
 * SportSync - Date Strip Component
 *
 * Horizontal strip showing 7 days centered around today.
 * User taps a day to filter scores for that date.
 */
import { getWeekDates, getShortDayName, isSameDay } from "../utils/dates";

interface DateStripProps {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
}

export default function DateStrip({ selectedDate, onSelectDate }: DateStripProps) {
  const dates = getWeekDates();
  const today = new Date();

  return (
    <div className="flex items-center gap-2 overflow-x-auto px-4 py-3 scrollbar-hide">
      {dates.map((date) => {
        const isSelected = isSameDay(date, selectedDate);
        const isToday = isSameDay(date, today);

        return (
          <button
            key={date.toISOString()}
            onClick={() => onSelectDate(date)}
            className={`flex flex-col items-center px-4 py-2 rounded-xl min-w-[60px] transition-all ${
              isSelected
                ? "bg-accent text-foreground"
                : "text-muted hover:text-foreground hover:bg-surface"
            }`}
          >
            <span className="text-xs font-medium">
              {isToday ? "Today" : getShortDayName(date)}
            </span>
            <span className={`text-lg font-bold ${isSelected ? "" : "text-foreground-base"}`}>
              {date.getDate()}
            </span>
          </button>
        );
      })}
    </div>
  );
}
