"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { DayPicker } from "react-day-picker";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface DatePickerProps {
  value?: string; // ISO date string (YYYY-MM-DD)
  onChange?: (value: string) => void;
  placeholder?: string;
}

export function DatePicker({ value, onChange, placeholder = "Select a date" }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = value ? new Date(value + "T00:00:00") : undefined;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(
        "flex h-9 w-full items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors",
        "hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        !value && "text-muted-foreground"
      )}>
        <CalendarIcon className="h-4 w-4 text-muted-foreground" />
        {value ? format(selected!, "PPP") : placeholder}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-3">
        <DayPicker
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) {
              onChange?.(format(date, "yyyy-MM-dd"));
              setOpen(false);
            }
          }}
          classNames={{
            root: "text-sm",
            months: "flex flex-col",
            month_caption: "flex justify-center items-center h-8 font-medium",
            nav: "flex items-center justify-between absolute inset-x-0 top-0 h-8 px-1",
            button_previous: "h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg]:fill-current",
            button_next: "h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground [&_svg]:fill-current",
            weekdays: "flex",
            weekday: "w-8 text-center text-xs font-medium text-muted-foreground",
            week: "flex",
            day: "w-8 h-8 text-center text-sm inline-flex items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground cursor-pointer",
            day_button: "w-full h-full inline-flex items-center justify-center rounded-md",
            selected: "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
            today: "font-bold",
            outside: "text-muted-foreground opacity-50",
            month_grid: "mt-2",
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
