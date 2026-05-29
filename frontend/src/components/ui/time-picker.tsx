"use client";

import * as React from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

interface TimePickerProps {
  value?: string; // HH:mm (24h) stored value
  onChange?: (value: string) => void;
  placeholder?: string;
}

const HOURS_12 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));

function to12(h24: string): { hour12: number; period: "AM" | "PM" } {
  const n = parseInt(h24, 10);
  if (n === 0) return { hour12: 12, period: "AM" };
  if (n < 12) return { hour12: n, period: "AM" };
  if (n === 12) return { hour12: 12, period: "PM" };
  return { hour12: n - 12, period: "PM" };
}

function to24(hour12: number, period: "AM" | "PM"): string {
  let h = hour12;
  if (period === "AM" && h === 12) h = 0;
  else if (period === "PM" && h !== 12) h += 12;
  return String(h).padStart(2, "0");
}

function formatDisplay(value: string): string {
  const [h, m] = value.split(":");
  const { hour12, period } = to12(h);
  return `${hour12}:${m} ${period}`;
}

export function TimePicker({ value, onChange, placeholder = "Select time" }: TimePickerProps) {
  const [open, setOpen] = React.useState(false);

  const selectedMinute = value ? value.split(":")[1] : "";
  const { hour12: selectedHour12, period: selectedPeriod } = value
    ? to12(value.split(":")[0])
    : { hour12: 0, period: "AM" as const };

  const [hourInput, setHourInput] = React.useState("");
  const [minuteInput, setMinuteInput] = React.useState("");
  const hourRef = React.useRef<HTMLDivElement>(null);
  const minuteRef = React.useRef<HTMLDivElement>(null);
  const hourInputRef = React.useRef<HTMLInputElement>(null);
  const minuteInputRef = React.useRef<HTMLInputElement>(null);
  const valueOnOpen = React.useRef(value);

  React.useEffect(() => {
    if (open) {
      valueOnOpen.current = value;
      setHourInput(value ? String(selectedHour12) : "");
      setMinuteInput(selectedMinute);
      setTimeout(() => {
        hourInputRef.current?.focus();
        hourRef.current?.querySelector("[data-selected]")?.scrollIntoView({ block: "center" });
        minuteRef.current?.querySelector("[data-selected]")?.scrollIntoView({ block: "center" });
      }, 0);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const commit = (h12: number, m: string, p: "AM" | "PM") => {
    onChange?.(`${to24(h12, p)}:${m || "00"}`);
  };

  const handleHourInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 2);
    setHourInput(raw);
    const n = parseInt(raw, 10);
    if (n >= 1 && n <= 12) {
      commit(n, selectedMinute || "00", selectedPeriod);
    }
  };

  const handleMinuteInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace(/\D/g, "").slice(0, 2);
    setMinuteInput(raw);
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 0 && n <= 59) {
      commit(selectedHour12 || 12, String(n).padStart(2, "0"), selectedPeriod);
    }
  };

  const handleHourKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); setOpen(false); }
    if (e.key === "Escape") { e.preventDefault(); onChange?.(valueOnOpen.current || ""); setOpen(false); }
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      minuteInputRef.current?.focus();
    }
  };

  const handleMinuteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") { e.preventDefault(); setOpen(false); }
    if (e.key === "Escape") { e.preventDefault(); onChange?.(valueOnOpen.current || ""); setOpen(false); }
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();
      hourInputRef.current?.focus();
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(
        "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors",
        "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        !value && "text-muted-foreground"
      )}>
        <Clock className="h-4 w-4 text-muted-foreground" />
        {value ? formatDisplay(value) : placeholder}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-2">
        <style>{`
          .tp-scroll::-webkit-scrollbar-thumb {
            background-color: oklch(0.7 0 0);
            border-radius: 3px;
          }
          .dark .tp-scroll::-webkit-scrollbar-thumb {
            background-color: oklch(0.35 0 0);
          }
        `}</style>
        <div className="flex gap-1">
          <div className="flex flex-col">
            <span className="mb-1 text-center text-xs font-medium text-muted-foreground">Hour</span>
            <input
              ref={hourInputRef}
              type="text"
              inputMode="numeric"
              value={hourInput}
              onChange={handleHourInput}
              onKeyDown={handleHourKeyDown}
              placeholder="HH"
              className="mb-1 h-8 w-12 rounded-md border border-input bg-transparent text-center text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div ref={hourRef} className="tp-scroll h-40 w-12 overflow-y-auto rounded-md border border-border">
              {HOURS_12.map((h) => (
                <button
                  key={h}
                  type="button"
                  data-selected={value && h === selectedHour12 ? "" : undefined}
                  onClick={() => { commit(h, selectedMinute || "00", selectedPeriod); setHourInput(String(h)); }}
                  className={cn(
                    "w-full py-1.5 text-center text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    value && h === selectedHour12 && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                  )}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col">
            <span className="mb-1 text-center text-xs font-medium text-muted-foreground">Min</span>
            <input
              ref={minuteInputRef}
              type="text"
              inputMode="numeric"
              value={minuteInput}
              onChange={handleMinuteInput}
              onKeyDown={handleMinuteKeyDown}
              placeholder="MM"
              className="mb-1 h-8 w-12 rounded-md border border-input bg-transparent text-center text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <div ref={minuteRef} className="tp-scroll h-40 w-12 overflow-y-auto rounded-md border border-border">
              {MINUTES.map((m) => (
                <button
                  key={m}
                  type="button"
                  data-selected={m === selectedMinute ? "" : undefined}
                  onClick={() => { commit(selectedHour12 || 12, m, selectedPeriod); setMinuteInput(m); }}
                  className={cn(
                    "w-full py-1.5 text-center text-sm transition-colors hover:bg-accent hover:text-accent-foreground",
                    m === selectedMinute && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col justify-center gap-1 ml-1">
            {(["AM", "PM"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => commit(selectedHour12 || 12, selectedMinute || "00", p)}
                className={cn(
                  "rounded-md px-2.5 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  value && p === selectedPeriod && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                )}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
