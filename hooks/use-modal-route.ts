import { useEffect, useRef, useCallback } from 'react';
import { useNavigationOptional } from '@/contexts/navigation-context';

/**
 * Hook to automatically register a modal with the navigation system.
 * When the modal opens, it pushes a route to the history.
 * When the user presses back or Escape, the modal closes.
 *
 * @param isOpen - Whether the modal is currently open
 * @param path - The path to push when the modal opens
 * @param onClose - Callback to close the modal
 */
export function useModalRoute(
  isOpen: boolean,
  path: string,
  onClose: () => void
) {
  const navigation = useNavigationOptional();
  const registeredRef = useRef(false);
  const onCloseRef = useRef(onClose);

  // Keep onClose ref updated
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // If navigation context is not available, skip
    if (!navigation) return;

    if (isOpen && !registeredRef.current) {
      // Modal opened - push route
      navigation.push(path, () => onCloseRef.current());
      registeredRef.current = true;
    } else if (!isOpen && registeredRef.current) {
      // Modal closed programmatically (not via back button)
      // We don't need to do anything here as the layer will be removed
      // when popstate fires or when the component unmounts
      registeredRef.current = false;
    }
  }, [isOpen, path, navigation]);

  // Cleanup on unmount - this shouldn't normally happen
  // as modals should close before unmounting
  useEffect(() => {
    return () => {
      registeredRef.current = false;
    };
  }, []);
}

/**
 * Hook for modals that don't have a specific route but still need
 * to participate in the navigation stack (for Escape key handling)
 */
export function useModalNavigation(
  isOpen: boolean,
  onClose: () => void,
  type: string = 'modal'
) {
  const navigation = useNavigationOptional();
  const registeredRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!navigation) return;

    if (isOpen && !registeredRef.current) {
      // Use current path with a hash or just push state without changing URL
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : '/';
      navigation.push(`${currentPath}#${type}`, () => onCloseRef.current());
      registeredRef.current = true;
    } else if (!isOpen) {
      registeredRef.current = false;
    }
  }, [isOpen, type, navigation]);

  useEffect(() => {
    return () => {
      registeredRef.current = false;
    };
  }, []);
}
