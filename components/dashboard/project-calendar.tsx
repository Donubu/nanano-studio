"use client";

import { useState, useEffect, useCallback } from "react";
import { ChevronLeft, ChevronRight, Image, Video, Mic, Music, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { GenerationModal, Generation, TagInfo } from "@/components/chat/generation-modal";

interface ProjectCalendarProps {
  projectId: number;
  currentUserId?: number;
  onOpenConversation?: (conversationId: number) => void;
  compact?: boolean;
}

interface DayData {
  date: string;
  images: number;
  videos: number;
  audios: number;
  music: number;
  totalCost: number;
  generations: Generation[];
}

const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const DAY_NAMES = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const DAY_NAMES_SHORT = ["L", "M", "X", "J", "V", "S", "D"];

// Convert UTC datetime string to local date (UTC-3) string YYYY-MM-DD
function utcToLocalDate(utcDateStr: string): string {
  // Parse the UTC date string (format: "YYYY-MM-DD HH:MM:SS")
  const [datePart, timePart] = utcDateStr.split(" ");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hours, minutes, seconds] = (timePart || "00:00:00").split(":").map(Number);

  // Create date in UTC
  const utcDate = new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds));

  // Convert to UTC-3 (subtract 3 hours would be wrong - we need to ADD the offset)
  // UTC-3 means the timezone is 3 hours behind UTC, so local time = UTC - 3 hours
  const localDate = new Date(utcDate.getTime() - 3 * 60 * 60 * 1000);

  // Format as YYYY-MM-DD
  const localYear = localDate.getUTCFullYear();
  const localMonth = String(localDate.getUTCMonth() + 1).padStart(2, "0");
  const localDay = String(localDate.getUTCDate()).padStart(2, "0");

  return `${localYear}-${localMonth}-${localDay}`;
}

export function ProjectCalendar({
  projectId,
  currentUserId = 0,
  onOpenConversation,
  compact = false
}: ProjectCalendarProps) {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [dayDataMap, setDayDataMap] = useState<Record<string, DayData>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<DayData | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [projectTags, setProjectTags] = useState<TagInfo[]>([]);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  // Fetch project tags
  const fetchTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${projectId}/tags`);
      if (res.ok) {
        const data = await res.json();
        setProjectTags(data);
      }
    } catch (err) {
      console.error("Error fetching tags:", err);
    }
  }, [projectId]);

  // Obtener datos del mes
  const fetchMonthData = useCallback(async () => {
    setIsLoading(true);
    try {
      const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

      const res = await fetch(
        `/api/projects/${projectId}/generations?from=${from}&to=${to}&limit=500`
      );

      if (!res.ok) throw new Error("Error fetching generations");

      const data = await res.json();

      // Agrupar por día
      const byDay: Record<string, DayData> = {};

      for (const gen of data.data || []) {
        // Extraer fecha YYYY-MM-DD del created_at (convertido a UTC-3)
        const day = utcToLocalDate(gen.created_at);

        if (!byDay[day]) {
          byDay[day] = {
            date: day,
            images: 0,
            videos: 0,
            audios: 0,
            music: 0,
            totalCost: 0,
            generations: [],
          };
        }

        if (gen.type === "image") byDay[day].images++;
        if (gen.type === "video") byDay[day].videos++;
        if (gen.type === "audio") byDay[day].audios++;
        if (gen.type === "music") byDay[day].music++;
        byDay[day].totalCost += gen.estimated_cost || 0;
        byDay[day].generations.push({
          ...gen,
          tags: gen.tags || [],
          source: "generation" as const,
        });
      }

      setDayDataMap(byDay);
    } catch (error) {
      console.error("Error loading calendar data:", error);
    } finally {
      setIsLoading(false);
    }
  }, [projectId, year, month]);

  useEffect(() => {
    fetchTags();
    fetchMonthData();
  }, [fetchTags, fetchMonthData]);

  // Navegar entre meses
  const navigateMonth = (direction: -1 | 1) => {
    setCurrentDate((prev) => {
      const newDate = new Date(prev);
      newDate.setMonth(newDate.getMonth() + direction);
      return newDate;
    });
  };

  // Generar días del calendario
  const getCalendarDays = () => {
    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    // Día de la semana del primer día (0 = Domingo, ajustar a Lunes = 0)
    let startDay = firstDayOfMonth.getDay() - 1;
    if (startDay < 0) startDay = 6;

    const daysInMonth = lastDayOfMonth.getDate();
    const days: (Date | null)[] = [];

    // Días vacíos al inicio
    for (let i = 0; i < startDay; i++) {
      days.push(null);
    }

    // Días del mes
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }

    // Completar la última fila si es necesario
    while (days.length % 7 !== 0) {
      days.push(null);
    }

    return days;
  };

  const calendarDays = getCalendarDays();
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;

  // Handle clicking on a generation in the day
  const handleDayClick = (data: DayData) => {
    setSelectedDay(data);
    setSelectedIndex(0);
  };

  // Handle generation update (for favorites, tags, etc.)
  const handleUpdateGeneration = (id: number, updates: Partial<Generation>) => {
    setDayDataMap(prev => {
      const newMap = { ...prev };
      for (const date in newMap) {
        newMap[date] = {
          ...newMap[date],
          generations: newMap[date].generations.map(g =>
            g.id === id ? { ...g, ...updates } : g
          ),
        };
      }
      return newMap;
    });

    // Also update selected day if it's open
    if (selectedDay) {
      setSelectedDay({
        ...selectedDay,
        generations: selectedDay.generations.map(g =>
          g.id === id ? { ...g, ...updates } : g
        ),
      });
    }
  };

  // Handle favorite toggle
  const handleToggleFavorite = async (messageId: number) => {
    try {
      const res = await fetch(`/api/messages/${messageId}/favorite`, { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        handleUpdateGeneration(messageId, { is_favorite: data.is_favorite });
      }
    } catch (err) {
      console.error("Error toggling favorite:", err);
    }
  };

  const cellHeight = compact ? "h-12" : "h-20";
  const dayNames = compact ? DAY_NAMES_SHORT : DAY_NAMES;

  return (
    <div className="space-y-2">
      {/* Header con navegación */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="icon"
          className={compact ? "h-7 w-7" : ""}
          onClick={() => navigateMonth(-1)}
        >
          <ChevronLeft className={compact ? "h-4 w-4" : "h-5 w-5"} />
        </Button>
        <h3 className={cn("font-semibold", compact ? "text-sm" : "text-lg")}>
          {compact ? `${MONTH_NAMES[month].substring(0, 3)} ${year}` : `${MONTH_NAMES[month]} ${year}`}
        </h3>
        <Button
          variant="ghost"
          size="icon"
          className={compact ? "h-7 w-7" : ""}
          onClick={() => navigateMonth(1)}
        >
          <ChevronRight className={compact ? "h-4 w-4" : "h-5 w-5"} />
        </Button>
      </div>

      {/* Grid del calendario */}
      <div className="border rounded-lg overflow-hidden">
        {/* Headers de días */}
        <div className="grid grid-cols-7 bg-muted/50">
          {dayNames.map((day) => (
            <div
              key={day}
              className={cn(
                "text-center font-medium text-muted-foreground border-b",
                compact ? "text-[10px] py-1" : "text-xs py-2"
              )}
            >
              {day}
            </div>
          ))}
        </div>

        {/* Celdas de días */}
        {isLoading ? (
          <div className={cn("flex items-center justify-center", compact ? "py-8" : "py-20")}>
            <Loader2 className={cn("animate-spin text-muted-foreground", compact ? "h-5 w-5" : "h-8 w-8")} />
          </div>
        ) : (
          <div className="grid grid-cols-7">
            {calendarDays.map((day, i) => {
              if (!day) {
                return <div key={i} className={cn(cellHeight, "bg-muted/20 border-b border-r")} />;
              }

              const dateKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
              const data = dayDataMap[dateKey];
              const hasActivity = data && (data.images + data.videos + data.audios + data.music) > 0;
              const isToday = isCurrentMonth && day.getDate() === today.getDate();

              return (
                <button
                  key={i}
                  onClick={() => hasActivity && handleDayClick(data)}
                  disabled={!hasActivity}
                  className={cn(
                    cellHeight,
                    "p-1 text-left border-b border-r transition-colors",
                    hasActivity
                      ? "hover:bg-accent cursor-pointer bg-primary/5"
                      : "cursor-default",
                    isToday && "ring-2 ring-inset ring-primary"
                  )}
                >
                  <span
                    className={cn(
                      "font-medium",
                      compact ? "text-[10px]" : "text-sm",
                      isToday && "text-primary"
                    )}
                  >
                    {day.getDate()}
                  </span>
                  {hasActivity && (
                    <div className={cn("flex flex-wrap gap-0.5", compact ? "mt-0.5" : "mt-1")}>
                      {data.images > 0 && (
                        <Badge variant="secondary" className={cn("gap-0.5", compact ? "text-[8px] px-0.5 py-0 h-3" : "text-[10px] px-1 py-0 h-4")}>
                          {data.images}
                          <Image className={compact ? "h-2 w-2" : "h-2.5 w-2.5"} />
                        </Badge>
                      )}
                      {data.videos > 0 && (
                        <Badge variant="secondary" className={cn("gap-0.5", compact ? "text-[8px] px-0.5 py-0 h-3" : "text-[10px] px-1 py-0 h-4")}>
                          {data.videos}
                          <Video className={compact ? "h-2 w-2" : "h-2.5 w-2.5"} />
                        </Badge>
                      )}
                      {data.audios > 0 && !compact && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 gap-0.5">
                          {data.audios}
                          <Mic className="h-2.5 w-2.5" />
                        </Badge>
                      )}
                      {data.music > 0 && !compact && (
                        <Badge variant="secondary" className="text-[10px] px-1 py-0 h-4 gap-0.5">
                          {data.music}
                          <Music className="h-2.5 w-2.5" />
                        </Badge>
                      )}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal de generaciones usando GenerationModal */}
      {selectedDay && selectedIndex !== null && (
        <GenerationModal
          generations={selectedDay.generations}
          selectedIndex={selectedIndex}
          onClose={() => {
            setSelectedDay(null);
            setSelectedIndex(null);
          }}
          onNavigate={setSelectedIndex}
          onOpenConversation={onOpenConversation}
          onToggleFavorite={handleToggleFavorite}
          onUpdateGeneration={handleUpdateGeneration}
          projectId={projectId}
          currentUserId={currentUserId}
          projectTags={projectTags}
          showNavigation={true}
        />
      )}
    </div>
  );
}
