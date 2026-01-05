"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useSession, signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  MessageSquare,
  ChevronDown,
  ChevronRight,
  Settings,
  LogOut,
  Trash2,
  Loader2,
  PanelLeftClose,
  PanelRightClose,
  PanelLeft,
  PanelRight,
  Sparkles,
  FolderKanban,
  LayoutDashboard,
  SlidersHorizontal,
  ImageIcon,
  Lock,
} from "lucide-react";
import Link from "next/link";
import { ConversationTabs, Tab } from "./conversation-tabs";
import { MessageContent } from "./message-content";
import { MessageInput } from "./message-input";

interface ProjectModel {
  id: number;
  model_id: number;
  model_model_id: string;
  model_display_name: string;
  is_default: boolean;
  supports_image_generation: boolean;
  system_instruction: string | null;
}

interface Project {
  id: number;
  title: string;
  client_name: string | null;
}

interface Message {
  id: number;
  role: "user" | "model";
  content: string;
  content_type?: "text" | "image" | "mixed";
  image_url?: string | null;
  created_at: string;
  isStreaming?: boolean;
}

interface Conversation {
  id: number;
  title: string;
  model_id: number;
  model_display_name: string;
  model_supports_image_generation?: boolean;
  project_id: number | null;
  project_title: string | null;
  last_message: string | null;
  message_count: number;
  updated_at: string;
  temperature: number;
  top_p: number;
  top_k: number;
  max_output_tokens: number;
  system_instruction: string | null;
  image_aspect_ratio: string;
  image_size: string;
}

// LocalStorage keys
const STORAGE_KEY_TABS = "nanano_open_tabs";
const STORAGE_KEY_ACTIVE_TAB = "nanano_active_tab";
const STORAGE_KEY_PROJECT = "nanano_selected_project";

export function ChatInterface() {
  const { data: session } = useSession();
  const [mounted, setMounted] = useState(false);
  const [projectModels, setProjectModels] = useState<ProjectModel[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  // Tab system
  const [openTabs, setOpenTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<number | null>(null);
  const [tabMessages, setTabMessages] = useState<Record<number, Message[]>>({});
  const [tabConversations, setTabConversations] = useState<Record<number, Conversation>>({});

  const [selectedModelId, setSelectedModelId] = useState<number | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingModels, setLoadingModels] = useState(false);
  const [sendingTabs, setSendingTabs] = useState<Record<number, boolean>>({});
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const nextTabId = useRef(1);

  // Settings state
  const [temperature, setTemperature] = useState(1.0);
  const [topP, setTopP] = useState(0.95);
  const [topK, setTopK] = useState(40);
  const [maxOutputTokens, setMaxOutputTokens] = useState(8192);
  const [systemInstruction, setSystemInstruction] = useState("");

  // Image generation settings
  const [imageAspectRatio, setImageAspectRatio] = useState("1:1");
  const [imageSize, setImageSize] = useState("1K");

  // Project system instruction
  const [useProjectSystemInstruction, setUseProjectSystemInstruction] = useState(true);

  // Get current tab's conversation and messages
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const currentConversation = activeTab ? tabConversations[activeTab.id] : null;
  const messages = activeTab ? tabMessages[activeTab.id] || [] : [];
  const isSending = activeTab ? sendingTabs[activeTab.id] || false : false;

  // Mark component as mounted for hydration
  useEffect(() => {
    setMounted(true);
  }, []);

  // Load from localStorage on mount
  useEffect(() => {
    const savedProject = localStorage.getItem(STORAGE_KEY_PROJECT);
    if (savedProject) {
      setSelectedProjectId(Number(savedProject));
    }
  }, []);

  // Save project to localStorage
  useEffect(() => {
    if (selectedProjectId) {
      localStorage.setItem(STORAGE_KEY_PROJECT, String(selectedProjectId));
    } else {
      localStorage.removeItem(STORAGE_KEY_PROJECT);
    }
  }, [selectedProjectId]);

  // Restore tabs from localStorage after conversations are loaded
  useEffect(() => {
    if (conversations.length > 0 && openTabs.length === 0) {
      const savedTabs = localStorage.getItem(STORAGE_KEY_TABS);
      const savedActiveTab = localStorage.getItem(STORAGE_KEY_ACTIVE_TAB);

      if (savedTabs) {
        try {
          const tabIds: number[] = JSON.parse(savedTabs);
          const restoredTabs: Tab[] = [];
          const restoredConversations: Record<number, Conversation> = {};

          tabIds.forEach((convId) => {
            const conv = conversations.find((c) => c.id === convId);
            if (conv) {
              const tabId = nextTabId.current++;
              restoredTabs.push({
                id: tabId,
                conversationId: convId,
                title: conv.title,
                isLoading: false,
              });
              restoredConversations[tabId] = conv;
              // Fetch messages for this tab
              fetchMessagesForTab(tabId, convId);
            }
          });

          if (restoredTabs.length > 0) {
            setOpenTabs(restoredTabs);
            setTabConversations(restoredConversations);

            // Restore active tab
            if (savedActiveTab) {
              const activeConvId = Number(savedActiveTab);
              const activeTab = restoredTabs.find((t) => t.conversationId === activeConvId);
              if (activeTab) {
                setActiveTabId(activeTab.id);
              } else {
                setActiveTabId(restoredTabs[0].id);
              }
            } else {
              setActiveTabId(restoredTabs[0].id);
            }
          }
        } catch (e) {
          console.error("Error restoring tabs:", e);
        }
      }
    }
  }, [conversations]);

  // Save tabs to localStorage when they change
  useEffect(() => {
    if (openTabs.length > 0) {
      const tabConvIds = openTabs.map((t) => t.conversationId);
      localStorage.setItem(STORAGE_KEY_TABS, JSON.stringify(tabConvIds));

      if (activeTabId) {
        const activeTab = openTabs.find((t) => t.id === activeTabId);
        if (activeTab) {
          localStorage.setItem(STORAGE_KEY_ACTIVE_TAB, String(activeTab.conversationId));
        }
      }
    } else {
      localStorage.removeItem(STORAGE_KEY_TABS);
      localStorage.removeItem(STORAGE_KEY_ACTIVE_TAB);
    }
  }, [openTabs, activeTabId]);

  const fetchProjectModels = useCallback(async (projectId: number) => {
    setLoadingModels(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/models`);
      if (res.ok) {
        const data: ProjectModel[] = await res.json();
        setProjectModels(data);
        const defaultModel = data.find((m) => m.is_default);
        if (defaultModel) {
          setSelectedModelId(defaultModel.model_id);
        } else if (data.length > 0) {
          setSelectedModelId(data[0].model_id);
        } else {
          setSelectedModelId(null);
        }
      }
    } catch (err) {
      console.error("Error fetching project models:", err);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (err) {
      console.error("Error fetching projects:", err);
    }
  }, []);

  const fetchConversations = useCallback(async () => {
    try {
      let url = "/api/conversations";
      if (selectedProjectId) {
        url += `?project_id=${selectedProjectId}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
      }
    } catch (err) {
      console.error("Error fetching conversations:", err);
    } finally {
      setLoadingConversations(false);
    }
  }, [selectedProjectId]);

  const fetchMessagesForTab = async (tabId: number, conversationId: number) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}`);
      if (res.ok) {
        const data = await res.json();
        setTabMessages((prev) => ({ ...prev, [tabId]: data.messages || [] }));
        // Update tab conversation with full details
        setTabConversations((prev) => ({
          ...prev,
          [tabId]: {
            ...prev[tabId],
            temperature: data.temperature,
            top_p: data.top_p,
            top_k: data.top_k,
            max_output_tokens: data.max_output_tokens,
            system_instruction: data.system_instruction,
            model_id: data.model_id,
            image_aspect_ratio: data.image_aspect_ratio || "1:1",
            image_size: data.image_size || "1K",
            model_supports_image_generation: data.model_supports_image_generation,
          },
        }));
        // If this is the active tab, update settings
        if (tabId === activeTabId) {
          setTemperature(data.temperature);
          setTopP(data.top_p);
          setTopK(data.top_k);
          setMaxOutputTokens(data.max_output_tokens);
          setSystemInstruction(data.system_instruction || "");
          setSelectedModelId(data.model_id);
          setImageAspectRatio(data.image_aspect_ratio || "1:1");
          setImageSize(data.image_size || "1K");
        }
      }
    } catch (err) {
      console.error("Error fetching messages:", err);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    if (selectedProjectId) {
      fetchProjectModels(selectedProjectId);
      // Clear tabs when changing project
      setOpenTabs([]);
      setActiveTabId(null);
      setTabMessages({});
      setTabConversations({});
    } else {
      setProjectModels([]);
      setSelectedModelId(null);
    }
  }, [selectedProjectId, fetchProjectModels]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Update settings when switching tabs
  useEffect(() => {
    if (activeTabId && tabConversations[activeTabId]) {
      const conv = tabConversations[activeTabId];
      setTemperature(Number(conv.temperature));
      setTopP(Number(conv.top_p));
      setTopK(conv.top_k);
      setMaxOutputTokens(conv.max_output_tokens);
      setSystemInstruction(conv.system_instruction || "");
      setSelectedModelId(conv.model_id);
      setImageAspectRatio(conv.image_aspect_ratio || "1:1");
      setImageSize(conv.image_size || "1K");
    }
  }, [activeTabId, tabConversations]);

  // Actualizar settings de una conversación existente
  const updateConversationSettings = async (
    conversationId: number,
    settings: {
      system_instruction?: string;
      temperature?: number;
      top_p?: number;
      top_k?: number;
      max_output_tokens?: number;
      model_id?: number;
      image_aspect_ratio?: string;
      image_size?: string;
    }
  ) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });

      if (res.ok) {
        // Actualizar el estado local
        setTabConversations((prev) => {
          const tabId = Object.keys(prev).find(
            (key) => prev[Number(key)]?.id === conversationId
          );
          if (tabId) {
            return {
              ...prev,
              [tabId]: { ...prev[Number(tabId)], ...settings },
            };
          }
          return prev;
        });
        return true;
      }
    } catch (err) {
      console.error("Error updating conversation:", err);
    }
    return false;
  };

  // Manejar cambio de modelo (requiere confirmación si hay mensajes)
  const handleModelChange = async (newModelId: number) => {
    if (!currentConversation) {
      setSelectedModelId(newModelId);
      return;
    }

    const hasMessages = messages.length > 0;

    if (hasMessages) {
      const confirmed = window.confirm(
        "Cambiar el modelo iniciará una nueva conversación. ¿Deseas continuar?"
      );
      if (confirmed) {
        setSelectedModelId(newModelId);
        // Crear nueva conversación con el nuevo modelo
        handleNewTab();
      }
      // Si no confirma, no hacer nada (mantener modelo actual)
    } else {
      // Sin mensajes, permitir cambio directo
      setSelectedModelId(newModelId);
      await updateConversationSettings(currentConversation.id, { model_id: newModelId });
    }
  };

  // Manejar cambios de settings (excepto modelo)
  const handleSettingChange = async (
    setting: "system_instruction" | "temperature" | "top_p" | "top_k" | "max_output_tokens" | "image_aspect_ratio" | "image_size",
    value: string | number
  ) => {
    // Actualizar estado local inmediatamente
    switch (setting) {
      case "system_instruction":
        setSystemInstruction(value as string);
        break;
      case "temperature":
        setTemperature(value as number);
        break;
      case "top_p":
        setTopP(value as number);
        break;
      case "top_k":
        setTopK(value as number);
        break;
      case "max_output_tokens":
        setMaxOutputTokens(value as number);
        break;
      case "image_aspect_ratio":
        setImageAspectRatio(value as string);
        break;
      case "image_size":
        setImageSize(value as string);
        break;
    }

    // Si hay conversación activa, guardar en DB
    if (currentConversation) {
      await updateConversationSettings(currentConversation.id, { [setting]: value });
    }
  };

  const createNewConversation = async (): Promise<Conversation | null> => {
    if (!selectedModelId || !selectedProjectId) return null;

    const selectedModel = projectModels.find((m) => m.model_id === selectedModelId);

    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: selectedModelId,
          project_id: selectedProjectId,
          temperature,
          top_p: topP,
          top_k: topK,
          max_output_tokens: maxOutputTokens,
          system_instruction: systemInstruction || null,
          image_aspect_ratio: imageAspectRatio,
          image_size: imageSize,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        fetchConversations();
        const newConversation: Conversation = {
          id: data.id,
          title: data.title,
          model_id: selectedModelId,
          model_display_name: selectedModel?.model_display_name || "",
          model_supports_image_generation: selectedModel?.supports_image_generation,
          project_id: selectedProjectId,
          project_title: null,
          last_message: null,
          message_count: 0,
          updated_at: new Date().toISOString(),
          temperature,
          top_p: topP,
          top_k: topK,
          max_output_tokens: maxOutputTokens,
          system_instruction: systemInstruction,
          image_aspect_ratio: imageAspectRatio,
          image_size: imageSize,
        };
        return newConversation;
      }
    } catch (err) {
      console.error("Error creating conversation:", err);
    }
    return null;
  };

  const openConversationInTab = (conversation: Conversation) => {
    // Check if already open
    const existingTab = openTabs.find((t) => t.conversationId === conversation.id);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    // Create new tab
    const tabId = nextTabId.current++;
    const newTab: Tab = {
      id: tabId,
      conversationId: conversation.id,
      title: conversation.title,
      isLoading: true,
    };

    setOpenTabs((prev) => [...prev, newTab]);
    setTabConversations((prev) => ({ ...prev, [tabId]: conversation }));
    setActiveTabId(tabId);

    // Fetch messages
    fetchMessagesForTab(tabId, conversation.id).then(() => {
      setOpenTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, isLoading: false } : t))
      );
    });
  };

  const handleNewTab = async () => {
    const conversation = await createNewConversation();
    if (conversation) {
      openConversationInTab(conversation);
    }
  };

  const handleTabClose = (tabId: number) => {
    const tabIndex = openTabs.findIndex((t) => t.id === tabId);
    setOpenTabs((prev) => prev.filter((t) => t.id !== tabId));

    // Clean up state
    setTabMessages((prev) => {
      const newState = { ...prev };
      delete newState[tabId];
      return newState;
    });
    setTabConversations((prev) => {
      const newState = { ...prev };
      delete newState[tabId];
      return newState;
    });
    setSendingTabs((prev) => {
      const newState = { ...prev };
      delete newState[tabId];
      return newState;
    });

    // Switch to adjacent tab if closing active
    if (activeTabId === tabId) {
      const remainingTabs = openTabs.filter((t) => t.id !== tabId);
      if (remainingTabs.length > 0) {
        const newActiveIndex = Math.min(tabIndex, remainingTabs.length - 1);
        setActiveTabId(remainingTabs[newActiveIndex].id);
      } else {
        setActiveTabId(null);
      }
    }
  };

  const deleteConversation = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/conversations/${id}`, { method: "DELETE" });
      if (res.ok) {
        // Close tab if open
        const tabToClose = openTabs.find((t) => t.conversationId === id);
        if (tabToClose) {
          handleTabClose(tabToClose.id);
        }
        fetchConversations();
      }
    } catch (err) {
      console.error("Error deleting conversation:", err);
    }
  };

  const sendMessage = async (
    content: string,
    image?: { dataUrl: string; mimeType: string }
  ) => {
    if (!activeTabId || (!content.trim() && !image)) return;

    let tabId = activeTabId;
    let conversationId = tabConversations[tabId]?.id;

    // If no conversation exists for this tab, create one
    if (!conversationId) {
      const newConv = await createNewConversation();
      if (!newConv) return;
      conversationId = newConv.id;
      setTabConversations((prev) => ({ ...prev, [tabId]: newConv }));
      setOpenTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, conversationId: newConv.id, title: newConv.title } : t
        )
      );
    }

    setSendingTabs((prev) => ({ ...prev, [tabId]: true }));

    // Add optimistic user message
    const tempUserMessage: Message = {
      id: Date.now(),
      role: "user",
      content,
      content_type: image ? "mixed" : "text",
      image_url: image?.dataUrl,
      created_at: new Date().toISOString(),
    };

    setTabMessages((prev) => ({
      ...prev,
      [tabId]: [...(prev[tabId] || []), tempUserMessage],
    }));

    // Add streaming placeholder for model response
    const streamingMessageId = Date.now() + 1;
    const streamingMessage: Message = {
      id: streamingMessageId,
      role: "model",
      content: "",
      content_type: "text",
      created_at: new Date().toISOString(),
      isStreaming: true,
    };

    setTabMessages((prev) => ({
      ...prev,
      [tabId]: [...(prev[tabId] || []), streamingMessage],
    }));

    try {
      // Use streaming endpoint
      const response = await fetch(`/api/conversations/${conversationId}/messages/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          image_url: image?.dataUrl,
          image_mime_type: image?.mimeType,
          useProjectSystemInstruction,
        }),
      });

      if (!response.ok) {
        throw new Error("Error sending message");
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let imageUrl: string | null = null;
      let realUserMessageId: number | null = null;
      let realModelMessageId: number | null = null;

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));

                if (data.type === "user_message") {
                  realUserMessageId = data.id;
                  // Update user message with real ID
                  setTabMessages((prev) => ({
                    ...prev,
                    [tabId]: prev[tabId].map((m) =>
                      m.id === tempUserMessage.id ? { ...m, id: realUserMessageId! } : m
                    ),
                  }));
                } else if (data.type === "chunk") {
                  fullContent += data.text;
                  // Update streaming message
                  setTabMessages((prev) => ({
                    ...prev,
                    [tabId]: prev[tabId].map((m) =>
                      m.id === streamingMessageId
                        ? { ...m, content: fullContent }
                        : m
                    ),
                  }));
                } else if (data.type === "image") {
                  // Imagen recibida del modelo
                  imageUrl = data.imageUrl;
                  setTabMessages((prev) => ({
                    ...prev,
                    [tabId]: prev[tabId].map((m) =>
                      m.id === streamingMessageId
                        ? { ...m, image_url: imageUrl }
                        : m
                    ),
                  }));
                } else if (data.type === "complete") {
                  realModelMessageId = data.id;
                  // Finalize message with image if present
                  const finalImageUrl = data.imageUrl || imageUrl;
                  setTabMessages((prev) => ({
                    ...prev,
                    [tabId]: prev[tabId].map((m) =>
                      m.id === streamingMessageId
                        ? {
                            ...m,
                            id: realModelMessageId!,
                            content: fullContent,
                            image_url: finalImageUrl,
                            isStreaming: false
                          }
                        : m
                    ),
                  }));
                } else if (data.type === "title") {
                  // Actualizar título de la conversación
                  const newTitle = data.title;
                  setOpenTabs((prev) =>
                    prev.map((t) =>
                      t.id === tabId ? { ...t, title: newTitle } : t
                    )
                  );
                  setTabConversations((prev) => ({
                    ...prev,
                    [tabId]: { ...prev[tabId], title: newTitle },
                  }));
                  // También actualizar la lista de conversaciones del sidebar
                  setConversations((prev) =>
                    prev.map((c) =>
                      c.id === conversationId ? { ...c, title: newTitle } : c
                    )
                  );
                } else if (data.type === "error") {
                  realModelMessageId = data.id;
                  setTabMessages((prev) => ({
                    ...prev,
                    [tabId]: prev[tabId].map((m) =>
                      m.id === streamingMessageId
                        ? {
                            ...m,
                            id: realModelMessageId!,
                            content: `Error: ${data.message}`,
                            isStreaming: false,
                          }
                        : m
                    ),
                  }));
                }
              } catch (e) {
                // Ignore parse errors for incomplete chunks
              }
            }
          }
        }
      }

      fetchConversations();
    } catch (err) {
      console.error("Error sending message:", err);
      // Remove streaming message on error
      setTabMessages((prev) => ({
        ...prev,
        [tabId]: prev[tabId].filter((m) => m.id !== streamingMessageId),
      }));
    } finally {
      setSendingTabs((prev) => ({ ...prev, [tabId]: false }));
    }
  };

  const getInitials = (name: string | null | undefined) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const selectedProjectModel = projectModels.find((m) => m.model_id === selectedModelId);

  // Prevent hydration mismatch by not rendering until mounted
  if (!mounted) {
    return (
      <div className="flex h-screen bg-[#0f0f14] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-[#0f0f14]">
      {/* Left Sidebar - Conversations */}
      {leftSidebarOpen && (
        <div className="w-64 border-r border-border/50 bg-[#131318] flex flex-col">
          {/* Header */}
          <div className="p-3 border-b border-border/50">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-500 flex items-center justify-center text-black font-bold text-sm">
                  NS
                </div>
                <span className="text-lg font-semibold tracking-tight">
                  NANANO <span className="text-yellow-400">STUDIO</span>
                </span>
              </div>
            </div>
            <Button
              onClick={handleNewTab}
              className="w-full gap-2"
              size="sm"
              disabled={!selectedProjectId || !selectedModelId}
            >
              <Plus className="h-4 w-4" />
              Nueva conversación
            </Button>
          </div>

          {/* Project Selector */}
          <div className="p-3 border-b border-border/50">
            <label className="text-xs text-muted-foreground mb-1 block">Proyecto</label>
            <select
              className="w-full bg-[#24242e] border border-border/50 rounded-lg px-3 py-2 text-sm"
              value={selectedProjectId || ""}
              onChange={(e) =>
                setSelectedProjectId(e.target.value ? Number(e.target.value) : null)
              }
            >
              <option value="">Selecciona un proyecto</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>

          {/* Conversations List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {loadingConversations ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-4">
                Sin conversaciones
              </div>
            ) : (
              conversations.map((conv) => {
                const isOpenInTab = openTabs.some((t) => t.conversationId === conv.id);
                return (
                  <div
                    key={conv.id}
                    onClick={() => openConversationInTab(conv)}
                    className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                      isOpenInTab
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-accent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <MessageSquare className="h-4 w-4 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate" title={conv.title}>{conv.title}</div>
                      {conv.last_message && (
                        <div className="text-xs text-muted-foreground truncate" title={conv.last_message}>
                          {conv.last_message.slice(0, 30)}...
                        </div>
                      )}
                    </div>
                    <button
                      onClick={(e) => deleteConversation(conv.id, e)}
                      className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-500/10 rounded transition-opacity"
                    >
                      <Trash2 className="h-3 w-3 text-red-400" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          {/* User Menu */}
          <div className="p-3 border-t border-border/50">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-accent transition-colors">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={session?.user?.image || undefined} />
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {getInitials(session?.user?.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-sm font-medium truncate">
                      {session?.user?.name || session?.user?.email}
                    </div>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56 bg-[#1a1a22] border-border/50">
                <DropdownMenuItem asChild>
                  <Link href="/dashboard" className="cursor-pointer">
                    <LayoutDashboard className="mr-2 h-4 w-4" />
                    Dashboard
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/projects" className="cursor-pointer">
                    <FolderKanban className="mr-2 h-4 w-4" />
                    Proyectos
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/settings" className="cursor-pointer">
                    <Settings className="mr-2 h-4 w-4" />
                    Configuración
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a
                    href="https://aistudio.google.com/status"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cursor-pointer"
                  >
                    <Sparkles className="mr-2 h-4 w-4" />
                    Status
                  </a>
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-border/50" />
                <DropdownMenuItem
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  className="text-red-400 focus:text-red-400 cursor-pointer"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}

      {/* Main Chat Area */}
      {selectedProjectId ? (
        <div className="flex-1 flex flex-col">
          {/* Tabs Bar */}
          {openTabs.length > 0 && (
            <ConversationTabs
              tabs={openTabs}
              activeTabId={activeTabId}
              onTabClick={setActiveTabId}
              onTabClose={handleTabClose}
              onNewTab={handleNewTab}
              disabled={isSending}
            />
          )}

          {/* Top Bar */}
          <div className="h-14 border-b border-border/50 flex items-center justify-between px-4">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
                className="h-8 w-8"
              >
                {leftSidebarOpen ? (
                  <PanelLeftClose className="h-4 w-4" />
                ) : (
                  <PanelLeft className="h-4 w-4" />
                )}
              </Button>
              <span className="text-sm font-medium">
                {currentConversation?.title || "Nueva conversación"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {activeTabId !== null && (
                <>
                  <span className="text-sm text-muted-foreground">
                    {selectedProjectModel?.model_display_name || "Selecciona un modelo"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
                    className="h-8 w-8"
                  >
                    {rightSidebarOpen ? (
                      <PanelRightClose className="h-4 w-4" />
                    ) : (
                      <PanelRight className="h-4 w-4" />
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeTabId === null ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-500 flex items-center justify-center text-black font-bold text-2xl">
                    NS
                  </div>
                </div>
                <p className="text-muted-foreground max-w-md">
                  Selecciona una conversación del panel izquierdo o crea una nueva para comenzar.
                </p>
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-500 flex items-center justify-center text-black font-bold text-2xl">
                    NS
                  </div>
                </div>
                <p className="text-muted-foreground max-w-md">
                  Comienza una conversación con los modelos de IA de Nano Banana. Escribe tu
                  mensaje abajo para empezar.
                </p>
              </div>
            ) : (
              <div className="max-w-4xl mx-auto space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
                  >
                    {msg.role === "model" && (
                      <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                        {msg.isStreaming ? (
                          <Loader2 className="h-4 w-4 text-primary animate-spin" />
                        ) : (
                          <Sparkles className="h-4 w-4 text-primary" />
                        )}
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-[#1a1a22] border border-border/50"
                      }`}
                    >
                      <MessageContent
                        content={msg.content}
                        imageUrl={msg.image_url}
                        isUser={msg.role === "user"}
                        isStreaming={msg.isStreaming}
                      />
                    </div>
                    {msg.role === "user" && (
                      <Avatar className="h-8 w-8 shrink-0">
                        <AvatarImage src={session?.user?.image || undefined} />
                        <AvatarFallback className="bg-accent text-xs">
                          {getInitials(session?.user?.name)}
                        </AvatarFallback>
                      </Avatar>
                    )}
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Area */}
          {activeTabId !== null && (
            <MessageInput
              onSend={sendMessage}
              disabled={isSending || !selectedModelId}
              supportsImages={true}
            />
          )}
        </div>
      ) : (
        /* Welcome Screen - No project selected */
        <div className="flex-1 flex flex-col items-center justify-center">
          <FolderKanban className="h-20 w-20 text-muted-foreground/30 mb-6" />
          <h2 className="text-2xl font-bold mb-2">Selecciona un proyecto</h2>
          <p className="text-muted-foreground text-center max-w-md">
            Para comenzar a chatear, selecciona un proyecto desde el panel izquierdo.
          </p>
        </div>
      )}

      {/* Right Sidebar - Settings (solo visible con conversación activa) */}
      {selectedProjectId && rightSidebarOpen && activeTabId !== null && (
        <div className="w-72 border-l border-border/50 bg-[#131318] overflow-y-auto">
          <div className="p-4 space-y-6">
            {/* Model Selector */}
            <div>
              <label className="text-sm font-medium mb-2 block">Modelo</label>
              {loadingModels ? (
                <div className="flex items-center justify-center py-2">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : projectModels.length === 0 ? (
                <div className="text-sm text-muted-foreground bg-[#24242e] rounded-lg p-3 text-center">
                  No hay modelos asignados a este proyecto
                </div>
              ) : (
                <select
                  className="w-full bg-[#24242e] border border-border/50 rounded-lg px-3 py-2 text-sm"
                  value={selectedModelId || ""}
                  onChange={(e) => handleModelChange(Number(e.target.value))}
                  disabled={isSending}
                >
                  {projectModels.map((m) => (
                    <option key={m.model_id} value={m.model_id}>
                      {m.model_display_name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            {/* Project System Instruction (read-only) */}
            {selectedProjectModel?.system_instruction?.trim() && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium flex items-center gap-2">
                    Instrucción base del proyecto
                    {messages.length > 0 && <Lock className="h-3 w-3 text-muted-foreground" />}
                  </label>
                  {messages.length === 0 ? (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useProjectSystemInstruction}
                        onChange={(e) => setUseProjectSystemInstruction(e.target.checked)}
                        className="w-4 h-4 rounded border-border/50 bg-[#24242e] accent-primary"
                      />
                      <span className="text-xs text-muted-foreground">Utilizar</span>
                    </label>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {useProjectSystemInstruction ? "Activo" : "Inactivo"}
                    </span>
                  )}
                </div>
                <div
                  className={`bg-[#1a1a22] border border-border/30 rounded-lg px-3 py-2 text-sm ${
                    !useProjectSystemInstruction ? "opacity-50" : ""
                  }`}
                >
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {selectedProjectModel.system_instruction}
                  </p>
                </div>
              </div>
            )}

            {/* System Instruction */}
            <div>
              <label className="text-sm font-medium mb-2 flex items-center gap-2">
                Instrucción del sistema {selectedProjectModel?.system_instruction ? "(adicional)" : ""}
                {messages.length > 0 && <Lock className="h-3 w-3 text-muted-foreground" />}
              </label>
              {messages.length === 0 ? (
                <textarea
                  value={systemInstruction}
                  onChange={(e) => setSystemInstruction(e.target.value)}
                  onBlur={(e) => handleSettingChange("system_instruction", e.target.value)}
                  placeholder={selectedProjectModel?.system_instruction
                    ? "Instrucciones adicionales para esta conversación..."
                    : "Eres un asistente útil..."}
                  rows={4}
                  disabled={isSending}
                  className="w-full bg-[#24242e] border border-border/50 rounded-lg px-3 py-2 text-sm resize-none disabled:opacity-50"
                />
              ) : (
                <>
                  {systemInstruction ? (
                    <div className="bg-[#1a1a22] border border-border/30 rounded-lg px-3 py-2 text-sm">
                      <p className="text-muted-foreground whitespace-pre-wrap">
                        {systemInstruction}
                      </p>
                    </div>
                  ) : (
                    <div className="bg-[#1a1a22] border border-border/30 rounded-lg px-3 py-2 text-sm">
                      <p className="text-muted-foreground/50 italic">Sin instrucción adicional</p>
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    Para cambiar el system instruction, inicia una nueva conversación.
                  </p>
                </>
              )}
            </div>

            {/* Model Info */}
            {selectedProjectModel && (
              <div className="bg-[#24242e] rounded-lg p-3 text-xs text-muted-foreground">
                <div className="font-medium text-foreground mb-1">
                  {selectedProjectModel.model_display_name}
                </div>
                <div className="font-mono">{selectedProjectModel.model_model_id}</div>
              </div>
            )}

            {/* Image Generation Settings - Only show for models that support it */}
            {selectedProjectModel?.supports_image_generation && (
              <div className="space-y-4 p-4 bg-[#1a1a22] rounded-lg border border-border/50">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <ImageIcon className="h-4 w-4 text-primary" />
                  Generación de Imágenes
                </div>

                {/* Aspect Ratio */}
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">
                    Relación de aspecto
                  </label>
                  <select
                    className="w-full bg-[#24242e] border border-border/50 rounded-lg px-3 py-2 text-sm"
                    value={imageAspectRatio}
                    onChange={(e) => handleSettingChange("image_aspect_ratio", e.target.value)}
                    disabled={isSending}
                  >
                    <option value="1:1">1:1 (Cuadrado)</option>
                    <option value="2:3">2:3 (Retrato)</option>
                    <option value="3:2">3:2 (Paisaje)</option>
                    <option value="3:4">3:4 (Retrato)</option>
                    <option value="4:3">4:3 (Paisaje)</option>
                    <option value="9:16">9:16 (Móvil vertical)</option>
                    <option value="16:9">16:9 (Panorámico)</option>
                    <option value="21:9">21:9 (Ultra panorámico)</option>
                  </select>
                </div>

                {/* Image Size */}
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">
                    Tamaño de imagen
                  </label>
                  <select
                    className="w-full bg-[#24242e] border border-border/50 rounded-lg px-3 py-2 text-sm"
                    value={imageSize}
                    onChange={(e) => handleSettingChange("image_size", e.target.value)}
                    disabled={isSending}
                  >
                    <option value="1K">1K (Estándar)</option>
                    <option value="2K">2K (Alta definición)</option>
                    <option value="4K">4K (Ultra alta definición)</option>
                  </select>
                </div>
              </div>
            )}

            {/* Advanced Settings Toggle */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {showAdvanced ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <SlidersHorizontal className="h-4 w-4" />
              Avanzado
            </button>

            {/* Advanced Settings */}
            {showAdvanced && (
              <div className="space-y-6 pt-2 border-t border-border/50">
                {/* Temperature */}
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-sm font-medium">Temperature</label>
                    <span className="text-sm text-muted-foreground">{temperature}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    onMouseUp={(e) => handleSettingChange("temperature", parseFloat((e.target as HTMLInputElement).value))}
                    onTouchEnd={(e) => handleSettingChange("temperature", parseFloat((e.target as HTMLInputElement).value))}
                    disabled={isSending}
                    className="w-full accent-primary"
                  />
                </div>

                {/* Top P */}
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-sm font-medium">Top P</label>
                    <span className="text-sm text-muted-foreground">{topP}</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={topP}
                    onChange={(e) => setTopP(parseFloat(e.target.value))}
                    onMouseUp={(e) => handleSettingChange("top_p", parseFloat((e.target as HTMLInputElement).value))}
                    onTouchEnd={(e) => handleSettingChange("top_p", parseFloat((e.target as HTMLInputElement).value))}
                    disabled={isSending}
                    className="w-full accent-primary"
                  />
                </div>

                {/* Top K */}
                <div>
                  <div className="flex justify-between mb-2">
                    <label className="text-sm font-medium">Top K</label>
                    <span className="text-sm text-muted-foreground">{topK}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    value={topK}
                    onChange={(e) => setTopK(parseInt(e.target.value))}
                    onMouseUp={(e) => handleSettingChange("top_k", parseInt((e.target as HTMLInputElement).value))}
                    onTouchEnd={(e) => handleSettingChange("top_k", parseInt((e.target as HTMLInputElement).value))}
                    disabled={isSending}
                    className="w-full accent-primary"
                  />
                </div>

                {/* Max Output Tokens */}
                <div>
                  <label className="text-sm font-medium mb-2 block">Max Output Tokens</label>
                  <Input
                    type="number"
                    min="1"
                    max="32768"
                    value={maxOutputTokens}
                    onChange={(e) => setMaxOutputTokens(parseInt(e.target.value) || 8192)}
                    onBlur={(e) => handleSettingChange("max_output_tokens", parseInt(e.target.value) || 8192)}
                    disabled={isSending}
                    className="bg-[#24242e] border-border/50"
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
