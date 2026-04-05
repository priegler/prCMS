'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useCMSContext } from '../runtime/provider.js';
import { Toolbar } from './Toolbar.js';

/**
 * The editor overlay component. Handles:
 * - Hover highlighting of [data-cms] elements
 * - Click-to-edit via contentEditable
 * - Dirty state tracking
 *
 * Only rendered when isEditing === true.
 */
export function EditorOverlay() {
  const { isEditing, setDirty, content, dirtyKeys } = useCMSContext();
  const [activeElement, setActiveElement] = useState<HTMLElement | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Set up hover highlighting and click-to-edit on all [data-cms] elements
  useEffect(() => {
    if (!isEditing) return;

    const handleMouseOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-cms]') as HTMLElement | null;
      if (!target) return;
      target.style.outline = '2px solid rgba(59, 130, 246, 0.5)';
      target.style.outlineOffset = '2px';
      target.style.cursor = 'pointer';
    };

    const handleMouseOut = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-cms]') as HTMLElement | null;
      if (!target || target === activeElement) return;
      target.style.outline = '';
      target.style.outlineOffset = '';
      target.style.cursor = '';
    };

    const handleClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement).closest('[data-cms]') as HTMLElement | null;
      if (!target) return;

      e.preventDefault();
      e.stopPropagation();

      // Deactivate previous element
      if (activeElement && activeElement !== target) {
        deactivateElement(activeElement);
      }

      activateElement(target);
    };

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver, true);
      document.removeEventListener('mouseout', handleMouseOut, true);
      document.removeEventListener('click', handleClick, true);
    };
  }, [isEditing, activeElement]);

  const activateElement = useCallback((el: HTMLElement) => {
    const key = el.getAttribute('data-cms');
    if (!key) return;

    // Style as actively editing
    el.style.outline = '2px solid rgba(59, 130, 246, 1)';
    el.style.outlineOffset = '2px';

    // For text content, enable contentEditable
    const isTextContent = key.endsWith('#children');
    if (isTextContent) {
      el.contentEditable = 'true';
      el.focus();

      // Store original value for comparison
      if (!el.dataset.cmsOriginal) {
        el.dataset.cmsOriginal = el.textContent ?? '';
      }
    }

    setActiveElement(el);
  }, []);

  const deactivateElement = useCallback((el: HTMLElement) => {
    el.style.outline = '';
    el.style.outlineOffset = '';
    el.style.cursor = '';

    const key = el.getAttribute('data-cms');
    if (!key) return;

    if (el.contentEditable === 'true') {
      el.contentEditable = 'false';
      const newValue = el.textContent ?? '';
      const originalValue = el.dataset.cmsOriginal ?? '';

      if (newValue !== originalValue) {
        setDirty(key, newValue);
      }
      delete el.dataset.cmsOriginal;
    }

    setActiveElement(null);
  }, [setDirty]);

  // Handle Escape to deactivate, Enter to confirm
  useEffect(() => {
    if (!activeElement) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Revert to original
        const original = activeElement.dataset.cmsOriginal;
        if (original !== undefined) {
          activeElement.textContent = original;
        }
        deactivateElement(activeElement);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeElement, deactivateElement]);

  // Handle click outside to deactivate
  useEffect(() => {
    if (!activeElement) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!activeElement.contains(target) && !overlayRef.current?.contains(target)) {
        deactivateElement(activeElement);
      }
    };

    // Delay to avoid catching the activation click
    const timer = setTimeout(() => {
      document.addEventListener('click', handleClickOutside);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('click', handleClickOutside);
    };
  }, [activeElement, deactivateElement]);

  if (!isEditing) return null;

  return (
    <div ref={overlayRef}>
      <Toolbar />
      <style>{EDITOR_STYLES}</style>
    </div>
  );
}

const EDITOR_STYLES = `
  [data-cms][contenteditable="true"] {
    min-height: 1em;
    border-radius: 2px;
    transition: outline-color 0.15s ease;
  }
  [data-cms][contenteditable="true"]:focus {
    outline: 2px solid rgba(59, 130, 246, 1) !important;
    outline-offset: 2px;
  }
`;
