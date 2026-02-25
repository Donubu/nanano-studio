'use client';

import { createContext, useContext, useCallback, useEffect, useRef, useState, ReactNode } from 'react';

// Generate slug from any title/name
export function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove accents
    .replace(/[^a-z0-9]+/g, '-')     // Replace non-alphanumeric with dashes
    .replace(/^-+|-+$/g, '')         // Remove leading/trailing dashes
    || 'item';
}

export type NavigationType = 'base' | 'gallery' | 'generation' | 'topaz' | 'conversation' | 'chat-image';

export interface NavigationState {
  path: string;
  type: NavigationType;
  clientSlug?: string;
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
  clientSlug: string | null;
  projectSlug: string | null;
  initialState: NavigationState | null; // State parsed from initial URL for deep linking
  setClientSlug: (slug: string | null, useReplace?: boolean) => void;
  setProjectSlug: (slug: string | null, useReplace?: boolean) => void;
  push: (path: string, onClose: () => void) => void;
  replace: (path: string) => void;
  back: () => void;
  onClientChange: (callback: (slug: string | null) => void) => () => void;
  onProjectChange: (callback: (slug: string | null) => void) => () => void;
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

  // First part is always clientSlug
  const clientSlug = parts[0];

  if (parts.length === 1) {
    // /{client}/ - client selected, no project yet
    return { path, type: 'base', clientSlug };
  }

  // Second part is projectSlug
  const projectSlug = parts[1];

  // /{client}/{project}/gallery/{id}/topaz
  if (parts.length >= 5 && parts[2] === 'gallery' && parts[4] === 'topaz') {
    const id = parseInt(parts[3]);
    return { path, type: 'topaz', clientSlug, projectSlug, id };
  }

  // /{client}/{project}/gallery/{id}
  if (parts.length >= 4 && parts[2] === 'gallery') {
    const id = parseInt(parts[3]);
    return { path, type: 'generation', clientSlug, projectSlug, id };
  }

  // /{client}/{project}/gallery
  if (parts.length >= 3 && parts[2] === 'gallery') {
    return { path, type: 'gallery', clientSlug, projectSlug };
  }

  // /{client}/{project}/conversation/{id}
  if (parts.length >= 4 && parts[2] === 'conversation') {
    const id = parseInt(parts[3]);
    return { path, type: 'conversation', clientSlug, projectSlug, id };
  }

  // /{client}/{project}/chat/{id}
  if (parts.length >= 4 && parts[2] === 'chat') {
    const id = parseInt(parts[3]);
    return { path, type: 'chat-image', clientSlug, projectSlug, id };
  }

  // /{client}/{project}/ - base view for project
  return { path, type: 'base', clientSlug, projectSlug };
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const layersRef = useRef<NavigationLayer[]>([]);
  const [currentPath, setCurrentPath] = useState('/');
  const [clientSlug, setClientSlugState] = useState<string | null>(null);
  const [projectSlug, setProjectSlugState] = useState<string | null>(null);
  const [initialState, setInitialState] = useState<NavigationState | null>(null);
  const isHandlingPopState = useRef(false);
  const clientSlugRef = useRef<string | null>(null);
  const projectSlugRef = useRef<string | null>(null);
  const clientChangeCallbacksRef = useRef<Set<(slug: string | null) => void>>(new Set());
  const projectChangeCallbacksRef = useRef<Set<(slug: string | null) => void>>(new Set());

  const clearInitialState = useCallback(() => {
    setInitialState(null);
  }, []);

  const onClientChange = useCallback((callback: (slug: string | null) => void) => {
    clientChangeCallbacksRef.current.add(callback);
    return () => {
      clientChangeCallbacksRef.current.delete(callback);
    };
  }, []);

  const onProjectChange = useCallback((callback: (slug: string | null) => void) => {
    projectChangeCallbacksRef.current.add(callback);
    return () => {
      projectChangeCallbacksRef.current.delete(callback);
    };
  }, []);

  const setClientSlug = useCallback((slug: string | null, useReplace: boolean = false) => {
    if (clientSlugRef.current === slug) return;

    clientSlugRef.current = slug;
    setClientSlugState(slug);

    // When client changes, clear project
    projectSlugRef.current = null;
    setProjectSlugState(null);

    if (typeof window !== 'undefined') {
      const historyMethod = useReplace ? history.replaceState.bind(history) : history.pushState.bind(history);

      if (!slug) {
        historyMethod({ path: '/', type: 'base' }, '', '/');
        setCurrentPath('/');
        return;
      }

      const newPath = `/${slug}`;
      const state = parsePath(newPath);
      historyMethod(state, '', newPath);
      setCurrentPath(newPath);
    }
  }, []);

  const setProjectSlug = useCallback((slug: string | null, useReplace: boolean = false) => {
    if (projectSlugRef.current === slug) return;

    projectSlugRef.current = slug;
    setProjectSlugState(slug);

    if (typeof window !== 'undefined') {
      const historyMethod = useReplace ? history.replaceState.bind(history) : history.pushState.bind(history);

      if (!slug) {
        // Go back to client level
        if (clientSlugRef.current) {
          const newPath = `/${clientSlugRef.current}`;
          const state = parsePath(newPath);
          historyMethod(state, '', newPath);
          setCurrentPath(newPath);
        } else {
          historyMethod({ path: '/', type: 'base' }, '', '/');
          setCurrentPath('/');
        }
        return;
      }

      if (clientSlugRef.current) {
        const currentPathname = window.location.pathname;
        const currentState = parsePath(currentPathname);

        // Only update URL if needed
        if (!currentState.projectSlug || currentState.projectSlug !== slug) {
          const newPath = `/${clientSlugRef.current}/${slug}`;
          const state = parsePath(newPath);
          historyMethod(state, '', newPath);
          setCurrentPath(newPath);
        }
      }
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

  // Helper methods - now prefix with /{clientSlug}/{projectSlug}/...
  const openGallery = useCallback((onClose: () => void) => {
    if (!clientSlug || !projectSlug) return;
    push(`/${clientSlug}/${projectSlug}/gallery`, onClose);
  }, [clientSlug, projectSlug, push]);

  const openGeneration = useCallback((generationId: number, onClose: () => void) => {
    if (!clientSlug || !projectSlug) return;
    push(`/${clientSlug}/${projectSlug}/gallery/${generationId}`, onClose);
  }, [clientSlug, projectSlug, push]);

  const openTopaz = useCallback((generationId: number, onClose: () => void) => {
    if (!clientSlug || !projectSlug) return;
    push(`/${clientSlug}/${projectSlug}/gallery/${generationId}/topaz`, onClose);
  }, [clientSlug, projectSlug, push]);

  const openConversation = useCallback((conversationId: number, onClose: () => void) => {
    if (!clientSlug || !projectSlug) return;
    push(`/${clientSlug}/${projectSlug}/conversation/${conversationId}`, onClose);
  }, [clientSlug, projectSlug, push]);

  const openChatImage = useCallback((messageId: number, onClose: () => void) => {
    if (!clientSlug || !projectSlug) return;
    push(`/${clientSlug}/${projectSlug}/chat/${messageId}`, onClose);
  }, [clientSlug, projectSlug, push]);

  // Handle browser back/forward and Escape key
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handlePopState = () => {
      isHandlingPopState.current = true;

      const newPath = window.location.pathname;
      const newState = parsePath(newPath);
      const newClientSlug = newState.clientSlug || null;
      const newProjectSlug = newState.projectSlug || null;

      // Check if client changed
      if (clientSlugRef.current !== newClientSlug) {
        clientSlugRef.current = newClientSlug;
        setClientSlugState(newClientSlug);
        clientChangeCallbacksRef.current.forEach(callback => callback(newClientSlug));
      }

      // Check if project changed
      if (projectSlugRef.current !== newProjectSlug) {
        projectSlugRef.current = newProjectSlug;
        setProjectSlugState(newProjectSlug);
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

    // Extract client slug if present
    if (state.clientSlug) {
      clientSlugRef.current = state.clientSlug;
      setClientSlugState(state.clientSlug);
    }

    // Extract project slug if present
    if (state.projectSlug) {
      projectSlugRef.current = state.projectSlug;
      setProjectSlugState(state.projectSlug);
    }

    // Set initial state for deep linking (only if beyond just client level)
    if (state.projectSlug || state.type !== 'base') {
      setInitialState(state);
    }
  }, []);

  return (
    <NavigationContext.Provider value={{
      currentPath,
      clientSlug,
      projectSlug,
      initialState,
      setClientSlug,
      setProjectSlug,
      push,
      replace,
      back,
      onClientChange,
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
