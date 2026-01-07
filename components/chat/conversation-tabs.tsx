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
  return (
    <div className="flex items-center gap-1 bg-background border-b border-border/50 px-2 overflow-x-auto">
      {/* Tabs */}
      <div className="flex items-center gap-1 py-1.5 min-w-0 flex-1 overflow-x-auto scrollbar-thin scrollbar-thumb-border/50">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => !disabled && onTabClick(tab.id)}
            className={cn(
              "group flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm cursor-pointer transition-all min-w-0 max-w-[200px]",
              activeTabId === tab.id
                ? tab.isGallery
                  ? "bg-purple-500/10 text-purple-400 border border-purple-500/30"
                  : tab.isArchived
                    ? "bg-orange-500/10 text-orange-400 border border-orange-500/30"
                    : "bg-primary/10 text-foreground border border-primary/30 shadow-sm"
                : tab.isGallery
                  ? "text-purple-400/60 hover:bg-purple-500/10 hover:text-purple-400"
                  : tab.isArchived
                    ? "text-orange-400/60 hover:bg-orange-500/10 hover:text-orange-400"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground border border-transparent",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            {tab.isLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            ) : tab.isGallery ? (
              <Image className="h-3.5 w-3.5 shrink-0" />
            ) : tab.isArchived ? (
              <Archive className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{tab.title}</span>
            {tabs.length > 1 && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (!disabled) onTabClose(tab.id);
                }}
                className={cn(
                  "p-0.5 rounded hover:bg-red-500/20 opacity-0 group-hover:opacity-100 transition-opacity shrink-0",
                  activeTabId === tab.id && "opacity-100"
                )}
                disabled={disabled}
              >
                <X className="h-3 w-3 text-muted-foreground hover:text-red-400" />
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Botón nueva conversación */}
      <button
        onClick={onNewTab}
        disabled={disabled || tabs.length >= 10}
        className={cn(
          "p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors shrink-0 border border-transparent hover:border-border/50",
          (disabled || tabs.length >= 10) && "opacity-50 cursor-not-allowed"
        )}
        title="Nueva conversación"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}
