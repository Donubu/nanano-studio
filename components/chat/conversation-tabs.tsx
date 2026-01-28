"use client";

import { X, Plus, Loader2, MessageSquare, Archive, Image } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Tab {
  id: number;
  conversationId: number;
  title: string;
  isLoading: boolean;
  isArchived?: boolean;
  isGallery?: boolean;
  isDraft?: boolean; // Tab sin conversación creada aún
}

interface ConversationTabsProps {
  tabs: Tab[];
  activeTabId: number | null;
  onTabClick: (tabId: number) => void;
  onTabClose: (tabId: number) => void;
  onNewTab: () => void;
  disabled?: boolean;
}

export function ConversationTabs({
  tabs,
  activeTabId,
  onTabClick,
  onTabClose,
  onNewTab,
  disabled = false,
}: ConversationTabsProps) {
  // Determine the active tab type for styling
  const activeTab = tabs.find(t => t.id === activeTabId);
  const isGalleryActive = activeTab?.isGallery;
  const isArchivedActive = activeTab?.isArchived;

  return (
    <div className={cn(
      "relative z-10 flex items-end gap-0 px-2 pt-2 overflow-x-auto overflow-y-hidden",
      // Background color based on active tab type
      isGalleryActive
        ? "bg-purple-500/5 dark:bg-purple-500/10"
        : isArchivedActive
          ? "bg-orange-500/5 dark:bg-orange-500/10"
          : "bg-primary/5 dark:bg-primary/10"
    )}>
      {/* Bottom border line */}
      <div className={cn(
        "absolute bottom-0 left-0 right-0 h-px",
        isGalleryActive
          ? "bg-purple-200 dark:bg-purple-800/50"
          : isArchivedActive
            ? "bg-orange-200 dark:bg-orange-800/50"
            : "bg-blue-200 dark:bg-blue-800/50"
      )} />

      {/* Tabs */}
      <div className="flex items-end gap-1 min-w-0 flex-1 overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-border/50">
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id;

          return (
            <div
              key={tab.id}
              onClick={() => !disabled && onTabClick(tab.id)}
              className={cn(
                "group relative flex items-center gap-2 px-3 py-2 text-sm cursor-pointer transition-all min-w-0 max-w-[200px]",
                "rounded-t-lg border-x border-t",
                isActive
                  ? cn(
                      // Active tab: colored background, extends below border line
                      "-mb-px z-10",
                      tab.isGallery
                        ? "bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/50 font-medium"
                        : tab.isArchived
                          ? "bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300 border-orange-200 dark:border-orange-800/50 font-medium"
                          : "bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800/50 font-medium"
                    )
                  : cn(
                      // Inactive tabs: neutral/muted appearance
                      "bg-transparent text-muted-foreground/70 border-transparent",
                      "hover:text-muted-foreground hover:bg-muted/30"
                    ),
                disabled && "opacity-50 cursor-not-allowed"
              )}
            >
              {tab.isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
              ) : tab.isGallery ? (
                <Image className={cn("h-3.5 w-3.5 shrink-0", !isActive && "opacity-60")} />
              ) : tab.isArchived ? (
                <Archive className={cn("h-3.5 w-3.5 shrink-0", !isActive && "opacity-60")} />
              ) : (
                <MessageSquare className={cn("h-3.5 w-3.5 shrink-0", !isActive && "opacity-60")} />
              )}
              <span className="truncate">{tab.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!disabled) onTabClose(tab.id);
                }}
                className={cn(
                  "p-0.5 rounded hover:bg-red-500/20 opacity-0 group-hover:opacity-100 transition-opacity shrink-0",
                  isActive && "opacity-100"
                )}
                disabled={disabled}
              >
                <X className="h-3 w-3 text-muted-foreground hover:text-red-400" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Botón nueva conversación */}
      <button
        onClick={onNewTab}
        disabled={disabled || tabs.length >= 10}
        className={cn(
          "p-1.5 mb-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0",
          (disabled || tabs.length >= 10) && "opacity-50 cursor-not-allowed"
        )}
        title="Nueva conversación"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
