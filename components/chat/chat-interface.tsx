"use client";

import {useState, useEffect, useRef, useCallback} from "react";
import {useSession, signOut} from "next-auth/react";
import {useTheme} from "next-themes";
import {cn} from "@/lib/utils";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Avatar, AvatarFallback, AvatarImage} from "@/components/ui/avatar";
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
    Archive,
    Loader2,
    PanelLeftClose,
    PanelRightClose,
    PanelLeft,
    PanelRight,
    Sparkles,
    FolderKanban,
    Folder,
    LayoutDashboard,
    SlidersHorizontal,
    ImageIcon,
    Lock,
    Sun,
    Moon,
    Monitor,
    Video,
    HelpCircle,
    Mic,
    Star,
    Dices,
    X,
    Download,
    EyeOff,
    Calculator,
    AudioLines,
    RotateCcw,
} from "lucide-react";
import {ChangelogModal} from "@/components/chat/changelog-modal";
import {Tooltip, TooltipContent, TooltipTrigger} from "@/components/ui/tooltip";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import Link from "next/link";
import {ConversationTabs, Tab} from "./conversation-tabs";
import {MessageContent} from "./message-content";
import {MessageInput, AttachedFile, PreselectedImage} from "./message-input";
import {GenerationsGallery} from "./generations-gallery";
import {VideoSettings} from "./video-settings";
import {ImageSettings, ImagenAspectRatio, ImagenResolution} from "./image-settings";
import {VideoInputFrames, ReferenceImage} from "./video-input-frames";
import {VideoDuration, VideoResolution, VideoAspectRatio, VideoGenerationStatus} from "@/types/video";
import {GenerationModeSelector, GenerationMode} from "./generation-mode-selector";
import {GenerationTypeSelector, GenerationType, GenerationTypeBadge} from "./generation-type-selector";
import {QualitySelector, QualityTier, QualitySelectorCompact} from "./quality-selector";
import {ImageModelSelector} from "./image-model-selector";
import {AudioSettings} from "./audio-settings";
import {TTSComposer} from "./tts-composer";
import {TopazStudio} from "./topaz-studio";
import {TopazStudioVideo} from "./topaz-studio-video";
import {AudioGenerationHistory, AudioRestoreData} from "./audio-generation-history";
import {AudioVoiceId, AudioOutputFormat, AudioSpeakerConfig, AudioGenerationStatus, AudioVoiceConfig} from "@/types/audio";
import {useNavigation, generateSlug} from "@/contexts/navigation-context";

// Helper function to get the icon for a conversation based on its generation type
function getConversationIcon(generationType: string | undefined, className: string) {
    switch (generationType) {
        case "image":
            return <ImageIcon className={className} />;
        case "video":
            return <Video className={className} />;
        case "audio_hd":
            return <AudioLines className={className} />;
        case "audio":
            return <Mic className={className} />;
        case "text":
        default:
            return <MessageSquare className={className} />;
    }
}

interface ProjectModel {
    id: number;
    model_id: number;
    model_model_id: string;
    model_display_name: string;
    is_default: boolean;
    supports_image_generation: boolean;
    supports_video_generation: boolean;
    supports_audio_generation: boolean;
    supports_reference_images: boolean;
    system_instruction: string | null;
}

interface Project {
    id: number;
    title: string;
    client_name: string | null;
    client_logo: string | null;
    generation_count: number;
    last_message_at: string | null;
}

interface Message {
    id: number;
    role: "user" | "model";
    content: string;
    content_type?: "text" | "image" | "video" | "audio" | "mixed" | "error";
    image_url?: string | null;
    images?: { url: string; mime_type: string | null }[];
    is_favorite?: boolean;
    ignore_in_context?: boolean;
    generation_seed?: number | null;
    // Video fields
    video_url?: string | null;
    video_duration?: number | null;
    video_has_audio?: boolean;
    video_aspect_ratio?: string | null;
    isVideoGenerating?: boolean;
    videoProgress?: {
        status: VideoGenerationStatus;
        message: string;
        progress?: number;
    };
    // Audio fields
    audio_url?: string | null;
    audio_duration?: number | null;
    audio_mime_type?: string | null;
    audio_voice_config?: AudioVoiceConfig | AudioSpeakerConfig | null;
    isAudioGenerating?: boolean;
    audioProgress?: {
        status: AudioGenerationStatus;
        message: string;
    };
    created_at: string;
    isStreaming?: boolean;
    isRetrying?: boolean;
}

interface Conversation {
    id: number;
    title: string;
    model_id: number;
    model_display_name: string;
    model_supports_image_generation?: boolean;
    model_supports_video_generation?: boolean;
    model_supports_audio_generation?: boolean;
    generation_type?: GenerationType;
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
    // Video settings
    video_duration: number;
    video_resolution: string;
    video_aspect_ratio: string;
    video_audio_enabled: boolean;
    video_negative_prompt: string | null;
    // Audio settings
    audio_voice_id?: AudioVoiceId;
    audio_style_prompt?: string | null;
    audio_multi_speaker?: boolean;
    audio_speaker_config?: AudioSpeakerConfig | null;
    audio_output_format?: AudioOutputFormat;
    isArchived?: boolean;
}

// LocalStorage keys
const STORAGE_KEY_TABS = "nanano_open_tabs";
const STORAGE_KEY_ACTIVE_TAB = "nanano_active_tab";
const STORAGE_KEY_PROJECT = "nanano_selected_project";

export function ChatInterface() {
    const {data: session} = useSession();
    const {theme, setTheme} = useTheme();
    const navigation = useNavigation();
    const [mounted, setMounted] = useState(false);
    const [projectModels, setProjectModels] = useState<ProjectModel[]>([]);
    const [projects, setProjects] = useState<Project[]>([]);
    const [conversations, setConversations] = useState<Conversation[]>([]);
    const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([]);
    const [showArchived, setShowArchived] = useState(false);
    const [loadingArchived, setLoadingArchived] = useState(false);

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
    const prevMessageCountRef = useRef<number>(0);
    const nextTabId = useRef(1);

    // Settings state
    const [temperature, setTemperature] = useState(1.0);
    const [topP, setTopP] = useState(0.95);
    const [topK, setTopK] = useState(40);
    const [maxOutputTokens, setMaxOutputTokens] = useState(8192);
    const [systemInstruction, setSystemInstruction] = useState("");

    // Image generation settings
    const [imageAspectRatio, setImageAspectRatio] = useState<string>("16:9");
    const [imageSize, setImageSize] = useState<string>("1K");
    const [imageNegativePrompt, setImageNegativePrompt] = useState("");

    // Video generation settings
    const [videoDuration, setVideoDuration] = useState<VideoDuration>(8);
    const [videoResolution, setVideoResolution] = useState<VideoResolution>("720p");
    const [videoAspectRatio, setVideoAspectRatio] = useState<VideoAspectRatio>("16:9");
    const [videoAudioEnabled, setVideoAudioEnabled] = useState(true);
    const [videoNegativePrompt, setVideoNegativePrompt] = useState("");

    // Video input frames
    const [videoFirstFrame, setVideoFirstFrame] = useState<string | null>(null);
    const [videoLastFrame, setVideoLastFrame] = useState<string | null>(null);
    const [videoReferenceImages, setVideoReferenceImages] = useState<ReferenceImage[]>([]);

    // Audio generation settings
    const [audioVoiceId, setAudioVoiceId] = useState<AudioVoiceId>("Kore");
    const [audioStylePrompt, setAudioStylePrompt] = useState("");
    const [audioMultiSpeaker, setAudioMultiSpeaker] = useState(false);
    const [audioSpeakerConfig, setAudioSpeakerConfig] = useState<AudioSpeakerConfig | null>(null);
    const [audioOutputFormat, setAudioOutputFormat] = useState<AudioOutputFormat>("mp3");
    const [audioQualityTier, setAudioQualityTier] = useState<"normal" | "hq" | "chirp">("normal");
    const [audioRestoreData, setAudioRestoreData] = useState<AudioRestoreData | null>(null);
    const [audioTTSEngine, setAudioTTSEngine] = useState<"gemini" | "chirp">("gemini");
    const [audioSpeakingRate, setAudioSpeakingRate] = useState(1.0);
    const [audioLocale, setAudioLocale] = useState("es-US");

    // Generation mode (for video models that can also generate images)
    const [generationMode, setGenerationMode] = useState<GenerationMode>("video");
    const [imageModelIdForGeneration, setImageModelIdForGeneration] = useState<number | null>(null);

    // Selected images from conversation (for use as attachments)
    const [selectedConversationImages, setSelectedConversationImages] = useState<string[]>([]);

    // Project system instruction
    const [useProjectSystemInstruction, setUseProjectSystemInstruction] = useState(true);

    // Calculator access
    const [hasCalculatorAccess, setHasCalculatorAccess] = useState(false);

    // Changelog
    const [pendingChangelog, setPendingChangelog] = useState<{id: number; version: string; title: string; content: string; image_url: string | null} | null>(null);

    // Usage tracking (new format with quality tiers)
    const [projectUsage, setProjectUsage] = useState<{
        text: { normal: { used: number; limit: number; unlimited: boolean }; hq: { used: number; limit: number; unlimited: boolean } };
        image: { normal: { used: number; limit: number; unlimited: boolean }; hq: { used: number; limit: number; unlimited: boolean } };
        video: { normal: { used: number; limit: number; unlimited: boolean }; hq: { used: number; limit: number; unlimited: boolean } };
        audio: { normal: { used: number; limit: number; unlimited: boolean }; hq: { used: number; limit: number; unlimited: boolean } };
    } | null>(null);

    // Project stats (for gallery count)
    const [projectStats, setProjectStats] = useState<{
        totalImages: number;
        totalVideos: number;
    } | null>(null);

    // Selected seed for next generation (reuse from previous generation)
    const [selectedSeed, setSelectedSeed] = useState<number | null>(null);
    const [seedPrompt, setSeedPrompt] = useState<string | null>(null);
    const [reusePrompt, setReusePrompt] = useState<string | null>(null);
    const [reuseImages, setReuseImages] = useState<string[]>([]);

    // Generation config per type (from project)
    interface GenerationConfigItem {
        generation_type: GenerationType;
        is_enabled: boolean;
        model_normal_id: number | null;
        model_hq_id: number | null;
        model_chirp_id: number | null;
        model_normal_name: string | null;
        model_hq_name: string | null;
        model_chirp_name: string | null;
        model_normal_model_id: string | null;
        model_hq_model_id: string | null;
        model_chirp_model_id: string | null;
    }
    const [generationConfig, setGenerationConfig] = useState<GenerationConfigItem[]>([]);

    // Quality tier selection
    const [selectedQualityTier, setSelectedQualityTier] = useState<QualityTier>("normal");

    // Generation type for new conversations
    const [newConversationType, setNewConversationType] = useState<GenerationType>("text");
    const [showNewConversationModal, setShowNewConversationModal] = useState(false);

    // Image viewer modal
    const [viewingImageMessage, setViewingImageMessage] = useState<Message | null>(null);
    const [viewingImageDimensions, setViewingImageDimensions] = useState<{ width: number; height: number } | null>(null);
    const [showTopazStudio, setShowTopazStudio] = useState(false);

    // Video viewer modal
    const [viewingVideoMessage, setViewingVideoMessage] = useState<Message | null>(null);
    const [showTopazVideoStudio, setShowTopazVideoStudio] = useState(false);

    // Get current tab's conversation and messages
    const activeTab = openTabs.find((t) => t.id === activeTabId);
    const currentConversation = activeTab ? tabConversations[activeTab.id] : null;
    const messages = activeTab ? tabMessages[activeTab.id] || [] : [];
    const isSending = activeTab ? sendingTabs[activeTab.id] || false : false;

    // Get configs for different types
    const videoTypeConfig = generationConfig.find(c => c.generation_type === "video");
    const imageTypeConfig = generationConfig.find(c => c.generation_type === "image");

    // UI mode helpers based on conversation generation_type
    // Default to text if generation_type is null/undefined (for legacy conversations)
    const isTextConversation = !currentConversation?.generation_type || currentConversation?.generation_type === "text";
    const isImageConversation = currentConversation?.generation_type === "image";
    const isVideoConversation = currentConversation?.generation_type === "video";
    const isAudioConversation = currentConversation?.generation_type === "audio" || currentConversation?.generation_type === "audio_hd";

    // Get current model based on conversation type, generation mode, and quality tier
    // For video conversations in image mode, use the image model
    const currentTypeConfig = (() => {
        if (isVideoConversation && generationMode === "image") {
            return imageTypeConfig;
        }
        return currentConversation?.generation_type
            ? generationConfig.find(c => c.generation_type === currentConversation.generation_type)
            : null;
    })();

    const currentModelInfo = currentTypeConfig
        ? (selectedQualityTier === "hq"
            ? { id: currentTypeConfig.model_hq_id, name: currentTypeConfig.model_hq_name }
            : { id: currentTypeConfig.model_normal_id, name: currentTypeConfig.model_normal_name })
        : null;

    // Check if image models are available for video conversations
    const hasImageModelsForVideo = imageTypeConfig && (imageTypeConfig.model_normal_id || imageTypeConfig.model_hq_id);

    // Check if the current image model is Imagen 4 (based on quality tier)
    const isImagen4Model = (() => {
        if (!imageTypeConfig) return false;
        const modelId = selectedQualityTier === "hq"
            ? imageTypeConfig.model_hq_model_id
            : imageTypeConfig.model_normal_model_id;
        return modelId?.includes("imagen-4") ?? false;
    })();

    // Mark component as mounted for hydration
    useEffect(() => {
        setMounted(true);
    }, []);

    // Fetch pending changelog on mount
    useEffect(() => {
        fetch("/api/changelog/latest")
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data?.changelog) setPendingChangelog(data.changelog);
            })
            .catch(() => {});
    }, []);

    // Load from localStorage on mount (only if URL has a project slug to restore)
    useEffect(() => {
        // If URL is root "/", don't auto-load from localStorage - show project selection
        if (typeof window !== 'undefined' && window.location.pathname === '/') return;

        // If URL has a project slug, that will be handled by the next effect
        if (navigation.initialState?.projectSlug) return;

        const savedProject = localStorage.getItem(STORAGE_KEY_PROJECT);
        if (savedProject) {
            setSelectedProjectId(Number(savedProject));
        }
    }, [navigation.initialState]);

    // Select project from URL slug for deep linking
    const projectFromUrlHandled = useRef(false);
    useEffect(() => {
        if (projectFromUrlHandled.current) return;
        if (!navigation.initialState?.projectSlug || projects.length === 0) return;

        // Find project with matching slug
        const urlSlug = navigation.initialState.projectSlug;
        const matchingProject = projects.find(p => generateSlug(p.title) === urlSlug);

        if (matchingProject) {
            projectFromUrlHandled.current = true;
            setSelectedProjectId(matchingProject.id);
        }
    }, [navigation.initialState, projects]);

    // Save project to localStorage
    useEffect(() => {
        if (selectedProjectId) {
            localStorage.setItem(STORAGE_KEY_PROJECT, String(selectedProjectId));
        } else {
            localStorage.removeItem(STORAGE_KEY_PROJECT);
        }
    }, [selectedProjectId]);

    // Update navigation slug when project changes
    useEffect(() => {
        if (selectedProjectId && projects.length > 0) {
            const project = projects.find(p => p.id === selectedProjectId);
            if (project) {
                const newSlug = generateSlug(project.title);
                // Only update if slug is different to avoid infinite loop
                if (navigation.projectSlug !== newSlug) {
                    navigation.setProjectSlug(newSlug);
                }
            }
        } else if (!selectedProjectId && navigation.projectSlug) {
            // Clear URL when no project is selected
            navigation.setProjectSlug(null);
        }
    }, [selectedProjectId, projects, navigation.projectSlug, navigation.setProjectSlug]);

    // Handle browser back/forward navigation for project changes
    useEffect(() => {
        const unsubscribe = navigation.onProjectChange((newSlug) => {
            if (newSlug === null) {
                // User navigated back to home
                setSelectedProjectId(null);
            } else {
                // User navigated to a project - find matching project
                const matchingProject = projects.find(p => generateSlug(p.title) === newSlug);
                if (matchingProject) {
                    setSelectedProjectId(matchingProject.id);
                }
            }
        });
        return unsubscribe;
    }, [projects, navigation.onProjectChange]);

    // Handle deep linking - open gallery or conversation based on URL
    const deepLinkHandled = useRef(false);
    useEffect(() => {
        // Only handle once per page load
        if (deepLinkHandled.current) return;
        if (!navigation.initialState || !selectedProjectId) return;

        const { type, id } = navigation.initialState;
        if (type === 'gallery' || type === 'generation' || type === 'topaz') {
            // Open gallery tab without pushing navigation (we're already at the URL)
            // Generation/topaz modals will be handled by generations-gallery
            deepLinkHandled.current = true;
            handleOpenGallery(true);
        } else if (type === 'conversation' && id && conversations.length > 0) {
            // Find and open conversation
            const conv = conversations.find(c => c.id === id);
            if (conv) {
                deepLinkHandled.current = true;
                openConversationInTab(conv, true);
            }
        }
    }, [navigation.initialState, selectedProjectId, conversations]);

    // Register navigation layer for image viewer modal
    const imageViewerLayerRegistered = useRef(false);
    useEffect(() => {
        if (viewingImageMessage && !imageViewerLayerRegistered.current) {
            // Register layer so Escape closes the image viewer, not the conversation
            navigation.registerLayer(() => {
                setViewingImageMessage(null);
                setViewingImageDimensions(null);
            });
            imageViewerLayerRegistered.current = true;
        } else if (!viewingImageMessage && imageViewerLayerRegistered.current) {
            imageViewerLayerRegistered.current = false;
        }
    }, [viewingImageMessage, navigation]);

    // Register navigation layer for video viewer modal
    const videoViewerLayerRegistered = useRef(false);
    useEffect(() => {
        if (viewingVideoMessage && !videoViewerLayerRegistered.current) {
            navigation.registerLayer(() => {
                setViewingVideoMessage(null);
                setShowTopazVideoStudio(false);
            });
            videoViewerLayerRegistered.current = true;
        } else if (!viewingVideoMessage && videoViewerLayerRegistered.current) {
            videoViewerLayerRegistered.current = false;
        }
    }, [viewingVideoMessage, navigation]);

    // Auto-select first image model when switching to image mode
    useEffect(() => {
        if (generationMode === "image" && !imageModelIdForGeneration) {
            const imageModels = projectModels.filter(m => m.supports_image_generation);
            if (imageModels.length > 0) {
                setImageModelIdForGeneration(imageModels[0].model_id);
            }
        }
    }, [generationMode, projectModels, imageModelIdForGeneration]);

    // Reset audio settings when switching to a TTS model
    useEffect(() => {
        setAudioMultiSpeaker(false);
    }, [selectedModelId]);

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

    const fetchProjectUsage = useCallback(async (projectId: number) => {
        try {
            const res = await fetch(`/api/projects/${projectId}/usage`);
            if (res.ok) {
                const data = await res.json();
                setProjectUsage(data);
            } else {
                setProjectUsage(null);
            }
        } catch (err) {
            console.error("Error fetching project usage:", err);
            setProjectUsage(null);
        }
    }, []);

    const fetchProjectStats = useCallback(async (projectId: number) => {
        try {
            const res = await fetch(`/api/projects/${projectId}/stats`);
            if (res.ok) {
                const data = await res.json();
                setProjectStats({
                    totalImages: data.totalImages || 0,
                    totalVideos: data.totalVideos || 0,
                });
            } else {
                setProjectStats(null);
            }
        } catch (err) {
            console.error("Error fetching project stats:", err);
            setProjectStats(null);
        }
    }, []);

    const fetchGenerationConfig = useCallback(async (projectId: number) => {
        try {
            const res = await fetch(`/api/projects/${projectId}/generation-config`);
            if (res.ok) {
                const data = await res.json();
                // Transform object response to array format
                const types: ("text" | "image" | "video" | "audio")[] = ["text", "image", "video", "audio"];
                const configArray: GenerationConfigItem[] = types.map((type) => ({
                    generation_type: type as GenerationType,
                    is_enabled: data[type]?.enabled ?? false,
                    model_normal_id: data[type]?.model_normal?.id ?? null,
                    model_hq_id: data[type]?.model_hq?.id ?? null,
                    model_chirp_id: data[type]?.model_chirp?.id ?? null,
                    model_normal_name: data[type]?.model_normal?.display_name ?? null,
                    model_hq_name: data[type]?.model_hq?.display_name ?? null,
                    model_chirp_name: data[type]?.model_chirp?.display_name ?? null,
                    model_normal_model_id: data[type]?.model_normal?.model_id ?? null,
                    model_hq_model_id: data[type]?.model_hq?.model_id ?? null,
                    model_chirp_model_id: data[type]?.model_chirp?.model_id ?? null,
                }));

                // If audio has a chirp model configured, add "audio_hd" as a virtual generation type
                const audioConfig = data["audio"];
                if (audioConfig?.model_chirp?.id) {
                    configArray.push({
                        generation_type: "audio_hd",
                        is_enabled: audioConfig.enabled ?? false,
                        model_normal_id: audioConfig.model_chirp.id,
                        model_hq_id: audioConfig.model_chirp.id,
                        model_chirp_id: audioConfig.model_chirp.id,
                        model_normal_name: audioConfig.model_chirp.display_name,
                        model_hq_name: audioConfig.model_chirp.display_name,
                        model_chirp_name: audioConfig.model_chirp.display_name,
                        model_normal_model_id: audioConfig.model_chirp.model_id,
                        model_hq_model_id: audioConfig.model_chirp.model_id,
                        model_chirp_model_id: audioConfig.model_chirp.model_id,
                    });
                }

                setGenerationConfig(configArray);
                // Auto-select first enabled type
                const firstEnabled = configArray.find((c) => c.is_enabled);
                if (firstEnabled) {
                    setNewConversationType(firstEnabled.generation_type);
                }
            } else {
                setGenerationConfig([]);
            }
        } catch (err) {
            console.error("Error fetching generation config:", err);
            setGenerationConfig([]);
        }
    }, []);

    const fetchConversations = useCallback(async () => {
        // Solo cargar conversaciones si hay un proyecto seleccionado
        if (!selectedProjectId) {
            setConversations([]);
            setLoadingConversations(false);
            return;
        }

        try {
            const res = await fetch(`/api/conversations?project_id=${selectedProjectId}`);
            if (res.ok) {
                const data = await res.json();
                // Map audio conversations with chirp engine to audio_hd type for UI
                const mapped = data.map((conv: Record<string, unknown>) =>
                    conv.generation_type === "audio" && conv.audio_tts_engine === "chirp"
                        ? { ...conv, generation_type: "audio_hd" }
                        : conv
                );
                setConversations(mapped);
            }
        } catch (err) {
            console.error("Error fetching conversations:", err);
        } finally {
            setLoadingConversations(false);
        }
    }, [selectedProjectId]);

    const fetchMessagesForTab = async (tabId: number, conversationId: number, isArchived?: boolean) => {
        try {
            const url = isArchived
                ? `/api/conversations/${conversationId}?archived=true`
                : `/api/conversations/${conversationId}`;
            const res = await fetch(url);
            if (res.ok) {
                const data = await res.json();
                setTabMessages((prev) => ({...prev, [tabId]: data.messages || []}));
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
                        generation_type: data.generation_type === "audio" && data.audio_tts_engine === "chirp" ? "audio_hd" : data.generation_type,
                        image_aspect_ratio: data.image_aspect_ratio || "16:9",
                        image_size: data.image_size || "1K",
                        model_supports_image_generation: data.model_supports_image_generation,
                        model_supports_video_generation: data.model_supports_video_generation,
                        video_duration: data.video_duration || 8,
                        video_resolution: data.video_resolution || "720p",
                        video_aspect_ratio: data.video_aspect_ratio || "16:9",
                        video_audio_enabled: data.video_audio_enabled !== false,
                        video_negative_prompt: data.video_negative_prompt || null,
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
                    setImageAspectRatio(data.image_aspect_ratio || "16:9");
                    setImageSize(data.image_size || "1K");
                    // Video settings
                    setVideoDuration(data.video_duration || 8);
                    setVideoResolution(data.video_resolution || "720p");
                    setVideoAspectRatio(data.video_aspect_ratio || "16:9");
                    setVideoAudioEnabled(data.video_audio_enabled !== false);
                    setVideoNegativePrompt(data.video_negative_prompt || "");
                }
            }
        } catch (err) {
            console.error("Error fetching messages:", err);
        }
    };

    useEffect(() => {
        fetchProjects();
    }, [fetchProjects]);

    // Check calculator access
    useEffect(() => {
        const checkCalculatorAccess = async () => {
            try {
                const res = await fetch("/api/me/calculator-access");
                if (res.ok) {
                    const data = await res.json();
                    setHasCalculatorAccess(data.hasAccess);
                }
            } catch (err) {
                console.error("Error checking calculator access:", err);
            }
        };
        checkCalculatorAccess();
    }, []);

    // Select project from URL slug (takes precedence over localStorage for deep linking)
    useEffect(() => {
        if (projects.length > 0 && navigation.projectSlug) {
            // Find project that matches the URL slug
            const matchingProject = projects.find(p =>
                generateSlug(p.title) === navigation.projectSlug
            );
            if (matchingProject && matchingProject.id !== selectedProjectId) {
                setSelectedProjectId(matchingProject.id);
            }
        }
    }, [projects, navigation.projectSlug]);

    useEffect(() => {
        if (selectedProjectId) {
            fetchProjectModels(selectedProjectId);
            fetchProjectUsage(selectedProjectId);
            fetchProjectStats(selectedProjectId);
            fetchGenerationConfig(selectedProjectId);
            // Clear tabs when changing project
            setOpenTabs([]);
            setActiveTabId(null);
            setTabMessages({});
            setTabConversations({});
            // Clear archived conversations
            setArchivedConversations([]);
            setShowArchived(false);
            // Reset quality tier
            setSelectedQualityTier("normal");
        } else {
            setProjectModels([]);
            setSelectedModelId(null);
            setArchivedConversations([]);
            setShowArchived(false);
            setProjectUsage(null);
            setProjectStats(null);
            setGenerationConfig([]);
        }
    }, [selectedProjectId, fetchProjectModels, fetchProjectUsage, fetchProjectStats, fetchGenerationConfig]);

    useEffect(() => {
        fetchConversations();
    }, [fetchConversations]);

    // Only scroll to bottom when new messages are added, not when existing messages are updated
    useEffect(() => {
        const currentCount = messages.length;
        if (currentCount > prevMessageCountRef.current) {
            messagesEndRef.current?.scrollIntoView({behavior: "smooth"});
        }
        prevMessageCountRef.current = currentCount;
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
            setImageAspectRatio(conv.image_aspect_ratio || "16:9");
            setImageSize(conv.image_size || "1K");
            // Video settings
            setVideoDuration((conv.video_duration || 8) as VideoDuration);
            setVideoResolution((conv.video_resolution || "720p") as VideoResolution);
            setVideoAspectRatio((conv.video_aspect_ratio || "16:9") as VideoAspectRatio);
            setVideoAudioEnabled(conv.video_audio_enabled !== false);
            setVideoNegativePrompt(conv.video_negative_prompt || "");
            // Clear video frames when switching tabs
            setVideoFirstFrame(null);
            setVideoLastFrame(null);
            setVideoReferenceImages([]);
            // Reset generation mode and selected images when switching tabs
            setGenerationMode("video");
            setSelectedConversationImages([]);
            // Set engine based on conversation type
            if (conv.generation_type === "audio_hd") {
                setAudioTTSEngine("chirp");
                setAudioMultiSpeaker(false);
            } else if (conv.generation_type === "audio") {
                setAudioTTSEngine("gemini");
            }
            // Auto-select quality tier based on available models
            const typeConf = generationConfig.find(c => c.generation_type === conv.generation_type);
            if (typeConf) {
                if (typeConf.model_normal_id) {
                    setSelectedQualityTier("normal");
                } else if (typeConf.model_hq_id) {
                    setSelectedQualityTier("hq");
                }
            }
        }
    }, [activeTabId, tabConversations, generationConfig]);

    // Auto-set duration to 8 seconds when reference images are added (API requirement)
    useEffect(() => {
        if (videoReferenceImages.length > 0 && videoDuration !== 8) {
            setVideoDuration(8);
        }
    }, [videoReferenceImages.length, videoDuration]);

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
            video_duration?: number;
            video_resolution?: string;
            video_aspect_ratio?: string;
            video_audio_enabled?: boolean;
            video_negative_prompt?: string;
        }
    ) => {
        try {
            const res = await fetch(`/api/conversations/${conversationId}`, {
                method: "PUT",
                headers: {"Content-Type": "application/json"},
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
                            [tabId]: {...prev[Number(tabId)], ...settings},
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
        const newModel = projectModels.find(m => m.model_id === newModelId);

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
                // Crear nueva conversación con el nuevo modelo (pasar directamente)
                handleNewTab(newModelId);
            }
            // Si no confirma, no hacer nada (mantener modelo actual)
        } else {
            // Sin mensajes, permitir cambio directo
            setSelectedModelId(newModelId);

            // Si es una conversación draft (no guardada en BD), solo actualizar el estado local
            if (activeTab?.isDraft || currentConversation.id === 0) {
                setTabConversations(prev => ({
                    ...prev,
                    [activeTabId!]: {
                        ...prev[activeTabId!],
                        model_id: newModelId,
                        model_display_name: newModel?.model_display_name || "",
                        model_supports_image_generation: newModel?.supports_image_generation,
                        model_supports_video_generation: newModel?.supports_video_generation,
                    }
                }));
            } else {
                // Conversación existente en BD, actualizar
                await updateConversationSettings(currentConversation.id, {model_id: newModelId});
            }
        }
    };

    // Manejar cambios de settings (excepto modelo)
    const handleSettingChange = async (
        setting: "system_instruction" | "temperature" | "top_p" | "top_k" | "max_output_tokens" | "image_aspect_ratio" | "image_size" | "video_duration" | "video_resolution" | "video_aspect_ratio" | "video_audio_enabled" | "video_negative_prompt" | "audio_voice_id" | "audio_style_prompt" | "audio_multi_speaker" | "audio_speaker_config" | "audio_output_format" | "audio_tts_engine" | "audio_speaking_rate" | "audio_locale",
        value: string | number | boolean | AudioSpeakerConfig | null
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
            case "video_duration":
                setVideoDuration(value as VideoDuration);
                break;
            case "video_resolution":
                setVideoResolution(value as VideoResolution);
                break;
            case "video_aspect_ratio":
                setVideoAspectRatio(value as VideoAspectRatio);
                break;
            case "video_audio_enabled":
                setVideoAudioEnabled(value as boolean);
                break;
            case "video_negative_prompt":
                setVideoNegativePrompt(value as string);
                break;
            case "audio_voice_id":
                setAudioVoiceId(value as AudioVoiceId);
                break;
            case "audio_style_prompt":
                setAudioStylePrompt(value as string);
                break;
            case "audio_multi_speaker":
                setAudioMultiSpeaker(value as boolean);
                break;
            case "audio_speaker_config":
                setAudioSpeakerConfig(value as AudioSpeakerConfig | null);
                break;
            case "audio_output_format":
                setAudioOutputFormat(value as AudioOutputFormat);
                break;
            case "audio_tts_engine":
                setAudioTTSEngine(value as "gemini" | "chirp");
                break;
            case "audio_speaking_rate":
                setAudioSpeakingRate(value as number);
                break;
            case "audio_locale":
                setAudioLocale(value as string);
                break;
        }

        // Si hay conversación activa, guardar en DB
        if (currentConversation) {
            await updateConversationSettings(currentConversation.id, {[setting]: value});
        }
    };

    const createNewConversation = async (overrideModelId?: number, generationType?: GenerationType): Promise<Conversation | null> => {
        const modelIdToUse = overrideModelId || selectedModelId;
        if (!selectedProjectId) return null;
        // For the new system, generation_type determines the model, so modelId might be optional
        const typeToUse = generationType || newConversationType;
        // audio_hd is a virtual type — map to "audio" + chirp engine for the API
        const apiGenerationType = typeToUse === "audio_hd" ? "audio" : typeToUse;
        const isCreatingAudioHD = typeToUse === "audio_hd";

        const modelForConversation = modelIdToUse
            ? projectModels.find((m) => m.model_id === modelIdToUse)
            : null;

        try {
            const res = await fetch("/api/conversations", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    model_id: modelIdToUse, // Can be null, API will use generation_config
                    project_id: selectedProjectId,
                    generation_type: apiGenerationType,
                    quality_tier: isCreatingAudioHD ? "chirp" : selectedQualityTier,
                    temperature,
                    top_p: topP,
                    top_k: topK,
                    max_output_tokens: maxOutputTokens,
                    system_instruction: systemInstruction || null,
                    image_aspect_ratio: imageAspectRatio,
                    image_size: imageSize,
                    video_duration: videoDuration,
                    video_resolution: videoResolution,
                    video_aspect_ratio: videoAspectRatio,
                    video_audio_enabled: videoAudioEnabled,
                    video_negative_prompt: videoNegativePrompt || null,
                    audio_voice_id: audioVoiceId,
                    audio_style_prompt: audioStylePrompt || null,
                    audio_multi_speaker: isCreatingAudioHD ? false : audioMultiSpeaker,
                    audio_speaker_config: isCreatingAudioHD ? null : audioSpeakerConfig,
                    audio_output_format: audioOutputFormat,
                    ...(isCreatingAudioHD && {
                        audio_tts_engine: "chirp",
                        audio_speaking_rate: audioSpeakingRate,
                        audio_locale: audioLocale,
                    }),
                }),
            });

            if (res.ok) {
                const data = await res.json();
                fetchConversations();
                // Use model info from API response (which resolves from generation_config)
                const resolvedModelId = data.model_id || modelIdToUse;
                const resolvedModel = projectModels.find((m) => m.model_id === resolvedModelId);
                const newConversation: Conversation = {
                    id: data.id,
                    title: data.title,
                    model_id: resolvedModelId,
                    model_display_name: data.model_display_name || resolvedModel?.model_display_name || "",
                    model_supports_image_generation: resolvedModel?.supports_image_generation,
                    model_supports_video_generation: resolvedModel?.supports_video_generation,
                    model_supports_audio_generation: resolvedModel?.supports_audio_generation,
                    generation_type: isCreatingAudioHD ? "audio_hd" : (data.generation_type || typeToUse),
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
                    video_duration: videoDuration,
                    video_resolution: videoResolution,
                    video_aspect_ratio: videoAspectRatio,
                    video_audio_enabled: videoAudioEnabled,
                    video_negative_prompt: videoNegativePrompt,
                    audio_voice_id: audioVoiceId,
                    audio_style_prompt: audioStylePrompt,
                    audio_multi_speaker: audioMultiSpeaker,
                    audio_speaker_config: audioSpeakerConfig,
                    audio_output_format: audioOutputFormat,
                };
                return newConversation;
            }
        } catch (err) {
            console.error("Error creating conversation:", err);
        }
        return null;
    };

    const openConversationInTab = (conversation: Conversation, skipNavigation = false) => {
        // Check if already open
        const existingTab = openTabs.find((t) => t.conversationId === conversation.id);
        if (existingTab) {
            setActiveTabId(existingTab.id);
            if (skipNavigation) {
                navigation.registerLayer(() => handleTabClose(existingTab.id, true));
            } else {
                navigation.openConversation(conversation.id, () => handleTabClose(existingTab.id, true));
            }
            return;
        }

        // Create new tab
        const tabId = nextTabId.current++;
        const newTab: Tab = {
            id: tabId,
            conversationId: conversation.id,
            title: conversation.title,
            isLoading: true,
            isArchived: conversation.isArchived,
        };

        setOpenTabs((prev) => [...prev, newTab]);
        setTabConversations((prev) => ({...prev, [tabId]: conversation}));
        setActiveTabId(tabId);

        // Push navigation
        if (skipNavigation) {
            navigation.registerLayer(() => handleTabClose(tabId, true));
        } else {
            navigation.openConversation(conversation.id, () => handleTabClose(tabId, true));
        }

        // Fetch messages
        fetchMessagesForTab(tabId, conversation.id, conversation.isArchived).then(() => {
            setOpenTabs((prev) =>
                prev.map((t) => (t.id === tabId ? {...t, isLoading: false} : t))
            );
        });
    };

    const handleNewTab = async (overrideModelId?: number, overrideType?: GenerationType) => {
        if (!selectedProjectId) return;

        const effectiveType = overrideType || newConversationType;

        // Get model from generation config for the selected type
        const typeConfig = generationConfig.find(c => c.generation_type === effectiveType && c.is_enabled);
        if (!typeConfig && !overrideModelId) {
            console.error("No hay configuración habilitada para el tipo:", effectiveType);
            return;
        }

        // Use override, or normal model, or HQ model as fallback
        const modelIdToUse = overrideModelId || typeConfig?.model_normal_id || typeConfig?.model_hq_id;
        if (!modelIdToUse) {
            console.error("No hay modelo configurado para el tipo:", effectiveType);
            return;
        }

        const modelName = typeConfig?.model_normal_name || typeConfig?.model_hq_name || "";

        const tabId = nextTabId.current++;
        const draftTab: Tab = {
            id: tabId,
            conversationId: 0, // Sin conversación real aún
            title: "Nueva conversación",
            isLoading: false,
            isDraft: true,
        };

        // Reset or force engine based on conversation type
        const isAudioHD = effectiveType === "audio_hd";
        if (isAudioHD) {
            setAudioTTSEngine("chirp");
            setAudioMultiSpeaker(false);
        } else {
            setAudioTTSEngine("gemini");
        }

        // Crear conversación draft en memoria (sin guardar en BD)
        const draftConversation: Conversation = {
            id: 0, // ID temporal
            title: "Nueva conversación",
            model_id: modelIdToUse,
            model_display_name: modelName,
            model_supports_image_generation: effectiveType === "image",
            model_supports_video_generation: effectiveType === "video",
            generation_type: effectiveType,
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
            video_duration: videoDuration,
            video_resolution: videoResolution,
            video_aspect_ratio: videoAspectRatio,
            video_audio_enabled: videoAudioEnabled,
            video_negative_prompt: videoNegativePrompt,
        };

        setOpenTabs((prev) => [...prev, draftTab]);
        setTabConversations((prev) => ({...prev, [tabId]: draftConversation}));
        setTabMessages((prev) => ({...prev, [tabId]: []}));
        setActiveTabId(tabId);

        // Actualizar el modelo seleccionado si se usó un override
        if (overrideModelId) {
            setSelectedModelId(overrideModelId);
        }
    };

    const handleOpenGallery = (skipNavigation = false) => {
        // Check if gallery tab already exists
        const existingGalleryTab = openTabs.find((t) => t.isGallery);
        if (existingGalleryTab) {
            setActiveTabId(existingGalleryTab.id);
            if (skipNavigation) {
                // Deep linking: register layer without pushing (URL already correct)
                navigation.registerLayer(() => handleTabClose(existingGalleryTab.id, true));
            } else {
                // Normal open: push navigation state
                navigation.openGallery(() => handleTabClose(existingGalleryTab.id, true));
            }
            return;
        }

        // Create gallery tab
        const tabId = nextTabId.current++;
        const newTab: Tab = {
            id: tabId,
            conversationId: 0, // No conversation
            title: "Generaciones",
            isLoading: false,
            isGallery: true,
        };

        setOpenTabs((prev) => [...prev, newTab]);
        setActiveTabId(tabId);

        if (skipNavigation) {
            // Deep linking: register layer without pushing (URL already correct)
            navigation.registerLayer(() => handleTabClose(tabId, true));
        } else {
            // Normal open: push navigation state
            navigation.openGallery(() => handleTabClose(tabId, true));
        }
    };

    const handleOpenConversationFromGallery = (conversationId: number) => {
        // Find the conversation in the list
        const conv = conversations.find((c) => c.id === conversationId);
        if (conv) {
            openConversationInTab(conv);
        } else {
            // If not in current list (might be archived), fetch and open
            fetch(`/api/conversations/${conversationId}?archived=true`)
                .then((res) => res.json())
                .then((data) => {
                    if (data.id) {
                        const conversation: Conversation = {
                            id: data.id,
                            title: data.title,
                            model_id: data.model_id,
                            model_display_name: data.model_display_name || "",
                            project_id: data.project_id,
                            project_title: data.project_title,
                            last_message: null,
                            message_count: 0,
                            updated_at: data.updated_at,
                            temperature: data.temperature,
                            top_p: data.top_p,
                            top_k: data.top_k,
                            max_output_tokens: data.max_output_tokens,
                            system_instruction: data.system_instruction,
                            image_aspect_ratio: data.image_aspect_ratio || "16:9",
                            image_size: data.image_size || "1K",
                            video_duration: data.video_duration || 8,
                            video_resolution: data.video_resolution || "720p",
                            video_aspect_ratio: data.video_aspect_ratio || "16:9",
                            video_audio_enabled: data.video_audio_enabled !== false,
                            video_negative_prompt: data.video_negative_prompt || null,
                            isArchived: data.deleted_at !== null,
                        };
                        openConversationInTab(conversation);
                    }
                })
                .catch((err) => console.error("Error opening conversation:", err));
        }
    };

    const handleTabClose = (tabId: number, fromNavigation = false) => {
        const tabIndex = openTabs.findIndex((t) => t.id === tabId);
        const closingTab = openTabs.find((t) => t.id === tabId);
        setOpenTabs((prev) => prev.filter((t) => t.id !== tabId));

        // Clean up state
        setTabMessages((prev) => {
            const newState = {...prev};
            delete newState[tabId];
            return newState;
        });
        setTabConversations((prev) => {
            const newState = {...prev};
            delete newState[tabId];
            return newState;
        });
        setSendingTabs((prev) => {
            const newState = {...prev};
            delete newState[tabId];
            return newState;
        });

        // Switch to adjacent tab if closing active
        if (activeTabId === tabId) {
            const remainingTabs = openTabs.filter((t) => t.id !== tabId);
            if (remainingTabs.length > 0) {
                const newActiveIndex = Math.min(tabIndex, remainingTabs.length - 1);
                const newActiveTab = remainingTabs[newActiveIndex];
                setActiveTabId(newActiveTab.id);

                // Update URL to reflect new active tab (only if not from navigation back)
                if (!fromNavigation && navigation.projectSlug) {
                    if (newActiveTab.isGallery) {
                        navigation.replace(`/${navigation.projectSlug}/gallery`);
                    } else if (newActiveTab.conversationId) {
                        navigation.replace(`/${navigation.projectSlug}/conversation/${newActiveTab.conversationId}`);
                    } else {
                        navigation.replace(`/${navigation.projectSlug}`);
                    }
                }
            } else {
                setActiveTabId(null);
                // No tabs left, go back to project base URL
                if (!fromNavigation && navigation.projectSlug) {
                    navigation.replace(`/${navigation.projectSlug}`);
                }
            }
        }
    };

    const archiveConversation = async (id: number, e: React.MouseEvent) => {
        e.stopPropagation();
        try {
            const res = await fetch(`/api/conversations/${id}`, {method: "DELETE"});
            if (res.ok) {
                // Close tab if open
                const tabToClose = openTabs.find((t) => t.conversationId === id);
                if (tabToClose) {
                    handleTabClose(tabToClose.id);
                }
                fetchConversations();
                // Refrescar archivadas si están visibles
                if (showArchived) {
                    fetchArchivedConversations();
                }
            }
        } catch (err) {
            console.error("Error archiving conversation:", err);
        }
    };

    const fetchArchivedConversations = async () => {
        if (!selectedProjectId) return;
        setLoadingArchived(true);
        try {
            const res = await fetch(`/api/conversations?project_id=${selectedProjectId}&archived=true`);
            if (res.ok) {
                const data = await res.json();
                setArchivedConversations(data);
            }
        } catch (err) {
            console.error("Error fetching archived conversations:", err);
        } finally {
            setLoadingArchived(false);
        }
    };

    const sendMessage = async (
        content: string,
        files?: AttachedFile[],
        modelIdOverride?: number | null,
        imageSettings?: { aspectRatio: string; size: string; negativePrompt?: string; isImagen4?: boolean; seed?: number },
        generationTypeOverride?: "text" | "image" | "video" | "audio",
        noContext?: boolean
    ) => {
        if (!activeTabId || (!content.trim() && (!files || files.length === 0))) return;

        let tabId = activeTabId;
        const currentTab = openTabs.find(t => t.id === tabId);
        let conversationId = tabConversations[tabId]?.id;

        // Si es un tab draft, crear la conversación real en BD
        if (currentTab?.isDraft || !conversationId) {
            const draftConv = tabConversations[tabId];
            // Usar configuración del draft si existe
            const newConv = await createNewConversation(draftConv?.model_id);
            if (!newConv) return;
            conversationId = newConv.id;
            setTabConversations((prev) => ({...prev, [tabId]: newConv}));
            setOpenTabs((prev) =>
                prev.map((t) =>
                    t.id === tabId ? {...t, conversationId: newConv.id, title: newConv.title, isDraft: false} : t
                )
            );
        }

        setSendingTabs((prev) => ({...prev, [tabId]: true}));

        // Determinar tipo de contenido
        const hasFiles = files && files.length > 0;
        const firstImage = files?.find(f => f.type === "image");

        // Add optimistic user message
        const imageFiles = files?.filter(f => f.type === "image") || [];
        const tempUserMessage: Message = {
            id: Date.now(),
            role: "user",
            content,
            content_type: hasFiles ? "mixed" : "text",
            image_url: firstImage?.dataUrl, // Mostrar primera imagen como preview
            images: imageFiles.length > 0 ? imageFiles.map(f => ({ url: f.dataUrl, mime_type: f.mimeType })) : undefined,
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
            // Preparar archivos para enviar
            const filesToSend = files?.map(f => ({
                dataUrl: f.dataUrl,
                mimeType: f.mimeType,
                name: f.name,
                type: f.type,
            }));

            // Determine which endpoint to use based on model type
            const useImagenEndpoint = imageSettings?.isImagen4 === true;
            const endpoint = useImagenEndpoint
                ? `/api/conversations/${conversationId}/messages/imagen`
                : `/api/conversations/${conversationId}/messages/stream`;

            // Build request body based on endpoint
            const requestBody = useImagenEndpoint
                ? {
                    content,
                    quality_tier: selectedQualityTier,
                    imageSettings: {
                        aspectRatio: imageSettings?.aspectRatio,
                        resolution: imageSettings?.size,
                        negativePrompt: imageSettings?.negativePrompt,
                        seed: imageSettings?.seed,
                    },
                    ...(generationTypeOverride && { generation_type_override: generationTypeOverride }),
                }
                : {
                    content,
                    files: filesToSend,
                    useProjectSystemInstruction,
                    quality_tier: selectedQualityTier,
                    ...(modelIdOverride && { modelIdOverride }),
                    ...(imageSettings && { imageSettings: { aspectRatio: imageSettings.aspectRatio, size: imageSettings.size } }),
                    ...(generationTypeOverride && { generation_type_override: generationTypeOverride }),
                    ...(noContext && { no_context: noContext }),
                };

            const response = await fetch(endpoint, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify(requestBody),
            });

            if (!response.ok) {
                // Leer el error real del backend en vez de descartarlo
                let errorMessage = "";
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || "";
                } catch {
                    // Respuesta no-JSON (ej: página 413 de nginx)
                }
                if (!errorMessage) {
                    if (response.status === 413) {
                        errorMessage = "El contenido enviado es demasiado grande. Intenta con imágenes más pequeñas.";
                    } else if (response.status === 429) {
                        errorMessage = "Demasiadas solicitudes. Espera un momento e intenta de nuevo.";
                    } else {
                        errorMessage = `Error del servidor (${response.status})`;
                    }
                }
                // Mostrar error en el mensaje streaming en vez de descartarlo silenciosamente
                setTabMessages((prev) => ({
                    ...prev,
                    [tabId]: prev[tabId].map((m) =>
                        m.id === streamingMessageId
                            ? { ...m, content: `Error: ${errorMessage}`, content_type: "error" as const, isStreaming: false }
                            : m
                    ),
                }));
                setSendingTabs((prev) => ({...prev, [tabId]: false}));
                return;
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let fullContent = "";
            let realUserMessageId: number | null = null;
            let realModelMessageId: number | null = null;
            // Multi-image support: track temporary image message IDs
            const tempImageMessageIds: number[] = [];

            if (reader) {
                let sseBuffer = "";
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;

                    sseBuffer += decoder.decode(value, { stream: true });
                    const lines = sseBuffer.split("\n");
                    // Mantener la última línea incompleta en el buffer
                    sseBuffer = lines.pop() || "";

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
                                                m.id === tempUserMessage.id ? {...m, id: realUserMessageId!} : m
                                            ),
                                        }));
                                    } else if (data.type === "retry") {
                                        // Mostrar mensaje de reintento al usuario
                                        const retryMessage = `⏳ Reintentando (${data.attempt}/${data.maxAttempts})... Esperando ${data.delaySeconds}s`;
                                        setTabMessages((prev) => ({
                                            ...prev,
                                            [tabId]: prev[tabId].map((m) =>
                                                m.id === streamingMessageId
                                                    ? {...m, content: retryMessage, isRetrying: true}
                                                    : m
                                            ),
                                        }));
                                    } else if (data.type === "chunk") {
                                        fullContent += data.text;
                                        // Update streaming message (limpiar estado de retry)
                                        setTabMessages((prev) => ({
                                            ...prev,
                                            [tabId]: prev[tabId].map((m) =>
                                                m.id === streamingMessageId
                                                    ? {...m, content: fullContent, isRetrying: false}
                                                    : m
                                            ),
                                        }));
                                    } else if (data.type === "image") {
                                        // Cada imagen genera un mensaje visual separado
                                        const tempImgId = Date.now() + 100 + (data.imageIndex || tempImageMessageIds.length);
                                        tempImageMessageIds.push(tempImgId);
                                        const imgMessage: Message = {
                                            id: tempImgId,
                                            role: "model",
                                            content: "",
                                            content_type: "image",
                                            image_url: data.imageUrl,
                                            created_at: new Date().toISOString(),
                                            isStreaming: true,
                                        };
                                        setTabMessages((prev) => ({
                                            ...prev,
                                            [tabId]: [...prev[tabId], imgMessage],
                                        }));
                                    } else if (data.type === "complete") {
                                        realModelMessageId = data.id;
                                        const imageMessagesFromServer: Array<{ id: number; imageUrl: string }> = data.imageMessages || [];

                                        setTabMessages((prev) => {
                                            let msgs = prev[tabId];

                                            // Si hay imágenes con IDs reales del server, actualizar los temporales
                                            if (imageMessagesFromServer.length > 0) {
                                                for (let i = 0; i < imageMessagesFromServer.length; i++) {
                                                    const serverImg = imageMessagesFromServer[i];
                                                    const tempId = tempImageMessageIds[i];
                                                    if (tempId) {
                                                        msgs = msgs.map((m) =>
                                                            m.id === tempId
                                                                ? { ...m, id: serverImg.id, image_url: serverImg.imageUrl, isStreaming: false }
                                                                : m
                                                        );
                                                    } else {
                                                        // Imagen que no llegó por SSE (fallback onComplete), agregar
                                                        msgs = [...msgs, {
                                                            id: serverImg.id,
                                                            role: "model" as const,
                                                            content: "",
                                                            content_type: "image" as const,
                                                            image_url: serverImg.imageUrl,
                                                            created_at: new Date().toISOString(),
                                                            isStreaming: false,
                                                        }];
                                                    }
                                                }
                                            }

                                            // Finalizar el mensaje de texto (streaming placeholder)
                                            if (fullContent) {
                                                // Hay texto: actualizar el streaming message con contenido y ID real
                                                msgs = msgs.map((m) =>
                                                    m.id === streamingMessageId
                                                        ? {
                                                            ...m,
                                                            id: realModelMessageId!,
                                                            content: fullContent,
                                                            isStreaming: false,
                                                        }
                                                        : m
                                                );
                                            } else if (imageMessagesFromServer.length > 0) {
                                                // Solo imágenes, sin texto: eliminar el placeholder de streaming
                                                msgs = msgs.filter((m) => m.id !== streamingMessageId);
                                            } else {
                                                // Sin texto ni imágenes (edge case): finalizar con contenido vacío
                                                const finalImageUrl = data.imageUrl || null;
                                                msgs = msgs.map((m) =>
                                                    m.id === streamingMessageId
                                                        ? {
                                                            ...m,
                                                            id: realModelMessageId!,
                                                            content: fullContent,
                                                            image_url: finalImageUrl,
                                                            isStreaming: false,
                                                        }
                                                        : m
                                                );
                                            }

                                            return { ...prev, [tabId]: msgs };
                                        });
                                    } else if (data.type === "title") {
                                        // Actualizar título de la conversación
                                        const newTitle = data.title;
                                        setOpenTabs((prev) =>
                                            prev.map((t) =>
                                                t.id === tabId ? {...t, title: newTitle} : t
                                            )
                                        );
                                        setTabConversations((prev) => ({
                                            ...prev,
                                            [tabId]: {...prev[tabId], title: newTitle},
                                        }));
                                        // También actualizar la lista de conversaciones del sidebar
                                        setConversations((prev) =>
                                            prev.map((c) =>
                                                c.id === conversationId ? {...c, title: newTitle} : c
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

            // Si el stream terminó sin evento complete ni error, finalizar el mensaje
            if (!realModelMessageId) {
                setTabMessages((prev) => ({
                    ...prev,
                    [tabId]: prev[tabId].map((m) =>
                        m.id === streamingMessageId
                            ? {
                                ...m,
                                content: fullContent || "Error: La respuesta se interrumpió inesperadamente",
                                content_type: fullContent ? m.content_type : "error" as const,
                                isStreaming: false,
                            }
                            : m
                    ),
                }));
            }

            fetchConversations();
            // Actualizar contador de uso y stats
            if (selectedProjectId) {
                fetchProjectUsage(selectedProjectId);
                fetchProjectStats(selectedProjectId);
            }
        } catch (err) {
            console.error("Error sending message:", err);
            const isNetworkError = err instanceof TypeError || (err instanceof Error && /network|fetch|abort/i.test(err.message));
            const errorMsg = isNetworkError
                ? "Error de conexión. La generación puede haber tardado demasiado. Por favor intenta de nuevo."
                : `Error: ${err instanceof Error ? err.message : "Error inesperado al enviar mensaje"}`;
            setTabMessages((prev) => ({
                ...prev,
                [tabId]: prev[tabId].map((m) =>
                    m.id === streamingMessageId
                        ? {
                            ...m,
                            content: errorMsg,
                            content_type: "error" as const,
                            isStreaming: false,
                        }
                        : m
                ),
            }));
        } finally {
            setSendingTabs((prev) => ({...prev, [tabId]: false}));
        }
    };

    // Handle image selection from conversation
    const handleConversationImageSelect = (imageUrl: string) => {
        setSelectedConversationImages((prev) => {
            const isSelected = prev.includes(imageUrl);
            if (isSelected) {
                // Deselect
                return prev.filter((url) => url !== imageUrl);
            } else {
                // Select - and auto-switch to image mode if on video conversation
                if (isVideoConversation && generationMode === "video") {
                    setGenerationMode("image");
                }
                return [...prev, imageUrl];
            }
        });
    };

    // Toggle favorite status for a message
    const handleToggleFavorite = async (messageId: number) => {
        if (!activeTabId) return;
        try {
            const res = await fetch(`/api/messages/${messageId}/favorite`, { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                setTabMessages((prev) => ({
                    ...prev,
                    [activeTabId]: prev[activeTabId].map((msg) =>
                        msg.id === messageId ? { ...msg, is_favorite: data.is_favorite } : msg
                    ),
                }));
            }
        } catch (err) {
            console.error("Error toggling favorite:", err);
        }
    };

    // Toggle ignore_in_context status for a message
    const handleToggleIgnoreContext = async (messageId: number) => {
        if (!activeTabId) return;
        try {
            const res = await fetch(`/api/messages/${messageId}/ignore-context`, { method: "POST" });
            if (res.ok) {
                const data = await res.json();
                setTabMessages((prev) => ({
                    ...prev,
                    [activeTabId]: prev[activeTabId].map((msg) =>
                        msg.id === messageId ? { ...msg, ignore_in_context: data.ignore_in_context } : msg
                    ),
                }));
            }
        } catch (err) {
            console.error("Error toggling ignore_in_context:", err);
        }
    };

    // Send video generation message
    const sendVideoMessage = async (content: string, seed?: number) => {
        if (!activeTabId || !content.trim()) return;

        let tabId = activeTabId;
        const currentTab = openTabs.find(t => t.id === tabId);
        let conversationId = tabConversations[tabId]?.id;

        // Si es un tab draft, crear la conversación real en BD
        if (currentTab?.isDraft || !conversationId) {
            const draftConv = tabConversations[tabId];
            const newConv = await createNewConversation(draftConv?.model_id);
            if (!newConv) return;
            conversationId = newConv.id;
            setTabConversations((prev) => ({...prev, [tabId]: newConv}));
            setOpenTabs((prev) =>
                prev.map((t) =>
                    t.id === tabId ? {...t, conversationId: newConv.id, title: newConv.title, isDraft: false} : t
                )
            );
        }

        setSendingTabs((prev) => ({...prev, [tabId]: true}));

        // Debug: log video settings being sent
        console.log("[Video Debug] Sending with settings:", {
            audioEnabled: videoAudioEnabled,
            duration: videoDuration,
            resolution: videoResolution,
            aspectRatio: videoAspectRatio,
        });

        // Add optimistic user message
        const tempUserMessage: Message = {
            id: Date.now(),
            role: "user",
            content,
            content_type: "text",
            created_at: new Date().toISOString(),
        };

        setTabMessages((prev) => ({
            ...prev,
            [tabId]: [...(prev[tabId] || []), tempUserMessage],
        }));

        // Add video generating placeholder for model response
        const videoMessageId = Date.now() + 1;
        const videoMessage: Message = {
            id: videoMessageId,
            role: "model",
            content: "",
            content_type: "video",
            created_at: new Date().toISOString(),
            isVideoGenerating: true,
            videoProgress: {
                status: "pending",
                message: "Iniciando generación de video...",
            },
        };

        setTabMessages((prev) => ({
            ...prev,
            [tabId]: [...(prev[tabId] || []), videoMessage],
        }));

        try {
            const response = await fetch(`/api/conversations/${conversationId}/messages/video`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    content,
                    quality_tier: selectedQualityTier,
                    videoSettings: {
                        duration: videoDuration,
                        resolution: videoResolution,
                        aspectRatio: videoAspectRatio,
                        audioEnabled: videoAudioEnabled,
                        negativePrompt: videoNegativePrompt || undefined,
                        seed: seed,
                    },
                    videoInputs: {
                        firstFrame: videoFirstFrame,
                        lastFrame: videoLastFrame,
                        referenceImages: videoReferenceImages.length > 0 ? videoReferenceImages : undefined,
                    },
                    referenceImages: videoReferenceImages.length > 0 ? videoReferenceImages : undefined,
                }),
            });

            if (!response.ok) {
                let errorMessage = "";
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || "";
                } catch { /* Respuesta no-JSON */ }
                if (!errorMessage) {
                    if (response.status === 413) {
                        errorMessage = "El contenido enviado es demasiado grande. Intenta con archivos más pequeños.";
                    } else if (response.status === 429) {
                        errorMessage = "Demasiadas solicitudes. Espera un momento e intenta de nuevo.";
                    } else {
                        errorMessage = `Error del servidor (${response.status})`;
                    }
                }
                setTabMessages((prev) => ({
                    ...prev,
                    [tabId]: prev[tabId].map((m) =>
                        m.id === videoMessageId
                            ? { ...m, content: `Error: ${errorMessage}`, isVideoGenerating: false, videoProgress: undefined }
                            : m
                    ),
                }));
                setSendingTabs((prev) => ({...prev, [tabId]: false}));
                return;
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let realUserMessageId: number | null = null;
            let realModelMessageId: number | null = null;

            if (reader) {
                let sseBuffer = "";
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;

                    sseBuffer += decoder.decode(value, { stream: true });
                    const lines = sseBuffer.split("\n");
                    sseBuffer = lines.pop() || "";

                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            try {
                                const data = JSON.parse(line.slice(6));

                                if (data.type === "user_message") {
                                    realUserMessageId = data.id;
                                    setTabMessages((prev) => ({
                                        ...prev,
                                        [tabId]: prev[tabId].map((m) =>
                                            m.id === tempUserMessage.id ? {...m, id: realUserMessageId!} : m
                                        ),
                                    }));
                                } else if (data.type === "progress") {
                                    setTabMessages((prev) => ({
                                        ...prev,
                                        [tabId]: prev[tabId].map((m) =>
                                            m.id === videoMessageId
                                                ? {
                                                    ...m,
                                                    videoProgress: {
                                                        status: data.status,
                                                        message: data.message,
                                                        progress: data.progress,
                                                    },
                                                }
                                                : m
                                        ),
                                    }));
                                } else if (data.type === "video") {
                                    setTabMessages((prev) => ({
                                        ...prev,
                                        [tabId]: prev[tabId].map((m) =>
                                            m.id === videoMessageId
                                                ? {
                                                    ...m,
                                                    video_url: data.videoUrl,
                                                    video_duration: data.duration,
                                                    video_has_audio: data.hasAudio,
                                                    video_aspect_ratio: data.aspectRatio,
                                                    generation_seed: data.seed,
                                                    isVideoGenerating: false,
                                                    videoProgress: undefined,
                                                }
                                                : m
                                        ),
                                    }));
                                } else if (data.type === "complete") {
                                    realModelMessageId = data.id;
                                    setTabMessages((prev) => ({
                                        ...prev,
                                        [tabId]: prev[tabId].map((m) =>
                                            m.id === videoMessageId
                                                ? {
                                                    ...m,
                                                    id: realModelMessageId!,
                                                    video_url: data.videoUrl,
                                                    video_duration: data.duration,
                                                    video_has_audio: data.hasAudio,
                                                    video_aspect_ratio: data.aspectRatio,
                                                    generation_seed: data.seed,
                                                    isVideoGenerating: false,
                                                    videoProgress: undefined,
                                                }
                                                : m
                                        ),
                                    }));
                                } else if (data.type === "title") {
                                    const newTitle = data.title;
                                    setOpenTabs((prev) =>
                                        prev.map((t) =>
                                            t.id === tabId ? {...t, title: newTitle} : t
                                        )
                                    );
                                    setTabConversations((prev) => ({
                                        ...prev,
                                        [tabId]: {...prev[tabId], title: newTitle},
                                    }));
                                    setConversations((prev) =>
                                        prev.map((c) =>
                                            c.id === conversationId ? {...c, title: newTitle} : c
                                        )
                                    );
                                } else if (data.type === "error") {
                                    realModelMessageId = data.id;
                                    setTabMessages((prev) => ({
                                        ...prev,
                                        [tabId]: prev[tabId].map((m) =>
                                            m.id === videoMessageId
                                                ? {
                                                    ...m,
                                                    id: realModelMessageId!,
                                                    content: `Error: ${data.message}`,
                                                    isVideoGenerating: false,
                                                    videoProgress: undefined,
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

            // Clear video frames after successful generation
            setVideoFirstFrame(null);
            setVideoLastFrame(null);
            setVideoReferenceImages([]);

            fetchConversations();
            if (selectedProjectId) {
                fetchProjectUsage(selectedProjectId);
                fetchProjectStats(selectedProjectId);
            }
        } catch (err) {
            console.error("Error generating video:", err);
            const isNetworkError = err instanceof TypeError || (err instanceof Error && /network|fetch|abort/i.test(err.message));
            const errorMsg = isNetworkError
                ? "Error de conexión. La generación puede haber tardado demasiado. Por favor intenta de nuevo."
                : `Error: ${err instanceof Error ? err.message : "Error inesperado al generar video"}`;
            setTabMessages((prev) => ({
                ...prev,
                [tabId]: prev[tabId].map((m) =>
                    m.id === videoMessageId
                        ? {
                            ...m,
                            content: errorMsg,
                            content_type: "error" as const,
                            isVideoGenerating: false,
                            videoProgress: undefined,
                        }
                        : m
                ),
            }));
        } finally {
            setSendingTabs((prev) => ({...prev, [tabId]: false}));
        }
    };

    // Send audio generation message
    const sendAudioMessage = async (content: string, qualityTier: "normal" | "hq" | "chirp" = "normal", overrideSpeakerConfig?: AudioSpeakerConfig) => {
        if (!activeTabId || !content.trim()) return;

        let tabId = activeTabId;
        const currentTab = openTabs.find(t => t.id === tabId);
        let conversationId = tabConversations[tabId]?.id;

        // Si es un tab draft, crear la conversación real en BD
        if (currentTab?.isDraft || !conversationId) {
            const draftConv = tabConversations[tabId];
            const newConv = await createNewConversation(draftConv?.model_id);
            if (!newConv) return;
            conversationId = newConv.id;
            setTabConversations((prev) => ({...prev, [tabId]: newConv}));
            setOpenTabs((prev) =>
                prev.map((t) =>
                    t.id === tabId ? {...t, conversationId: newConv.id, title: newConv.title, isDraft: false} : t
                )
            );
        }

        setSendingTabs((prev) => ({...prev, [tabId]: true}));

        console.log("[Audio Debug] Sending with settings:", {
            voiceId: audioVoiceId,
            stylePrompt: audioStylePrompt,
            multiSpeaker: audioMultiSpeaker,
            outputFormat: audioOutputFormat,
            qualityTier,
        });

        // Add optimistic user message
        const tempUserMessage: Message = {
            id: Date.now(),
            role: "user",
            content,
            content_type: "text",
            created_at: new Date().toISOString(),
        };

        setTabMessages((prev) => ({
            ...prev,
            [tabId]: [...(prev[tabId] || []), tempUserMessage],
        }));

        // Add audio generating placeholder for model response
        const audioMessageId = Date.now() + 1;
        const audioMessage: Message = {
            id: audioMessageId,
            role: "model",
            content: "",
            content_type: "audio",
            created_at: new Date().toISOString(),
            isAudioGenerating: true,
            audioProgress: {
                status: "pending",
                message: "Iniciando generación de audio...",
            },
        };

        setTabMessages((prev) => ({
            ...prev,
            [tabId]: [...(prev[tabId] || []), audioMessage],
        }));

        try {
            const response = await fetch(`/api/conversations/${conversationId}/messages/audio`, {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                body: JSON.stringify({
                    content,
                    quality_tier: qualityTier,
                    audioSettings: {
                        voiceId: audioVoiceId,
                        stylePrompt: audioStylePrompt || undefined,
                        multiSpeaker: audioTTSEngine === "chirp" ? false : audioMultiSpeaker,
                        speakerConfig: audioMultiSpeaker && audioTTSEngine !== "chirp" ? (overrideSpeakerConfig || audioSpeakerConfig) : undefined,
                        outputFormat: audioOutputFormat,
                        ttsEngine: audioTTSEngine,
                        speakingRate: audioTTSEngine === "chirp" ? audioSpeakingRate : undefined,
                        locale: audioTTSEngine === "chirp" ? audioLocale : undefined,
                    },
                }),
            });

            if (!response.ok) {
                let errorMessage = "";
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.error || "";
                } catch { /* Respuesta no-JSON */ }
                if (!errorMessage) {
                    if (response.status === 413) {
                        errorMessage = "El contenido enviado es demasiado grande. Intenta con archivos más pequeños.";
                    } else if (response.status === 429) {
                        errorMessage = "Demasiadas solicitudes. Espera un momento e intenta de nuevo.";
                    } else {
                        errorMessage = `Error del servidor (${response.status})`;
                    }
                }
                setTabMessages((prev) => ({
                    ...prev,
                    [tabId]: prev[tabId].map((m) =>
                        m.id === audioMessageId
                            ? { ...m, content: `Error: ${errorMessage}`, isAudioGenerating: false, audioProgress: undefined }
                            : m
                    ),
                }));
                setSendingTabs((prev) => ({...prev, [tabId]: false}));
                return;
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let realUserMessageId: number | null = null;
            let realModelMessageId: number | null = null;

            if (reader) {
                let sseBuffer = "";
                while (true) {
                    const {done, value} = await reader.read();
                    if (done) break;

                    sseBuffer += decoder.decode(value, { stream: true });
                    const lines = sseBuffer.split("\n");
                    sseBuffer = lines.pop() || "";

                    for (const line of lines) {
                        if (line.startsWith("data: ")) {
                            try {
                                const data = JSON.parse(line.slice(6));

                                if (data.type === "user_message") {
                                    realUserMessageId = data.id;
                                    setTabMessages((prev) => ({
                                        ...prev,
                                        [tabId]: prev[tabId].map((m) =>
                                            m.id === tempUserMessage.id ? {...m, id: realUserMessageId!} : m
                                        ),
                                    }));
                                } else if (data.type === "progress") {
                                    setTabMessages((prev) => ({
                                        ...prev,
                                        [tabId]: prev[tabId].map((m) =>
                                            m.id === audioMessageId
                                                ? {
                                                    ...m,
                                                    audioProgress: {
                                                        status: data.status,
                                                        message: data.message,
                                                    },
                                                }
                                                : m
                                        ),
                                    }));
                                } else if (data.type === "audio") {
                                    setTabMessages((prev) => ({
                                        ...prev,
                                        [tabId]: prev[tabId].map((m) =>
                                            m.id === audioMessageId
                                                ? {
                                                    ...m,
                                                    content: data.content || m.content, // Guardar texto original para restauración
                                                    audio_url: data.audioUrl,
                                                    audio_duration: data.duration,
                                                    audio_mime_type: data.mimeType,
                                                    audio_voice_config: data.voiceConfig,
                                                    isAudioGenerating: false,
                                                    audioProgress: undefined,
                                                }
                                                : m
                                        ),
                                    }));
                                } else if (data.type === "complete") {
                                    realModelMessageId = data.messageId;
                                    setTabMessages((prev) => ({
                                        ...prev,
                                        [tabId]: prev[tabId].map((m) =>
                                            m.id === audioMessageId
                                                ? {
                                                    ...m,
                                                    id: realModelMessageId!,
                                                    isAudioGenerating: false,
                                                    audioProgress: undefined,
                                                }
                                                : m
                                        ),
                                    }));
                                } else if (data.type === "title") {
                                    const newTitle = data.title;
                                    setOpenTabs((prev) =>
                                        prev.map((t) =>
                                            t.id === tabId ? {...t, title: newTitle} : t
                                        )
                                    );
                                    setTabConversations((prev) => ({
                                        ...prev,
                                        [tabId]: {...prev[tabId], title: newTitle},
                                    }));
                                    setConversations((prev) =>
                                        prev.map((c) =>
                                            c.id === conversationId ? {...c, title: newTitle} : c
                                        )
                                    );
                                } else if (data.type === "error") {
                                    realModelMessageId = data.id;
                                    setTabMessages((prev) => ({
                                        ...prev,
                                        [tabId]: prev[tabId].map((m) =>
                                            m.id === audioMessageId
                                                ? {
                                                    ...m,
                                                    id: realModelMessageId!,
                                                    content: `Error: ${data.message}`,
                                                    isAudioGenerating: false,
                                                    audioProgress: undefined,
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
            if (selectedProjectId) {
                fetchProjectUsage(selectedProjectId);
                fetchProjectStats(selectedProjectId);
            }
        } catch (err) {
            console.error("Error generating audio:", err);
            const isNetworkError = err instanceof TypeError || (err instanceof Error && /network|fetch|abort/i.test(err.message));
            const errorMsg = isNetworkError
                ? "Error de conexión. La generación puede haber tardado demasiado. Por favor intenta de nuevo."
                : `Error: ${err instanceof Error ? err.message : "Error inesperado al generar audio"}`;
            setTabMessages((prev) => ({
                ...prev,
                [tabId]: prev[tabId].map((m) =>
                    m.id === audioMessageId
                        ? {
                            ...m,
                            content: errorMsg,
                            content_type: "error" as const,
                            isAudioGenerating: false,
                            audioProgress: undefined,
                        }
                        : m
                ),
            }));
        } finally {
            setSendingTabs((prev) => ({...prev, [tabId]: false}));
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
            <div className="flex h-screen bg-background items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary"/>
            </div>
        );
    }

    return (
        <div className="flex h-screen bg-background">
            {/* Left Sidebar - Conversations */}
            {leftSidebarOpen && (
                <div className="w-64 border-r border-border/50 bg-sidebar flex flex-col relative">
                    {/* Close button */}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setLeftSidebarOpen(false)}
                        className="absolute top-2 right-2 h-7 w-7 text-muted-foreground hover:text-foreground z-10"
                        title="Cerrar panel"
                    >
                        <PanelLeftClose className="h-4 w-4"/>
                    </Button>

                    {/* Header - Logo always visible */}
                    <div className={`p-3 ${selectedProjectId ? 'border-b border-border/50' : ''}`}>
                        <button
                            onClick={() => setSelectedProjectId(null)}
                            className={`flex items-center gap-2 ${selectedProjectId ? 'mb-3' : ''}`}
                        >
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-500 flex items-center justify-center text-black font-bold text-sm">
                                PS
                            </div>
                            <span className="text-lg font-semibold tracking-tight">
                                Puerto <span className="text-yellow-400">Studio</span>
                            </span>
                        </button>
                        {selectedProjectId && (
                            <Button
                                onClick={() => setShowNewConversationModal(true)}
                                className="w-full gap-2"
                                size="sm"
                                disabled={!generationConfig.some(c => c.is_enabled)}
                            >
                                <Plus className="h-4 w-4"/>
                                Nueva conversación
                            </Button>
                        )}
                    </div>

                    {/* Project Selector - Only when project is selected */}
                    {selectedProjectId && (
                    <div className="p-3 border-b border-border/50">
                        <label className="text-xs text-muted-foreground mb-1 block">Proyecto</label>
                        <select
                            className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                            value={selectedProjectId || ""}
                            onChange={(e) =>
                                setSelectedProjectId(e.target.value ? Number(e.target.value) : null)
                            }
                        >
                            <option value="">Selecciona un proyecto</option>
                            {projects.map((p) => (
                                <option key={p.id} value={p.id}>
                                    {p.client_name} - {p.title}
                                </option>
                            ))}
                        </select>
                        {selectedProjectId && projectUsage && (
                            <div className="mt-2 px-2 py-1.5 bg-card rounded-lg border border-border/30 space-y-2">
                                {/* Image generations */}
                                {/* Image generations (combined normal + hq) */}
                                {(() => {
                                    const imageUsed = (projectUsage.image?.normal?.used || 0) + (projectUsage.image?.hq?.used || 0);
                                    const imageLimit = (projectUsage.image?.normal?.limit || 0) + (projectUsage.image?.hq?.limit || 0);
                                    const imageUnlimited = (projectUsage.image?.normal?.unlimited && projectUsage.image?.hq?.unlimited) || imageLimit === 0;
                                    return (
                                        <div>
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-muted-foreground flex items-center gap-1">
                                                    <ImageIcon className="h-3 w-3" />
                                                    Imágenes
                                                </span>
                                                <span className={imageUnlimited ? "text-green-400" : imageUsed >= imageLimit ? "text-red-400" : "text-foreground"}>
                                                    {imageUnlimited ? (
                                                        <span className="text-green-400">∞</span>
                                                    ) : (
                                                        <>{imageUsed} / {imageLimit}</>
                                                    )}
                                                </span>
                                            </div>
                                            {!imageUnlimited && imageLimit > 0 && (
                                                <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all ${
                                                            imageUsed >= imageLimit
                                                                ? "bg-red-500"
                                                                : imageUsed >= imageLimit * 0.8
                                                                    ? "bg-yellow-500"
                                                                    : "bg-blue-500"
                                                        }`}
                                                        style={{ width: `${Math.min((imageUsed / imageLimit) * 100, 100)}%` }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                                {/* Video generations (combined normal + hq) */}
                                {(() => {
                                    const videoUsed = (projectUsage.video?.normal?.used || 0) + (projectUsage.video?.hq?.used || 0);
                                    const videoLimit = (projectUsage.video?.normal?.limit || 0) + (projectUsage.video?.hq?.limit || 0);
                                    const videoUnlimited = (projectUsage.video?.normal?.unlimited && projectUsage.video?.hq?.unlimited) || videoLimit === 0;
                                    return (
                                        <div>
                                            <div className="flex items-center justify-between text-xs">
                                                <span className="text-muted-foreground flex items-center gap-1">
                                                    <Video className="h-3 w-3" />
                                                    Videos
                                                </span>
                                                <span className={videoUnlimited ? "text-green-400" : videoUsed >= videoLimit ? "text-red-400" : "text-foreground"}>
                                                    {videoUnlimited ? (
                                                        <span className="text-green-400">∞</span>
                                                    ) : (
                                                        <>{videoUsed} / {videoLimit}</>
                                                    )}
                                                </span>
                                            </div>
                                            {!videoUnlimited && videoLimit > 0 && (
                                                <div className="mt-1 h-1 bg-muted rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all ${
                                                            videoUsed >= videoLimit
                                                                ? "bg-red-500"
                                                                : videoUsed >= videoLimit * 0.8
                                                                    ? "bg-yellow-500"
                                                                    : "bg-purple-500"
                                                        }`}
                                                        style={{ width: `${Math.min((videoUsed / videoLimit) * 100, 100)}%` }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>
                        )}
                        {selectedProjectId && (
                            <Button
                                onClick={() => handleOpenGallery()}
                                variant="outline"
                                size="sm"
                                className="w-full mt-2 gap-2 text-purple-400 border-purple-500/30 hover:bg-purple-500/10 hover:text-purple-300"
                            >
                                <ImageIcon className="h-4 w-4"/>
                                Ver todas las generaciones
                            </Button>
                        )}
                    </div>
                    )}

                    {/* Conversations List - Only when project is selected */}
                    {selectedProjectId && (
                    <div className="flex-1 overflow-y-auto p-2 space-y-1">
                        {loadingConversations ? (
                            <div className="flex justify-center py-4">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground"/>
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
                                        {getConversationIcon(conv.generation_type, "h-4 w-4 shrink-0")}
                                        <div className="flex-1 min-w-0">
                                            <div
                                                className="text-sm truncate"
                                                title={conv.title?.trim() ? conv.title : undefined}
                                            >
                                                {conv.title}
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => archiveConversation(conv.id, e)}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-orange-500/10 rounded transition-opacity"
                                            title="Archivar conversación"
                                        >
                                            <Archive className="h-3 w-3 text-orange-400"/>
                                        </button>
                                    </div>
                                );
                            })
                        )}
                    </div>
                    )}

                    {/* Archived Conversations - Only show when project is selected */}
                    {selectedProjectId && (
                    <div className="border-t border-border/50">
                        <button
                            onClick={() => {
                                setShowArchived(!showArchived);
                                if (!showArchived && archivedConversations.length === 0) {
                                    fetchArchivedConversations();
                                }
                            }}
                            className="flex items-center gap-2 w-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
                        >
                            <Archive className="h-4 w-4"/>
                            <span>Archivadas</span>
                            <ChevronRight className={`h-4 w-4 ml-auto transition-transform ${showArchived ? "rotate-90" : ""}`}/>
                        </button>

                        {showArchived && (
                            <div className="p-2 space-y-1 bg-background/90">
                                {loadingArchived ? (
                                    <div className="flex justify-center py-2">
                                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground"/>
                                    </div>
                                ) : archivedConversations.length === 0 ? (
                                    <div className="text-center text-muted-foreground text-xs py-2">
                                        Sin conversaciones archivadas
                                    </div>
                                ) : (
                                    archivedConversations.map((conv) => {
                                        const isOpenInTab = openTabs.some((t) => t.conversationId === conv.id);
                                        return (
                                            <div
                                                key={conv.id}
                                                onClick={() => openConversationInTab({...conv, isArchived: true})}
                                                className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                                                    isOpenInTab
                                                        ? "bg-orange-500/10 text-orange-400"
                                                        : "text-muted-foreground hover:bg-accent/50"
                                                }`}
                                            >
                                                <Archive className="h-4 w-4 shrink-0 opacity-50"/>
                                                <div className="flex-1 min-w-0">
                                                    <div
                                                        className="text-sm truncate opacity-70"
                                                        title={conv.title?.trim() ? conv.title : undefined}
                                                    >
                                                        {conv.title}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        )}
                    </div>
                    )}

                    {/* User Menu */}
                    <div className="p-3 border-t border-border/50">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button className="flex items-center gap-2 w-full p-2 rounded-lg hover:bg-accent transition-colors">
                                    <Avatar className="h-8 w-8">
                                        <AvatarImage src={session?.user?.image || undefined}/>
                                        <AvatarFallback className="bg-primary/20 text-primary text-xs">
                                            {getInitials(session?.user?.name)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="flex-1 text-left min-w-0">
                                        <div className="text-sm font-medium truncate">
                                            {session?.user?.name || session?.user?.email}
                                        </div>
                                    </div>
                                    <ChevronDown className="h-4 w-4 text-muted-foreground"/>
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56 bg-card border-border/50">
                                <DropdownMenuItem asChild>
                                    <Link href="/dashboard" className="cursor-pointer">
                                        <LayoutDashboard className="mr-2 h-4 w-4"/>
                                        Dashboard
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link href="/dashboard/projects" className="cursor-pointer">
                                        <FolderKanban className="mr-2 h-4 w-4"/>
                                        Proyectos
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem asChild>
                                    <Link href="/dashboard/settings" className="cursor-pointer">
                                        <Settings className="mr-2 h-4 w-4"/>
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
                                        <Sparkles className="mr-2 h-4 w-4"/>
                                        Status
                                    </a>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator className="bg-border/50"/>
                                {/* Theme Selector */}
                                <div className="px-2 py-1.5">
                                    <div className="text-xs text-muted-foreground mb-2 px-2">Tema</div>
                                    <div className="flex gap-1">
                                        <button
                                            onClick={() => setTheme("light")}
                                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${
                                                theme === "light"
                                                    ? "bg-primary text-primary-foreground"
                                                    : "hover:bg-accent"
                                            }`}
                                        >
                                            <Sun className="h-3.5 w-3.5"/>
                                            Claro
                                        </button>
                                        <button
                                            onClick={() => setTheme("dark")}
                                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${
                                                theme === "dark"
                                                    ? "bg-primary text-primary-foreground"
                                                    : "hover:bg-accent"
                                            }`}
                                        >
                                            <Moon className="h-3.5 w-3.5"/>
                                            Oscuro
                                        </button>
                                        <button
                                            onClick={() => setTheme("system")}
                                            className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors ${
                                                theme === "system"
                                                    ? "bg-primary text-primary-foreground"
                                                    : "hover:bg-accent"
                                            }`}
                                        >
                                            <Monitor className="h-3.5 w-3.5"/>
                                            Auto
                                        </button>
                                    </div>
                                </div>
                                <DropdownMenuSeparator className="bg-border/50"/>
                                <DropdownMenuItem
                                    onClick={() => signOut({callbackUrl: "/login"})}
                                    className="text-red-400 focus:text-red-400 cursor-pointer"
                                >
                                    <LogOut className="mr-2 h-4 w-4"/>
                                    Cerrar sesión
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>
            )}

            {/* Main Chat Area */}
            {selectedProjectId ? (
                <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                    {/* Tabs Bar */}
                    {openTabs.length > 0 && (
                        <ConversationTabs
                            tabs={openTabs}
                            activeTabId={activeTabId}
                            onTabClick={setActiveTabId}
                            onTabClose={handleTabClose}
                            onNewTab={() => setShowNewConversationModal(true)}
                            disabled={isSending}
                        />
                    )}

                    {/* Content Area - with floating sidebar toggles */}
                    <div className={cn(
                        "relative flex-1 flex flex-col overflow-hidden",
                        activeTab?.isGallery
                            ? "bg-gradient-to-b from-purple-50/50 via-transparent to-transparent dark:from-purple-950/20 dark:via-transparent dark:to-transparent"
                            : activeTab?.isArchived
                                ? "bg-gradient-to-b from-orange-50/50 via-transparent to-transparent dark:from-orange-950/20 dark:via-transparent dark:to-transparent"
                                : openTabs.length > 0
                                    ? "bg-gradient-to-b from-blue-50/50 via-transparent to-transparent dark:from-blue-950/20 dark:via-transparent dark:to-transparent"
                                    : ""
                    )}>
                        {/* Floating toggle for left sidebar */}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setLeftSidebarOpen(!leftSidebarOpen)}
                            className={cn(
                                "absolute top-2 left-2 z-20 h-8 w-8 bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm",
                                leftSidebarOpen && "hidden"
                            )}
                            title="Abrir panel izquierdo"
                        >
                            <PanelLeft className="h-4 w-4"/>
                        </Button>

                        {/* Floating toggle for right sidebar */}
                        {activeTabId !== null && !activeTab?.isGallery && !isAudioConversation && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
                                className={cn(
                                    "absolute top-2 right-2 z-20 h-8 w-8 bg-background/80 backdrop-blur-sm border border-border/50 shadow-sm",
                                    rightSidebarOpen && "hidden"
                                )}
                                title="Abrir panel derecho"
                            >
                                <PanelRight className="h-4 w-4"/>
                            </Button>
                        )}

                    {/* Content Area */}
                    {activeTab?.isGallery ? (
                        /* Gallery View */
                        <div className="flex-1 overflow-hidden">
                            <GenerationsGallery
                                projectId={selectedProjectId!}
                                currentUserId={Number(session?.user?.id) || 0}
                                onOpenConversation={handleOpenConversationFromGallery}
                                onReusePrompt={async (prompt, type, modelMessageId) => {
                                    setReusePrompt(prompt);
                                    setNewConversationType(type);
                                    // Fetch reference images from the model message
                                    if (modelMessageId) {
                                        try {
                                            const res = await fetch(`/api/messages/${modelMessageId}/reference-images`);
                                            if (res.ok) {
                                                const data = await res.json();
                                                if (data.images && data.images.length > 0) {
                                                    setReuseImages(data.images.map((img: { url: string }) => img.url));
                                                }
                                            }
                                        } catch (err) {
                                            console.error("Error fetching reference images:", err);
                                        }
                                    }
                                    handleNewTab(undefined, type);
                                }}
                            />
                        </div>
                    ) : isAudioConversation && activeTabId !== null ? (
                        /* TTS Composer View - Split layout with history column (expanded since no right sidebar) */
                        <div className="flex-1 flex overflow-hidden">
                            {/* Left: TTSComposer */}
                            <div className="flex-1 overflow-y-auto max-w-2xl mx-auto">
                                <TTSComposer
                                    voiceId={audioVoiceId}
                                    multiSpeaker={audioMultiSpeaker}
                                    speakerConfig={audioSpeakerConfig}
                                    stylePrompt={audioStylePrompt}
                                    outputFormat={audioOutputFormat}
                                    qualityTier={audioQualityTier}
                                    ttsEngine={audioTTSEngine}
                                    lockedEngine={currentConversation?.generation_type === "audio_hd"}
                                    chirpAvailable={false}
                                    normalModelName={currentTypeConfig?.model_normal_name}
                                    hqModelName={currentTypeConfig?.model_hq_name}
                                    speakingRate={audioSpeakingRate}
                                    locale={audioLocale}
                                    disabled={isSending}
                                    isGenerating={(() => {
                                        const msgs = tabMessages[activeTabId] || [];
                                        return msgs.some(m => m.isAudioGenerating);
                                    })()}
                                    generationProgress={(() => {
                                        const msgs = tabMessages[activeTabId] || [];
                                        const generatingMsg = msgs.find(m => m.isAudioGenerating);
                                        return generatingMsg?.audioProgress;
                                    })()}
                                    restoreData={audioRestoreData}
                                    onGenerate={(text, speakers, qualityTier) => {
                                        if (speakers) {
                                            // Multi-speaker mode
                                            setAudioSpeakerConfig(speakers);
                                            setAudioMultiSpeaker(true);
                                        }
                                        sendAudioMessage(text, qualityTier || audioQualityTier, speakers || undefined);
                                    }}
                                    onSettingsChange={(settings) => {
                                        if (settings.voiceId !== undefined) {
                                            setAudioVoiceId(settings.voiceId);
                                            handleSettingChange("audio_voice_id", settings.voiceId);
                                        }
                                        if (settings.stylePrompt !== undefined) {
                                            setAudioStylePrompt(settings.stylePrompt);
                                            handleSettingChange("audio_style_prompt", settings.stylePrompt);
                                        }
                                        if (settings.multiSpeaker !== undefined) {
                                            setAudioMultiSpeaker(settings.multiSpeaker);
                                            handleSettingChange("audio_multi_speaker", settings.multiSpeaker);
                                        }
                                        if (settings.speakerConfig !== undefined) {
                                            setAudioSpeakerConfig(settings.speakerConfig);
                                            handleSettingChange("audio_speaker_config", settings.speakerConfig);
                                        }
                                        if (settings.outputFormat !== undefined) {
                                            setAudioOutputFormat(settings.outputFormat);
                                            handleSettingChange("audio_output_format", settings.outputFormat);
                                        }
                                        if (settings.qualityTier !== undefined) {
                                            setAudioQualityTier(settings.qualityTier);
                                        }
                                        if (settings.ttsEngine !== undefined) {
                                            setAudioTTSEngine(settings.ttsEngine);
                                            handleSettingChange("audio_tts_engine", settings.ttsEngine);
                                        }
                                        if (settings.speakingRate !== undefined) {
                                            setAudioSpeakingRate(settings.speakingRate);
                                            handleSettingChange("audio_speaking_rate", settings.speakingRate);
                                        }
                                        if (settings.locale !== undefined) {
                                            setAudioLocale(settings.locale);
                                            handleSettingChange("audio_locale", settings.locale);
                                        }
                                    }}
                                    onRestoreHandled={() => setAudioRestoreData(null)}
                                />
                            </div>
                            {/* Right: Audio Generation History Column - wider now */}
                            <div className="w-96 border-l border-border/50 bg-card/50 overflow-y-auto p-4">
                                <AudioGenerationHistory
                                    messages={tabMessages[activeTabId] || []}
                                    onRestore={(data) => setAudioRestoreData(data)}
                                    onToggleFavorite={handleToggleFavorite}
                                />
                            </div>
                        </div>
                    ) : (
                        /* Messages Area */
                        <div className="flex-1 overflow-y-auto p-4">
                            {activeTabId === null ? (
                                <div className="flex flex-col h-full p-6">
                                    <h2 className="text-lg font-semibold text-foreground mb-4">
                                        Conversaciones
                                    </h2>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                                        {/* Gallery Folder - First item */}
                                        <button
                                            onClick={() => handleOpenGallery()}
                                            className="group flex flex-col items-center p-4 rounded-xl bg-gradient-to-br from-purple-500/10 to-purple-600/5 border border-purple-500/30 hover:border-purple-400/50 hover:from-purple-500/20 hover:to-purple-600/10 transition-all"
                                        >
                                            <div className="w-16 h-14 rounded-lg bg-gradient-to-br from-purple-500 to-purple-600 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform shadow-lg shadow-purple-500/20">
                                                <ImageIcon className="h-7 w-7 text-white" />
                                            </div>
                                            <span className="text-sm font-medium text-purple-300 group-hover:text-purple-200 transition-colors">
                                                Galería
                                            </span>
                                            {projectStats && (
                                                <span className="text-xs text-purple-400/70 mt-1">
                                                    {projectStats.totalImages + projectStats.totalVideos} generaciones
                                                </span>
                                            )}
                                        </button>

                                        {/* Conversation Cards */}
                                        {conversations.map((conv) => {
                                            const isOpenInTab = openTabs.some((t) => t.conversationId === conv.id);
                                            return (
                                                <button
                                                    key={conv.id}
                                                    onClick={() => openConversationInTab(conv)}
                                                    className={`group flex flex-col items-center p-4 rounded-xl border transition-all text-left ${
                                                        isOpenInTab
                                                            ? "bg-primary/10 border-primary/30"
                                                            : "bg-card/50 border-border/30 hover:border-border/60 hover:bg-card"
                                                    }`}
                                                >
                                                    <div className={`w-16 h-14 rounded-lg flex items-center justify-center mb-3 group-hover:scale-105 transition-transform ${
                                                        isOpenInTab
                                                            ? "bg-primary/20"
                                                            : "bg-muted"
                                                    }`}>
                                                        {getConversationIcon(conv.generation_type, `h-6 w-6 ${isOpenInTab ? "text-primary" : "text-muted-foreground"}`)}
                                                    </div>
                                                    <span className="text-sm font-medium text-foreground w-full text-center line-clamp-3 h-[3.75rem] leading-5" title={conv.title}>
                                                        {conv.title}
                                                    </span>
                                                    <span className="text-xs text-muted-foreground mt-1">
                                                        {conv.message_count} {conv.message_count === 1 ? "mensaje" : "mensajes"}
                                                    </span>
                                                </button>
                                            );
                                        })}

                                        {/* New Conversation Button */}
                                        <button
                                            onClick={() => setShowNewConversationModal(true)}
                                            className="group flex flex-col items-center p-4 rounded-xl border border-dashed border-border/50 hover:border-primary/50 hover:bg-primary/5 transition-all"
                                        >
                                            <div className="w-16 h-14 rounded-lg bg-muted/50 flex items-center justify-center mb-3 group-hover:bg-primary/10 transition-colors">
                                                <Plus className="h-6 w-6 text-muted-foreground group-hover:text-primary transition-colors" />
                                            </div>
                                            <span className="text-sm font-medium text-muted-foreground group-hover:text-primary transition-colors">
                                                Nueva
                                            </span>
                                        </button>
                                    </div>

                                    {conversations.length === 0 && (
                                        <p className="text-center text-muted-foreground mt-8">
                                            Crea tu primera conversación para comenzar a generar contenido.
                                        </p>
                                    )}
                                </div>
                            ) : messages.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-center">
                                    <div className="flex items-center gap-3 mb-3">
                                        <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-500 flex items-center justify-center text-black font-bold text-2xl">
                                            PS
                                        </div>
                                    </div>
                                    <p className="text-muted-foreground max-w-md">
                                        Comienza una conversación con los modelos de IA disponibles. Escribe tu
                                        mensaje abajo para empezar.
                                    </p>
                                </div>
                            ) : (
                                <div className="max-w-4xl mx-auto space-y-4">
                                    {messages.map((msg, msgIndex) => {
                                        // Check if this message should be shown as ignored
                                        // User messages: check their own ignore_in_context flag
                                        // Model messages: check if the previous user message is ignored
                                        const isIgnored = msg.role === "user"
                                            ? msg.ignore_in_context
                                            : (msgIndex > 0 && messages[msgIndex - 1]?.role === "user" && messages[msgIndex - 1]?.ignore_in_context);

                                        return (
                                        <div
                                            key={msg.id}
                                            className={`group flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
                                        >
                                            {msg.role === "model" && (
                                                <div
                                                    title={msg.created_at ? new Date(msg.created_at).toLocaleString() : undefined}
                                                    className={`w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 ${isIgnored ? "opacity-40" : ""}`}
                                                >
                                                    {msg.isStreaming ? (
                                                        <Loader2 className="h-4 w-4 text-primary animate-spin"/>
                                                    ) : (
                                                        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-yellow-400 to-yellow-500 flex items-center justify-center text-black font-bold text-sm">
                                                            PS
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                            <div
                                                className={`relative max-w-[80%] rounded-2xl px-4 py-3 ${
                                                    msg.role === "user"
                                                        ? "bg-primary text-primary-foreground"
                                                        : "bg-card border border-border/50"
                                                } ${isIgnored ? "opacity-60" : ""}`}
                                            >
                                                {/* Ignored badge overlay */}
                                                {isIgnored && (
                                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
                                                        <div className="bg-orange-500/90 text-white text-xs font-medium px-2 py-0.5 rounded-full shadow-sm flex items-center gap-1">
                                                            <EyeOff className="h-3 w-3" />
                                                            <span>Ignorado</span>
                                                        </div>
                                                    </div>
                                                )}
                                                {/* Favorite star for model messages with assets */}
                                                {msg.role === "model" && (msg.image_url || msg.video_url || msg.audio_url) && (
                                                    <button
                                                        onClick={() => handleToggleFavorite(msg.id)}
                                                        className={`absolute -top-2 -right-2 p-1 rounded-full transition-all z-10 ${
                                                            msg.is_favorite
                                                                ? "bg-yellow-500/20 text-yellow-400"
                                                                : "bg-card border border-border/50 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-yellow-400"
                                                        }`}
                                                        title={msg.is_favorite ? "Quitar de favoritos" : "Agregar a favoritos"}
                                                    >
                                                        <Star className={`h-4 w-4 ${msg.is_favorite ? "fill-yellow-400" : ""}`} />
                                                    </button>
                                                )}
                                                {/* Seed button for model messages with generation_seed (image or video) */}
                                                {msg.role === "model" && msg.generation_seed && (msg.image_url || msg.video_url) && (
                                                    <button
                                                        onClick={() => {
                                                            if (selectedSeed === msg.generation_seed) {
                                                                // Deselect
                                                                setSelectedSeed(null);
                                                                setSeedPrompt(null);
                                                            } else {
                                                                // Select seed and find the original prompt
                                                                setSelectedSeed(msg.generation_seed!);
                                                                // Find the user message that preceded this model message
                                                                const currentMessages = tabMessages[activeTabId!] || [];
                                                                const msgIndex = currentMessages.findIndex(m => m.id === msg.id);
                                                                if (msgIndex > 0) {
                                                                    // Look backwards for the user message
                                                                    for (let i = msgIndex - 1; i >= 0; i--) {
                                                                        if (currentMessages[i].role === "user" && currentMessages[i].content) {
                                                                            setSeedPrompt(currentMessages[i].content);
                                                                            break;
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }}
                                                        className={`absolute top-5 -right-2 p-1 rounded-full transition-all z-10 ${
                                                            selectedSeed === msg.generation_seed
                                                                ? "bg-purple-500/20 text-purple-400"
                                                                : "bg-card border border-border/50 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-purple-400"
                                                        }`}
                                                        title={selectedSeed === msg.generation_seed ? "Deseleccionar seed" : `Usar seed ${msg.generation_seed} en proxima generacion`}
                                                    >
                                                        <Dices className={`h-4 w-4 ${selectedSeed === msg.generation_seed ? "fill-purple-400" : ""}`} />
                                                    </button>
                                                )}
                                                {/* Reuse prompt button for model messages with image/video */}
                                                {msg.role === "model" && (msg.image_url || msg.video_url) && !msg.audio_url && (
                                                    <button
                                                        onClick={() => {
                                                            const currentMessages = tabMessages[activeTabId!] || [];
                                                            const msgIndex = currentMessages.findIndex(m => m.id === msg.id);
                                                            if (msgIndex > 0) {
                                                                for (let i = msgIndex - 1; i >= 0; i--) {
                                                                    if (currentMessages[i].role === "user" && currentMessages[i].content) {
                                                                        setReusePrompt(currentMessages[i].content);
                                                                        // Restaurar imágenes de referencia del mensaje usuario
                                                                        const userMsg = currentMessages[i];
                                                                        if (userMsg.images && userMsg.images.length > 0) {
                                                                            setReuseImages(userMsg.images.map((img: { url: string }) => img.url));
                                                                        } else if (userMsg.image_url) {
                                                                            setReuseImages([userMsg.image_url]);
                                                                        } else {
                                                                            setReuseImages([]);
                                                                        }
                                                                        break;
                                                                    }
                                                                }
                                                            }
                                                        }}
                                                        className={`absolute ${msg.generation_seed ? "top-12" : "top-5"} -right-2 p-1 rounded-full transition-all z-10 bg-card border border-border/50 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-blue-400`}
                                                        title="Reusar prompt"
                                                    >
                                                        <RotateCcw className="h-4 w-4" />
                                                    </button>
                                                )}
                                                {/* Ignore in context button - only for user messages */}
                                                {!activeTab?.isArchived && msg.role === "user" && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleToggleIgnoreContext(msg.id);
                                                        }}
                                                        className={`absolute -top-2 -left-2 p-1.5 rounded-full transition-all z-20 ${
                                                            msg.ignore_in_context
                                                                ? "bg-orange-500/20 text-orange-400 border border-orange-500/30"
                                                                : "bg-card border border-border/50 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-orange-400 hover:border-orange-500/30"
                                                        }`}
                                                        title={msg.ignore_in_context ? "Incluir en contexto" : "Ignorar en contexto (este mensaje y su respuesta)"}
                                                    >
                                                        <EyeOff className="h-3.5 w-3.5" />
                                                    </button>
                                                )}
                                                <MessageContent
                                                    content={msg.content}
                                                    contentType={msg.content_type}
                                                    imageUrl={msg.image_url}
                                                    videoUrl={msg.video_url}
                                                    videoDuration={msg.video_duration}
                                                    videoHasAudio={msg.video_has_audio}
                                                    videoAspectRatio={msg.video_aspect_ratio || videoAspectRatio}
                                                    isVideoGenerating={msg.isVideoGenerating}
                                                    videoProgress={msg.videoProgress}
                                                    audioUrl={msg.audio_url}
                                                    audioDuration={msg.audio_duration}
                                                    audioMimeType={msg.audio_mime_type}
                                                    audioVoiceConfig={msg.audio_voice_config}
                                                    isAudioGenerating={msg.isAudioGenerating}
                                                    audioProgress={msg.audioProgress}
                                                    isUser={msg.role === "user"}
                                                    isStreaming={msg.isStreaming}
                                                    allowImageSelection={!activeTab?.isArchived && !!msg.image_url}
                                                    isImageSelected={msg.image_url ? selectedConversationImages.includes(msg.image_url) : false}
                                                    onImageSelect={handleConversationImageSelect}
                                                    onViewImage={msg.role === "model" && msg.image_url ? () => setViewingImageMessage(msg) : undefined}
                                                    onViewVideo={msg.role === "model" && msg.video_url ? () => setViewingVideoMessage(msg) : undefined}
                                                />
                                            </div>
                                            {msg.role === "user" && (
                                                <Avatar
                                                    title={msg.created_at ? new Date(msg.created_at).toLocaleString() : undefined}
                                                    className="h-8 w-8 shrink-0"
                                                >
                                                    <AvatarImage src={session?.user?.image || undefined}/>
                                                    <AvatarFallback className="bg-accent text-xs">
                                                        {getInitials(session?.user?.name)}
                                                    </AvatarFallback>
                                                </Avatar>
                                            )}
                                        </div>
                                        );
                                    })}
                                    <div ref={messagesEndRef}/>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Input Area - Hidden for gallery, archived, and audio conversations (TTSComposer handles audio) */}
                    {activeTabId !== null && !activeTab?.isGallery && !isAudioConversation && (
                        activeTab?.isArchived ? (
                            <div className="p-4 border-t border-border/50 bg-orange-500/5">
                                <div className="flex items-center justify-center gap-2 text-orange-400 text-sm">
                                    <Archive className="h-4 w-4"/>
                                    <span>Esta conversación está archivada (solo lectura)</span>
                                </div>
                            </div>
                        ) : (
                            <div className="flex flex-col">
                                {/* Generation Mode Selector - Only for video conversations */}
                                {isVideoConversation && (
                                    <div className="flex justify-center py-2 border-t border-border/50">
                                        <GenerationModeSelector
                                            mode={generationMode}
                                            onChange={(mode) => {
                                                setGenerationMode(mode);
                                                // Clear selected images when switching to video mode
                                                if (mode === "video") {
                                                    setSelectedConversationImages([]);
                                                }
                                            }}
                                            disabled={isSending}
                                            imageDisabled={!hasImageModelsForVideo}
                                        />
                                    </div>
                                )}
                                {/* Quality Tier Selector */}
                                {projectUsage && currentConversation?.generation_type && currentConversation.generation_type !== "audio_hd" && (
                                    <div className="flex justify-center py-2 border-t border-border/50">
                                        <QualitySelector
                                            selectedQuality={selectedQualityTier}
                                            onSelect={setSelectedQualityTier}
                                            disabled={isSending}
                                            normalUsage={
                                                isVideoConversation && generationMode === "image"
                                                    ? projectUsage.image?.normal
                                                    : projectUsage[currentConversation.generation_type]?.normal
                                            }
                                            hqUsage={
                                                isVideoConversation && generationMode === "image"
                                                    ? projectUsage.image?.hq
                                                    : projectUsage[currentConversation.generation_type]?.hq
                                            }
                                            showUsage={true}
                                            normalModelName={currentTypeConfig?.model_normal_name}
                                            hqModelName={currentTypeConfig?.model_hq_name}
                                        />
                                    </div>
                                )}
                                {/* Selected Seed Indicator */}
                                {selectedSeed && (isImageConversation || isVideoConversation) && (
                                    <div className="flex items-center justify-center gap-2 py-2 px-4 border-t border-border/50">
                                        <div className="flex items-center gap-2 bg-purple-500/10 text-purple-400 px-3 py-1.5 rounded-full text-sm">
                                            <Dices className="h-4 w-4" />
                                            <span className="font-mono">Seed: {selectedSeed}</span>
                                            <button
                                                onClick={() => {
                                                    setSelectedSeed(null);
                                                    setSeedPrompt(null);
                                                }}
                                                className="hover:bg-purple-500/20 rounded-full p-0.5 transition-colors"
                                                title="Limpiar seed"
                                            >
                                                <X className="h-3 w-3" />
                                            </button>
                                        </div>
                                    </div>
                                )}
                                <MessageInput
                                    onSend={(content, files, noContext) => {
                                        // Route based on generation type
                                        if (isVideoConversation && generationMode === "video") {
                                            sendVideoMessage(content, selectedSeed || undefined);
                                            // Clear selected seed and prompt after use
                                            if (selectedSeed) {
                                                setSelectedSeed(null);
                                                setSeedPrompt(null);
                                            }
                                        } else if (isImageConversation || (isVideoConversation && generationMode === "image")) {
                                            // Image generation - pass noContext parameter
                                            const imgSettings = {
                                                aspectRatio: imageAspectRatio,
                                                size: imageSize,
                                                negativePrompt: imageNegativePrompt || undefined,
                                                isImagen4: isImagen4Model,
                                                seed: selectedSeed || undefined,
                                            };
                                            // Pass generation_type_override when in video conversation with image mode
                                            const typeOverride = isVideoConversation && generationMode === "image" ? "image" as const : undefined;
                                            sendMessage(content, files, undefined, imgSettings, typeOverride, noContext);
                                            // Clear selected seed and prompt after use
                                            if (selectedSeed) {
                                                setSelectedSeed(null);
                                                setSeedPrompt(null);
                                            }
                                        } else {
                                            // Text generation - pass noContext parameter
                                            sendMessage(content, files, undefined, undefined, undefined, noContext);
                                        }
                                        // Clear selected images after sending
                                        setSelectedConversationImages([]);
                                        setReuseImages([]);
                                    }}
                                    disabled={isSending || !currentModelInfo?.id}
                                    supportsFiles={isTextConversation || isImageConversation || (isVideoConversation && generationMode === "image")}
                                    preselectedImages={[
                                        ...reuseImages.map(url => ({ url })),
                                        ...selectedConversationImages.map(url => ({ url })),
                                    ]}
                                    onRemovePreselectedImage={(url) => {
                                        setSelectedConversationImages(prev => prev.filter(u => u !== url));
                                        setReuseImages(prev => prev.filter(u => u !== url));
                                    }}
                                    initialValue={seedPrompt || reusePrompt || undefined}
                                    onInitialValueUsed={() => { setSeedPrompt(null); setReusePrompt(null); }}
                                    showNoContextOption={true}
                                />
                            </div>
                        )
                    )}
                    </div>
                </div>
            ) : (
                /* Welcome Screen - Project Grid */
                <div className="flex-1 overflow-y-auto p-8">
                    <div className="max-w-5xl mx-auto">
                        <h2 className="text-2xl font-bold mb-2">Selecciona un proyecto</h2>
                        <p className="text-muted-foreground mb-8">
                            Elige un proyecto para comenzar a generar contenido
                        </p>

                        {projects.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-16">
                                <FolderKanban className="h-16 w-16 text-muted-foreground/30 mb-4"/>
                                <p className="text-muted-foreground">No tienes proyectos asignados</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                                {projects.map((project) => (
                                    <button
                                        key={project.id}
                                        onClick={() => setSelectedProjectId(project.id)}
                                        className="group flex flex-col items-center p-4 rounded-xl border border-border/50 bg-card hover:bg-accent hover:border-primary/50 transition-all text-left"
                                    >
                                        {/* Brand logo or folder icon */}
                                        <div className="relative mb-3">
                                            {project.client_logo ? (
                                                <img
                                                    src={project.client_logo}
                                                    alt={project.client_name || ""}
                                                    className="w-[200px] border rounded-md border-[#999] object-contain  transition-opacity"
                                                />
                                            ) : (
                                                <Folder className="h-16 w-16 text-primary/70 group-hover:text-primary transition-colors fill-primary/10 group-hover:fill-primary/20" />
                                            )}
                                            {project.generation_count > 0 && (
                                                <div className="absolute -top-5 -right-5 bg-primary text-primary-foreground text-[12px] font-bold rounded-full h-[40px] w-[40px] flex items-center justify-center px-1">
                                                    {project.generation_count > 999 ? "999+" : project.generation_count}
                                                </div>
                                            )}
                                        </div>

                                        {/* Project name */}
                                        <h3 className="font-medium text-md text-center truncate w-full group-hover:text-primary transition-colors">
                                            {project.title}
                                        </h3>


                                    </button>
                                ))}
                            </div>
                        )}

                        {/* Calculator Button */}
                        {hasCalculatorAccess && (
                            <div className="mt-8">
                                <Link
                                    href="/calculadora"
                                    className="inline-flex items-center gap-3 px-6 py-4 rounded-xl border border-border/50 bg-card hover:bg-accent hover:border-primary/50 transition-all"
                                >
                                    <Calculator className="h-6 w-6 text-primary" />
                                    <div>
                                        <h3 className="font-medium text-md">Calculadora IA</h3>
                                        <p className="text-sm text-muted-foreground">Presupuestos y cotizaciones</p>
                                    </div>
                                </Link>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Right Sidebar - Settings (solo visible con conversación activa, no galería, no audio) */}
            {selectedProjectId && rightSidebarOpen && activeTabId !== null && !activeTab?.isGallery && !isAudioConversation && (
                <div className="w-72 border-l border-border/50 bg-sidebar overflow-y-auto relative">
                    {/* Close button */}
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setRightSidebarOpen(false)}
                        className="absolute top-2 left-2 h-7 w-7 text-muted-foreground hover:text-foreground z-10"
                        title="Cerrar panel"
                    >
                        <PanelRightClose className="h-4 w-4"/>
                    </Button>

                    <div className="p-4 pt-10 space-y-6">
                        {/* Archived indicator */}
                        {activeTab?.isArchived && (
                            <div className="flex items-center gap-2 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg text-orange-400 text-sm">
                                <Archive className="h-4 w-4"/>
                                <span>Conversación archivada</span>
                            </div>
                        )}

                        {/* Model & Quality Selector */}
                        <div className="space-y-3">
                            <div>
                                <label className="text-sm font-medium mb-2 block">Modelo</label>
                                <div className="bg-card border border-border/30 rounded-lg px-3 py-2 text-sm">
                                    {currentModelInfo?.name || "Sin modelo asignado"}
                                </div>
                            </div>

                            {/* Quality Selector - only show if not archived and has both models */}
                            {!activeTab?.isArchived && currentTypeConfig && (currentTypeConfig.model_normal_id || currentTypeConfig.model_hq_id) && (
                                <div>
                                    <label className="text-sm font-medium mb-2 block">Calidad</label>
                                    <QualitySelectorCompact
                                        selectedQuality={selectedQualityTier}
                                        onSelect={setSelectedQualityTier}
                                        disabled={isSending || messages.length > 0}
                                        normalModelName={currentTypeConfig?.model_normal_name}
                                        hqModelName={currentTypeConfig?.model_hq_name}
                                    />
                                    {messages.length > 0 && (
                                        <p className="text-xs text-muted-foreground mt-1">
                                            La calidad no se puede cambiar después del primer mensaje
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Generation Type Badge */}
                            {currentConversation?.generation_type && (
                                <div>
                                    <label className="text-sm font-medium mb-2 block">Tipo</label>
                                    <GenerationTypeBadge type={currentConversation.generation_type} />
                                </div>
                            )}
                        </div>

                        {/* System Instruction */}
                        <div>
                            <label className="text-sm font-medium mb-2 flex items-center gap-2">
                                Instrucción del sistema
                                {(messages.length > 0 || activeTab?.isArchived) &&
                                    <Lock className="h-3 w-3 text-muted-foreground"/>}
                            </label>
                            {!activeTab?.isArchived && messages.length === 0 ? (
                                <textarea
                                    value={systemInstruction}
                                    onChange={(e) => setSystemInstruction(e.target.value)}
                                    onBlur={(e) => handleSettingChange("system_instruction", e.target.value)}
                                    placeholder="Eres un asistente útil..."
                                    rows={4}
                                    disabled={isSending}
                                    className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm resize-none disabled:opacity-50"
                                />
                            ) : (
                                <>
                                    {systemInstruction ? (
                                        <div className="bg-card border border-border/30 rounded-lg px-3 py-2 text-sm">
                                            <p className="text-muted-foreground whitespace-pre-wrap">
                                                {systemInstruction}
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="bg-card border border-border/30 rounded-lg px-3 py-2 text-sm">
                                            <p className="text-muted-foreground/50 italic">Sin instrucción adicional</p>
                                        </div>
                                    )}
                                    {!activeTab?.isArchived && (
                                        <p className="text-xs text-muted-foreground mt-2">
                                            Para cambiar el system instruction, inicia una nueva conversación.
                                        </p>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Image Generation Settings - Only show for image conversations */}
                        {isImageConversation && !activeTab?.isArchived && (
                            <div className="space-y-4 p-4 bg-card rounded-lg border border-border/50">
                                {isImagen4Model ? (
                                    /* Imagen 4 specific settings with more options */
                                    <ImageSettings
                                        aspectRatio={imageAspectRatio as ImagenAspectRatio}
                                        resolution={imageSize as ImagenResolution}
                                        negativePrompt={imageNegativePrompt}
                                        disabled={isSending}
                                        onChange={(settings) => {
                                            if (settings.aspectRatio !== undefined) {
                                                setImageAspectRatio(settings.aspectRatio);
                                                handleSettingChange("image_aspect_ratio", settings.aspectRatio);
                                            }
                                            if (settings.resolution !== undefined) {
                                                setImageSize(settings.resolution);
                                                handleSettingChange("image_size", settings.resolution);
                                            }
                                            if (settings.negativePrompt !== undefined) {
                                                setImageNegativePrompt(settings.negativePrompt);
                                            }
                                        }}
                                    />
                                ) : (
                                    /* Gemini native image settings */
                                    <>
                                        <div className="flex items-center gap-2 text-sm font-medium">
                                            <ImageIcon className="h-4 w-4 text-primary"/>
                                            Generacion de Imagenes
                                        </div>

                                        {/* Aspect Ratio */}
                                        <div>
                                            <label className="text-xs text-muted-foreground mb-2 block">
                                                Relacion de aspecto
                                            </label>
                                            <select
                                                className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                                                value={imageAspectRatio}
                                                onChange={(e) => handleSettingChange("image_aspect_ratio", e.target.value)}
                                                disabled={isSending}
                                            >
                                                <option value="16:9">16:9 (Panoramico)</option>
                                                <option value="1:1">1:1 (Cuadrado)</option>
                                                <option value="9:16">9:16 (Movil vertical)</option>
                                                <option value="4:3">4:3 (Paisaje)</option>
                                                <option value="3:4">3:4 (Retrato)</option>
                                                <option value="3:2">3:2 (Paisaje)</option>
                                                <option value="2:3">2:3 (Retrato)</option>
                                                <option value="21:9">21:9 (Ultra panoramico)</option>
                                            </select>
                                        </div>

                                        {/* Image Size */}
                                        <div>
                                            <label className="text-xs text-muted-foreground mb-2 block">
                                                Tamano de imagen
                                            </label>
                                            <select
                                                className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                                                value={imageSize}
                                                onChange={(e) => handleSettingChange("image_size", e.target.value)}
                                                disabled={isSending}
                                            >
                                                <option value="1K">1K (Estandar)</option>
                                                <option value="2K">2K (Alta definicion)</option>
                                                <option value="4K">4K (Ultra alta definicion)</option>
                                            </select>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Video Generation Settings - Only show for video conversations in video mode */}
                        {isVideoConversation && !activeTab?.isArchived && generationMode === "video" && (
                            <div className="space-y-4 p-4 bg-card rounded-lg border border-border/50">
                                <VideoSettings
                                    duration={videoDuration}
                                    resolution={videoResolution}
                                    aspectRatio={videoAspectRatio}
                                    audioEnabled={videoAudioEnabled}
                                    negativePrompt={videoNegativePrompt}
                                    disabled={isSending}
                                    hasReferenceImages={videoReferenceImages.length > 0}
                                    onChange={(settings) => {
                                        if (settings.duration !== undefined) {
                                            setVideoDuration(settings.duration);
                                            handleSettingChange("video_duration", settings.duration);
                                        }
                                        if (settings.resolution !== undefined) {
                                            setVideoResolution(settings.resolution);
                                            handleSettingChange("video_resolution", settings.resolution);
                                        }
                                        if (settings.aspectRatio !== undefined) {
                                            setVideoAspectRatio(settings.aspectRatio);
                                            handleSettingChange("video_aspect_ratio", settings.aspectRatio);
                                        }
                                        if (settings.audioEnabled !== undefined) {
                                            setVideoAudioEnabled(settings.audioEnabled);
                                            handleSettingChange("video_audio_enabled", settings.audioEnabled);
                                        }
                                        if (settings.negativePrompt !== undefined) {
                                            setVideoNegativePrompt(settings.negativePrompt);
                                            handleSettingChange("video_negative_prompt", settings.negativePrompt);
                                        }
                                    }}
                                />
                            </div>
                        )}

                        {/* Video Input Frames - Only show for video conversations in video mode */}
                        {isVideoConversation && !activeTab?.isArchived && generationMode === "video" && (
                            <div className="space-y-4 p-4 bg-card rounded-lg border border-border/50">
                                <VideoInputFrames
                                    projectId={selectedProjectId!}
                                    firstFrame={videoFirstFrame}
                                    lastFrame={videoLastFrame}
                                    referenceImages={videoReferenceImages}
                                    onFirstFrameChange={setVideoFirstFrame}
                                    onLastFrameChange={setVideoLastFrame}
                                    onReferenceImagesChange={setVideoReferenceImages}
                                    disabled={isSending}
                                    supportsReferenceImages={true}
                                />
                            </div>
                        )}

                        {/* Audio Settings removed from sidebar - now integrated in TTSComposer in center */}

                        {/* Image Settings when video conversation is in image mode */}
                        {isVideoConversation && !activeTab?.isArchived && generationMode === "image" && (
                            <div className="space-y-4 p-4 bg-card rounded-lg border border-border/50">
                                {isImagen4Model ? (
                                    /* Imagen 4 specific settings */
                                    <ImageSettings
                                        aspectRatio={imageAspectRatio as ImagenAspectRatio}
                                        resolution={imageSize as ImagenResolution}
                                        negativePrompt={imageNegativePrompt}
                                        disabled={isSending}
                                        onChange={(settings) => {
                                            if (settings.aspectRatio !== undefined) {
                                                setImageAspectRatio(settings.aspectRatio);
                                            }
                                            if (settings.resolution !== undefined) {
                                                setImageSize(settings.resolution);
                                            }
                                            if (settings.negativePrompt !== undefined) {
                                                setImageNegativePrompt(settings.negativePrompt);
                                            }
                                        }}
                                    />
                                ) : (
                                    /* Gemini native image settings */
                                    <>
                                        <div className="flex items-center gap-2 text-sm font-medium">
                                            <ImageIcon className="h-4 w-4 text-primary"/>
                                            Configuracion de Imagen
                                        </div>

                                        {/* Aspect Ratio */}
                                        <div>
                                            <label className="text-xs text-muted-foreground mb-2 block">
                                                Relacion de aspecto
                                            </label>
                                            <select
                                                className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                                                value={imageAspectRatio}
                                                onChange={(e) => setImageAspectRatio(e.target.value)}
                                                disabled={isSending}
                                            >
                                                <option value="16:9">16:9 (Panoramico)</option>
                                                <option value="1:1">1:1 (Cuadrado)</option>
                                                <option value="9:16">9:16 (Movil vertical)</option>
                                                <option value="4:3">4:3 (Paisaje)</option>
                                                <option value="3:4">3:4 (Retrato)</option>
                                                <option value="3:2">3:2 (Paisaje)</option>
                                                <option value="2:3">2:3 (Retrato)</option>
                                                <option value="21:9">21:9 (Ultra panoramico)</option>
                                            </select>
                                        </div>

                                        {/* Image Size */}
                                        <div>
                                            <label className="text-xs text-muted-foreground mb-2 block">
                                                Tamano de imagen
                                            </label>
                                            <select
                                                className="w-full bg-muted border border-border/50 rounded-lg px-3 py-2 text-sm"
                                                value={imageSize}
                                                onChange={(e) => setImageSize(e.target.value)}
                                                disabled={isSending}
                                            >
                                                <option value="1K">1K (Estandar)</option>
                                                <option value="2K">2K (Alta definicion)</option>
                                                <option value="4K">4K (Ultra alta definicion)</option>
                                            </select>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}

                        {/* Advanced Settings Toggle - Only show if not archived */}
                        {!activeTab?.isArchived && (
                            <>
                                <button
                                    onClick={() => setShowAdvanced(!showAdvanced)}
                                    className="flex items-center gap-2 w-full text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                                >
                                    {showAdvanced ? (
                                        <ChevronDown className="h-4 w-4"/>
                                    ) : (
                                        <ChevronRight className="h-4 w-4"/>
                                    )}
                                    <SlidersHorizontal className="h-4 w-4"/>
                                    Avanzado
                                </button>

                                {/* Advanced Settings */}
                                {showAdvanced && (
                                    <div className="space-y-6 pt-2 border-t border-border/50">
                                        {/* Only show sampling params for text/image, not video generation */}
                                        {!(isVideoConversation && generationMode === "video") && (
                                            <>
                                                {/* Temperature */}
                                                <div>
                                                    <div className="flex justify-between mb-2">
                                                        <div className="flex items-center gap-1.5">
                                                            <label className="text-sm font-medium">Temperature</label>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                                                </TooltipTrigger>
                                                                <TooltipContent side="top" className="max-w-[250px]">
                                                                    Controla la aleatoriedad. Valores altos (1.5-2) generan respuestas más creativas y variadas. Valores bajos (0-0.5) producen respuestas más enfocadas y predecibles.
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </div>
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
                                                        <div className="flex items-center gap-1.5">
                                                            <label className="text-sm font-medium">Top P</label>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                                                </TooltipTrigger>
                                                                <TooltipContent side="top" className="max-w-[250px]">
                                                                    Muestreo nucleus. Considera solo los tokens cuya probabilidad acumulada no supere este valor. Menor valor = respuestas más enfocadas y coherentes.
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </div>
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
                                                        <div className="flex items-center gap-1.5">
                                                            <label className="text-sm font-medium">Top K</label>
                                                            <Tooltip>
                                                                <TooltipTrigger asChild>
                                                                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                                                </TooltipTrigger>
                                                                <TooltipContent side="top" className="max-w-[250px]">
                                                                    Limita la selección a los K tokens más probables. Menor valor = respuestas más predecibles. Mayor valor = más diversidad en las respuestas.
                                                                </TooltipContent>
                                                            </Tooltip>
                                                        </div>
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
                                                    <div className="flex items-center gap-1.5 mb-2">
                                                        <label className="text-sm font-medium">Max Output Tokens</label>
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                                                            </TooltipTrigger>
                                                            <TooltipContent side="top" className="max-w-[250px]">
                                                                Límite máximo de tokens en la respuesta. Un token equivale aproximadamente a 4 caracteres. Aumentar permite respuestas más largas.
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    </div>
                                                    <Input
                                                        type="number"
                                                        min="1"
                                                        max="32768"
                                                        value={maxOutputTokens}
                                                        onChange={(e) => setMaxOutputTokens(parseInt(e.target.value) || 8192)}
                                                        onBlur={(e) => handleSettingChange("max_output_tokens", parseInt(e.target.value) || 8192)}
                                                        disabled={isSending}
                                                        className="bg-muted border-border/50"
                                                    />
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* New Conversation Modal */}
            <Dialog open={showNewConversationModal} onOpenChange={setShowNewConversationModal}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>Nueva conversación</DialogTitle>
                        <DialogDescription>
                            Selecciona el tipo de contenido que deseas generar
                        </DialogDescription>
                    </DialogHeader>
                    <div className="py-4">
                        <GenerationTypeSelector
                            enabledTypes={generationConfig.map(c => ({
                                type: c.generation_type,
                                isEnabled: c.is_enabled && !!(
                                    c.generation_type === "audio_hd"
                                        ? c.model_chirp_id
                                        : (c.model_normal_id || c.model_hq_id)
                                ),
                            }))}
                            selectedType={newConversationType}
                            onSelect={setNewConversationType}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setShowNewConversationModal(false)}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={() => {
                                handleNewTab();
                                setShowNewConversationModal(false);
                            }}
                            disabled={!generationConfig.some(c => c.is_enabled && c.generation_type === newConversationType && (
                                c.generation_type === "audio_hd" ? c.model_chirp_id : (c.model_normal_id || c.model_hq_id)
                            ))}
                        >
                            Crear conversación
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Image Viewer Modal */}
            {viewingImageMessage && viewingImageMessage.image_url && !showTopazStudio && (
                <div
                    className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
                    onClick={() => {
                        setViewingImageMessage(null);
                        setViewingImageDimensions(null);
                    }}
                >
                    {/* Top bar with actions */}
                    <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
                        <div className="flex items-center gap-2">
                            {viewingImageDimensions && (
                                <span className="text-sm text-white/70 bg-black/50 px-3 py-1.5 rounded-lg">
                                    {viewingImageDimensions.width} × {viewingImageDimensions.height}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Download button */}
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                        const response = await fetch(viewingImageMessage.image_url!);
                                        const blob = await response.blob();
                                        const url = window.URL.createObjectURL(blob);
                                        const link = document.createElement("a");
                                        link.href = url;
                                        link.download = viewingImageMessage.image_url!.split("/").pop() || "image.png";
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                        window.URL.revokeObjectURL(url);
                                    } catch (err) {
                                        console.error("Error downloading:", err);
                                    }
                                }}
                                className="p-2.5 bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                                title="Descargar imagen"
                            >
                                <Download className="h-5 w-5 text-white" />
                            </button>
                            {/* Topaz Studio button */}
                            {viewingImageDimensions && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowTopazStudio(true);
                                    }}
                                    className="flex items-center gap-2 px-3 py-2 bg-purple-600/80 hover:bg-purple-600 rounded-lg transition-colors"
                                    title="Abrir Topaz Studio"
                                >
                                    <Sparkles className="h-5 w-5 text-white" />
                                    <span className="text-sm font-medium text-white">Topaz Studio</span>
                                </button>
                            )}
                            {/* Close button */}
                            <button
                                onClick={() => {
                                    setViewingImageMessage(null);
                                    setViewingImageDimensions(null);
                                }}
                                className="p-2.5 bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                            >
                                <X className="h-5 w-5 text-white" />
                            </button>
                        </div>
                    </div>
                    <div
                        className="relative max-w-[90vw] max-h-[85vh] flex items-center justify-center mt-16"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <img
                            src={viewingImageMessage.image_url}
                            alt=""
                            className="max-w-full max-h-[85vh] object-contain rounded-lg"
                            onLoad={(e) => {
                                const img = e.target as HTMLImageElement;
                                setViewingImageDimensions({
                                    width: img.naturalWidth,
                                    height: img.naturalHeight,
                                });
                            }}
                        />
                    </div>
                </div>
            )}

            {/* Topaz Studio */}
            {showTopazStudio && viewingImageMessage && viewingImageMessage.image_url && viewingImageDimensions && (
                <TopazStudio
                    imageUrl={viewingImageMessage.image_url}
                    messageId={viewingImageMessage.id}
                    imageDimensions={viewingImageDimensions}
                    onClose={() => setShowTopazStudio(false)}
                />
            )}

            {/* Video Viewer Modal */}
            {viewingVideoMessage && viewingVideoMessage.video_url && !showTopazVideoStudio && (
                <div
                    className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center"
                    onClick={() => setViewingVideoMessage(null)}
                >
                    {/* Top bar with actions */}
                    <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
                        <div className="flex items-center gap-2">
                            {viewingVideoMessage.video_duration && (
                                <span className="text-sm text-white/70 bg-black/50 px-3 py-1.5 rounded-lg">
                                    {Math.floor(viewingVideoMessage.video_duration / 60)}:{String(Math.floor(viewingVideoMessage.video_duration % 60)).padStart(2, '0')}
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {/* Download button */}
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    try {
                                        const response = await fetch(viewingVideoMessage.video_url!);
                                        const blob = await response.blob();
                                        const url = window.URL.createObjectURL(blob);
                                        const link = document.createElement("a");
                                        link.href = url;
                                        link.download = viewingVideoMessage.video_url!.split("/").pop() || "video.mp4";
                                        document.body.appendChild(link);
                                        link.click();
                                        document.body.removeChild(link);
                                        window.URL.revokeObjectURL(url);
                                    } catch (err) {
                                        console.error("Error downloading:", err);
                                    }
                                }}
                                className="p-2.5 bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                                title="Descargar video"
                            >
                                <Download className="h-5 w-5 text-white" />
                            </button>
                            {/* Topaz Video Studio button */}
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setShowTopazVideoStudio(true);
                                }}
                                className="flex items-center gap-2 px-3 py-2 bg-purple-600/80 hover:bg-purple-600 rounded-lg transition-colors"
                                title="Abrir Topaz Video Studio"
                            >
                                <Sparkles className="h-5 w-5 text-white" />
                                <span className="text-sm font-medium text-white">Topaz Video</span>
                            </button>
                            {/* Close button */}
                            <button
                                onClick={() => setViewingVideoMessage(null)}
                                className="p-2.5 bg-black/50 hover:bg-black/70 rounded-lg transition-colors"
                            >
                                <X className="h-5 w-5 text-white" />
                            </button>
                        </div>
                    </div>
                    <div
                        className="relative max-w-[90vw] max-h-[85vh] flex items-center justify-center mt-16"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <video
                            src={viewingVideoMessage.video_url}
                            className="max-w-full max-h-[85vh] object-contain rounded-lg"
                            controls
                            playsInline
                        />
                    </div>
                </div>
            )}

            {/* Topaz Video Studio */}
            {showTopazVideoStudio && viewingVideoMessage && viewingVideoMessage.video_url && (
                <TopazStudioVideo
                    videoUrl={viewingVideoMessage.video_url}
                    messageId={viewingVideoMessage.id}
                    videoMetadata={{
                        duration: viewingVideoMessage.video_duration || 0,
                    }}
                    onClose={() => setShowTopazVideoStudio(false)}
                />
            )}

            {/* Changelog Modal */}
            {pendingChangelog && (
                <ChangelogModal
                    changelog={pendingChangelog}
                    onClose={() => setPendingChangelog(null)}
                />
            )}
        </div>
    );
}
