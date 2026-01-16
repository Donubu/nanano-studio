'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode } from 'react';

// Generate slug from project title
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '-')     // Replace non-alphanumeric with dashes
    .replace(/^-+|-+$/g, '')         // Remove leading/trailing dashes
    || 'project';
}

export type NavigationType = 'base' | 'gallery' | 'generation' | 'topaz' | 'conversation' | 'chat-image';

export interface NavigationState {
  path: string;
  type: NavigationType;
  projectSlug?: string;
  id?: number;
}

interface NavigationLayer {
  state: NavigationState;
  onClose: () => void;
  hasHistoryEntry: boolean; // true if pushed, false if just registered
}

interface NavigationContextType {
  currentPath: string;
  projectSlug: string | null;
  initialState: NavigationState | null; // State parsed from initial URL for deep linking
  setProjectSlug: (slug: string | null, useReplace?: boolean) => void;
  push: (path: string, onClose: () => void) => void;
  replace: (path: string) => void;
  back: () => void;
  onProjectChange: (callback: (slug: string | null) => void) => () => void; // Subscribe to project changes from popstate
  // Register a close callback without pushing to history (for deep linking)
  registerLayer: (onClose: () => void) => void;
  // Helper methods for common routes
  openGallery: (onClose: () => void) => void;
  openGeneration: (generationId: number, onClose: () => void) => void;
  openTopaz: (generationId: number, onClose: () => void) => void;
  openConversation: (conversationId: number, onClose: () => void) => void;
  openChatImage: (messageId: number, onClose: () => void) => void;
  clearInitialState: () => void; // Call after handling initial state
}

const NavigationContext = createContext<NavigationContextType | null>(null);

function parsePath(path: string): NavigationState {
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) {
    return { path, type: 'base' };
  }

  const projectSlug = parts[0];

  // /{project}/gallery/{id}/topaz
  if (parts.length >= 4 && parts[1] === 'gallery' && parts[3] === 'topaz') {
    const id = parseInt(parts[2]);
    return { path, type: 'topaz', projectSlug, id };
  }

  // /{project}/gallery/{id}
  if (parts.length >= 3 && parts[1] === 'gallery') {
    const id = parseInt(parts[2]);
    return { path, type: 'generation', projectSlug, id };
  }

  // /{project}/gallery
  if (parts.length >= 2 && parts[1] === 'gallery') {
    return { path, type: 'gallery', projectSlug };
  }

  // /{project}/conversation/{id}
  if (parts.length >= 3 && parts[1] === 'conversation') {
    const id = parseInt(parts[2]);
    return { path, type: 'conversation', projectSlug, id };
  }

  // /{project}/chat/{id}
  if (parts.length >= 3 && parts[1] === 'chat') {
    const id = parseInt(parts[2]);
    return { path, type: 'chat-image', projectSlug, id };
  }

  // /{project}/ - base view for project
  return { path, type: 'base', projectSlug };
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const layersRef = useRef<NavigationLayer[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [projectSlug, setProjectSlugState] = useState<string | null>(null);
  const [initialState, setInitialState] = useState<NavigationState | null>(null);
  const isHandlingPopState = useRef(false);
  const projectSlugRef = useRef<string | null>(null);
  const projectChangeCallbacksRef = useRef<Set<(slug: string | null) => void>>(new Set());

  const clearInitialState = useCallback(() => {
    setInitialState(null);
  }, []);

  const onProjectChange = useCallback((callback: (slug: string | null) => void) => {
    projectChangeCallbacksRef.current.add(callback);
    return () => {
      projectChangeCallbacksRef.current.delete(callback);
    };
  }, []);

  const setProjectSlug = useCallback((slug: string | null, useReplace: boolean = false) => {
    // Avoid unnecessary state updates that cause infinite loops
    if (projectSlugRef.current === slug) return;

    projectSlugRef.current = slug;
    setProjectSlugState(slug);

    if (typeof window !== 'undefined') {
      const historyMethod = useReplace ? history.replaceState.bind(history) : history.pushState.bind(history);

      // Handle clearing the project (deselection)
      if (!slug) {
        historyMethod({ path: '/', type: 'base' }, '', '/');
        setCurrentPath('/');
        return;
      }

      const currentPathname = window.location.pathname;
      const currentState = parsePath(currentPathname);

      // Only update URL if we're at root OR the current path has a different project slug
      if (currentPathname === '/' || (currentState.projectSlug && currentState.projectSlug !== slug)) {
        const state = parsePath(`/${slug}/`);
        historyMethod(state, '', `/${slug}/`);
        setCurrentPath(`/${slug}/`);
      } else if (!currentState.projectSlug) {
        // We're at root, set the project URL
        const state = parsePath(`/${slug}/`);
        historyMethod(state, '', `/${slug}/`);
        setCurrentPath(`/${slug}/`);
      }
      // If we're already on a path with the same project slug, don't change the URL
    }
  }, []);

  const push = useCallback((path: string, onClose: () => void) => {
    if (typeof window === 'undefined') return;

    const state = parsePath(path);
    layersRef.current.push({ state, onClose, hasHistoryEntry: true });
    history.pushState(state, '', path);
    setCurrentPath(path);
  }, []);

  // Register a layer without pushing to history (for deep linking)
  const registerLayer = useCallback((onClose: () => void) => {
    if (typeof window === 'undefined') return;
    const state = parsePath(window.location.pathname);
    layersRef.current.push({ state, onClose, hasHistoryEntry: false });
  }, []);

  const replace = useCallback((path: string) => {
    if (typeof window === 'undefined') return;

    const state = parsePath(path);
    history.replaceState(state, '', path);
    setCurrentPath(path);
  }, []);

  const back = useCallback(() => {
    if (typeof window === 'undefined') return;
    history.back();
  }, []);

  // Helper methods
  const openGallery = useCallback((onClose: () => void) => {
    if (!projectSlug) return;
    push(`/${projectSlug}/gallery`, onClose);
  }, [projectSlug, push]);

  const openGeneration = useCallback((generationId: number, onClose: () => void) => {
    if (!projectSlug) return;
    push(`/${projectSlug}/gallery/${generationId}`, onClose);
  }, [projectSlug, push]);

  const openTopaz = useCallback((generationId: number, onClose: () => void) => {
    if (!projectSlug) return;
    push(`/${projectSlug}/gallery/${generationId}/topaz`, onClose);
  }, [projectSlug, push]);

  const openConversation = useCallback((conversationId: number, onClose: () => void) => {
    if (!projectSlug) return;
    push(`/${projectSlug}/conversation/${conversationId}`, onClose);
  }, [projectSlug, push]);

  const openChatImage = useCallback((messageId: number, onClose: () => void) => {
    if (!projectSlug) return;
    push(`/${projectSlug}/chat/${messageId}`, onClose);
  }, [projectSlug, push]);

  // Handle browser back/forward and Escape key
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      isHandlingPopState.current = true;

      const newPath = window.location.pathname;
      const newState = parsePath(newPath);
      const newProjectSlug = newState.projectSlug || null;

      // Check if project changed
      if (projectSlugRef.current !== newProjectSlug) {
        projectSlugRef.current = newProjectSlug;
        setProjectSlugState(newProjectSlug);
        // Notify subscribers about project change
        projectChangeCallbacksRef.current.forEach(callback => callback(newProjectSlug));
      }

      if (layersRef.current.length > 0) {
        const layer = layersRef.current.pop();
        if (layer) {
          layer.onClose();
        }
      }
      setCurrentPath(newPath);

      // Reset flag after a tick
      setTimeout(() => {
        isHandlingPopState.current = false;
      }, 0);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && layersRef.current.length > 0) {
        e.preventDefault();
        e.stopPropagation();

        const topLayer = layersRef.current[layersRef.current.length - 1];
        if (topLayer.hasHistoryEntry) {
          // Layer has history entry, use browser back
          history.back();
        } else {
          // Layer was registered without history (deep linking)
          // Just close it and update URL
          layersRef.current.pop();
          topLayer.onClose();
          setCurrentPath(window.location.pathname);
        }
      }
    };

    window.addEventListener('popstate', handlePopState);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Initialize with current path
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const path = window.location.pathname;
    setCurrentPath(path);

    // Parse initial state
    const state = parsePath(path);
    history.replaceState(state, '', path);

    // Extract project slug if present
    if (state.projectSlug) {
      projectSlugRef.current = state.projectSlug;
      setProjectSlugState(state.projectSlug);
    }

    // Set initial state for deep linking (only if not base type)
    if (state.type !== 'base') {
      setInitialState(state);
    }
  }, []);

  return (
    <NavigationContext.Provider value={{
      currentPath,
      projectSlug,
      initialState,
      setProjectSlug,
      push,
      replace,
      back,
      onProjectChange,
      registerLayer,
      openGallery,
      openGeneration,
      openTopaz,
      openConversation,
      openChatImage,
      clearInitialState,
    }}>
      {children}
    </NavigationContext.Provider>
  );
}

export function useNavigation() {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
}

// Optional hook - returns null if not in NavigationProvider (for gradual migration)
export function useNavigationOptional() {
  return useContext(NavigationContext);
}
