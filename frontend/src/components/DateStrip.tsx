/**
 * SportSync - Date Strip Component
 *
 * Horizontal scrollable strip showing dates with a custom dark-themed
 * calendar dropdown (no native datepicker). Shows 7+ days with left/right
 * navigation. Calendar icon opens a fully styled custom month/year view.
 */
import { useState, useRef, useEffect } from "react";
import { getShortDayName, isSameDay } from "../utils/dates";

type DateStripProps = {
  selectedDate: Date;
  onSelectDate: (date: Date) => void;
};

function generateDates(centerDate: Date, range: number = 9): Date[] {
  const dates: Date[] = [];
  const half = Math.floor(range / 2);
  for (let offset = -half; offset <= half; offset++) {
    const d = new Date(centerDate);
    d.setDate(centerDate.getDate() + offset);
    dates.push(d);
  }
  return dates;
}

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const WEEK_LABELS = ["Su","Mo","Tu","We","Th","Fr","Sa"];

function getMonthGrid(year: number, month: number): (number | null)[] {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const grid: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) grid.push(null);
  for (let d = 1; d <= daysInMonth; d++) grid.push(d);
  return grid;
}

export default function DateStrip({ selectedDate, onSelectDate }: DateStripProps) {
  const today = new Date();
  const [centerDate, setCenterDate] = useState(today);
  const [calOpen, setCalOpen] = useState(false);
  const [calYear, setCalYear] = useState(selectedDate.getFullYear());
  const [calMonth, setCalMonth] = useState(selectedDate.getMonth());
  const calRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const dates = generateDates(centerDate, 9);

  function shiftDays(dir: number) {
    const newCenter = new Date(centerDate);
    newCenter.setDate(centerDate.getDate() + dir * 5);
    setCenterDate(newCenter);
  }

  /* Close calendar on outside click */
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (calRef.current && !calRef.current.contains(e.target as Node)) {
        setCalOpen(false);
      }
    }
    if (calOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [calOpen]);

  /* Auto-scroll to today when strip opens */
  useEffect(() => {
    if (scrollRef.current) {
      const todayBtn = scrollRef.current.querySelector("[data-today]");
      if (todayBtn) {
        todayBtn.scrollIntoView({ inline: "center", behavior: "smooth" });
      }
    }
  }, [centerDate]);

  const grid = getMonthGrid(calYear, calMonth);

  return (
    <div className="flex items-center gap-2 px-4 py-3">
      {/* Left arrow */}
      <button
        onClick={() => shiftDays(-1)}
        className="flex-shrink-0 w-8 h-8 rounded-lg bg-surface border border-muted/20 flex items-center justify-center text-muted hover:text-foreground hover:border-muted/40 transition-all"
        aria-label="Earlier dates"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
      </button>

      {/* Date buttons */}
      <div ref={scrollRef} className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide flex-1">
        {dates.map((date) => {
          const isSelected = isSameDay(date, selectedDate);
          const isToday = isSameDay(date, today);

          return (
            <button
              key={date.toISOString()}
              data-today={isToday ? "true" : undefined}
              onClick={() => onSelectDate(date)}
              className={`flex flex-col items-center px-3 py-2 rounded-xl min-w-[56px] transition-all ${
                isSelected
                  ? "bg-accent text-foreground shadow-md shadow-accent/20"
                  : isToday
                  ? "bg-accent/10 text-accent hover:bg-accent/20"
                  : "text-muted hover:text-foreground hover:bg-surface"
              }`}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide">
                {isToday ? "Today" : getShortDayName(date)}
              </span>
              <span className={`text-lg font-bold ${isSelected ? "" : "text-foreground-base"}`}>
                {date.getDate()}
              </span>
            </button>
          );
        })}
      </div>

      {/* Right arrow */}
      <button
        onClick={() => shiftDays(1)}
        className="flex-shrink-0 w-8 h-8 rounded-lg bg-surface border border-muted/20 flex items-center justify-center text-muted hover:text-foreground hover:border-muted/40 transition-all"
        aria-label="Later dates"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 6 15 12 9 18" />
        </svg>
      </button>

      {/* Custom calendar dropdown */}
      <div ref={calRef} className="relative flex-shrink-0">
        <button
          onClick={() => {
            setCalYear(selectedDate.getFullYear());
            setCalMonth(selectedDate.getMonth());
            setCalOpen((prev) => !prev);
          }}
          className={`w-8 h-8 rounded-lg bg-surface border flex items-center justify-center transition-all ${
            calOpen ? "border-accent text-accent" : "border-muted/20 text-muted hover:text-accent hover:border-accent/40"
          }`}
          aria-label="Open calendar"
        >
          <svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>

        {calOpen && (
          <div className="absolute right-0 top-10 w-[280px] bg-surface border border-muted/20 rounded-xl shadow-xl shadow-black/40 z-50 p-4" style={{ backdropFilter: "blur(16px)" }}>
            {/* Month / Year nav */}
            <div className="flex items-center justify-between mb-3">
              <button
                onClick={() => {
                  if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
                  else setCalMonth(calMonth - 1);
                }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-background transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              </button>
              <span className="text-sm font-semibold text-foreground">
                {MONTHS[calMonth]} {calYear}
              </span>
              <button
                onClick={() => {
                  if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
                  else setCalMonth(calMonth + 1);
                }}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-muted hover:text-foreground hover:bg-background transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 6 15 12 9 18"/></svg>
              </button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-0 mb-1">
              {WEEK_LABELS.map((d) => (
                <div key={d} className="text-center text-[10px] text-muted font-medium py-1">{d}</div>
              ))}
            </div>

            {/* Days grid */}
            <div className="grid grid-cols-7 gap-0">
              {grid.map((day, i) => {
                if (day === null) return <div key={i} />;
                const cellDate = new Date(calYear, calMonth, day);
                const isSel = isSameDay(cellDate, selectedDate);
                const isTodayCell = isSameDay(cellDate, today);
                return (
                  <button
                    key={i}
                    onClick={() => {
                      onSelectDate(cellDate);
                      setCenterDate(cellDate);
                      setCalOpen(false);
                    }}
                    className={`w-full aspect-square rounded-lg text-xs font-medium flex items-center justify-center transition-all ${
                      isSel
                        ? "bg-accent text-white"
                        : isTodayCell
                        ? "bg-accent/15 text-accent font-bold"
                        : "text-foreground-base hover:bg-background hover:text-foreground"
                    }`}
                  >
                    {day}
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between mt-3 pt-2 border-t border-muted/10">
              <button
                onClick={() => {
                  onSelectDate(today);
                  setCenterDate(today);
                  setCalOpen(false);
                }}
                className="text-xs text-accent hover:text-accent-hover font-medium transition-colors"
              >
                Today
              </button>
              <button
                onClick={() => setCalOpen(false)}
                className="text-xs text-muted hover:text-foreground font-medium transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
