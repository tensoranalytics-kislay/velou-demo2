'use client';

import { useState, useRef, useEffect } from 'react';
import ChatPanel from './ChatPanel';
import SuggestedPrompts from './SuggestedPrompts';

export default function ChatWidget() {
  // Load saved position and size from localStorage
  const loadSavedState = () => {
    if (typeof window === 'undefined') {
      return { width: 540, height: 600, top: 0, left: 0 };
    }
    try {
      const saved = localStorage.getItem('chatWidgetState');
      if (saved) {
        const parsed = JSON.parse(saved);
        return {
          width: parsed.width || 540,
          height: parsed.height || 600,
          top: parsed.top || 0,
          left: parsed.left || 0,
        };
      }
    } catch (e) {
      console.error('Failed to load chat widget state:', e);
    }
    // Default: bottom right corner
    if (typeof window !== 'undefined') {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const initialWidth = Math.min(540, vw - 48);
      const initialHeight = Math.min(600, vh - 48);
      return {
        width: initialWidth,
        height: initialHeight,
        top: vh - initialHeight - 24,
        left: vw - initialWidth - 24,
      };
    }
    return { width: 540, height: 600, top: 0, left: 0 };
  };

  const savedState = loadSavedState();
  const [isOpen, setIsOpen] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: savedState.width, height: savedState.height });
  const [position, setPosition] = useState({ top: savedState.top, left: savedState.left });
  const [brandName, setBrandName] = useState('our store');
  const [vertical, setVertical] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/brand-info')
      .then((res) => res.json())
      .then((data) => {
        if (data.brandName) setBrandName(data.brandName);
        if (data.vertical) setVertical(data.vertical);
      })
      .catch(() => {
        // Keep defaults on error
      });
  }, []);

  const assistantTitle = vertical === 'skincare' || vertical === 'beauty'
    ? `${brandName} beauty assistant`
    : vertical === 'home' || vertical === 'home decor'
    ? `${brandName} home assistant`
    : `${brandName} stylist`;

  const assistantSubtitle = vertical === 'skincare' || vertical === 'beauty'
    ? 'Beauty guidance'
    : vertical === 'home' || vertical === 'home decor'
    ? 'Home styling'
    : 'Always-on outfit guidance';

  // Save state to localStorage whenever position or size changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(
          'chatWidgetState',
          JSON.stringify({
            width: windowSize.width,
            height: windowSize.height,
            top: position.top,
            left: position.left,
          })
        );
      } catch (e) {
        console.error('Failed to save chat widget state:', e);
      }
    }
  }, [windowSize, position]);

  const windowRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const resizeDirectionRef = useRef<string | null>(null);
  const startPosRef = useRef({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0 });
  const [showDragHint, setShowDragHint] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDraggingRef.current) {
        // Handle dragging - move the window
        const deltaX = e.clientX - startPosRef.current.x;
        const deltaY = e.clientY - startPosRef.current.y;
        
        const newTop = startPosRef.current.top + deltaY;
        const newLeft = startPosRef.current.left + deltaX;
        
        // Constrain to viewport bounds
        const constrainedTop = Math.max(0, Math.min(window.innerHeight - startPosRef.current.height, newTop));
        const constrainedLeft = Math.max(0, Math.min(window.innerWidth - startPosRef.current.width, newLeft));
        
        setPosition({ top: constrainedTop, left: constrainedLeft });
        return;
      }

      if (!isResizingRef.current || !windowRef.current || !resizeDirectionRef.current) return;

      const direction = resizeDirectionRef.current;
      const deltaX = e.clientX - startPosRef.current.x;
      const deltaY = e.clientY - startPosRef.current.y;
      
      let newWidth = startPosRef.current.width;
      let newHeight = startPosRef.current.height;
      let newTop = startPosRef.current.top;
      let newLeft = startPosRef.current.left;

      // Handle horizontal resizing
      if (direction.includes('e')) {
        // Right edge or corners - keep left edge fixed
        newWidth = Math.max(320, Math.min(window.innerWidth - startPosRef.current.left, startPosRef.current.width + deltaX));
      } else if (direction.includes('w')) {
        // Left edge or corners - keep right edge fixed
        const widthDelta = startPosRef.current.x - e.clientX;
        newWidth = Math.max(320, Math.min(startPosRef.current.width + widthDelta, startPosRef.current.left + startPosRef.current.width));
        // Adjust left position to keep right edge fixed
        newLeft = startPosRef.current.left + startPosRef.current.width - newWidth;
      }

      // Handle vertical resizing
      if (direction.includes('s')) {
        // Bottom edge or corners - keep top edge fixed
        newHeight = Math.max(320, Math.min(window.innerHeight - startPosRef.current.top, startPosRef.current.height + deltaY));
      } else if (direction.includes('n')) {
        // Top edge or corners - keep bottom edge fixed
        const heightDelta = startPosRef.current.y - e.clientY;
        newHeight = Math.max(320, Math.min(startPosRef.current.height + heightDelta, startPosRef.current.top + startPosRef.current.height));
        // Adjust top position to keep bottom edge fixed
        newTop = startPosRef.current.top + startPosRef.current.height - newHeight;
      }

      // Constrain to viewport
      if (newLeft < 0) {
        newWidth += newLeft;
        newLeft = 0;
      }
      if (newTop < 0) {
        newHeight += newTop;
        newTop = 0;
      }
      if (newLeft + newWidth > window.innerWidth) {
        newWidth = window.innerWidth - newLeft;
      }
      if (newTop + newHeight > window.innerHeight) {
        newHeight = window.innerHeight - newTop;
      }

      setWindowSize({ width: Math.max(320, newWidth), height: Math.max(320, newHeight) });
      setPosition({ top: Math.max(0, newTop), left: Math.max(0, newLeft) });
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      isDraggingRef.current = false;
      resizeDirectionRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  const handleResizeStart = (e: React.MouseEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!windowRef.current) return;

    const rect = windowRef.current.getBoundingClientRect();
    isResizingRef.current = true;
    isDraggingRef.current = false; // Ensure we're not dragging
    resizeDirectionRef.current = direction;
    startPosRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
    };
  };

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!windowRef.current) return;

    const rect = windowRef.current.getBoundingClientRect();
    isDraggingRef.current = true;
    isResizingRef.current = false; // Ensure we're not resizing
    resizeDirectionRef.current = null;
    startPosRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: rect.width,
      height: rect.height,
      top: rect.top,
      left: rect.left,
    };
  };

  return (
    <>
      {/* Floating chat button + vertical suggestion pills when closed */}
      {!isOpen && (
        <>
          <div className="fixed bottom-20 right-4 z-40 flex flex-col items-end">
            <SuggestedPrompts
              orientation="column"
              onSelect={(prompt) => {
                // Store the prompt so ChatPanel can pick it up on mount
                if (typeof window !== 'undefined') {
                  try {
                    window.localStorage.setItem('velou_external_prompt', prompt);
                  } catch {
                    // ignore storage errors
                  }
                }
                setIsOpen(true);
              }}
              lastUserMessage={null}
            />
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(true)}
            className="fixed bottom-3 right-3 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-rose-500 text-white shadow-lg shadow-rose-300 transition hover:bg-rose-600 md:bottom-4 md:right-4 md:h-14 md:w-14"
            aria-label={`Open ${assistantTitle}`}
          >
            <svg className="h-6 w-6 md:h-7 md:w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
              />
            </svg>
          </button>
        </>
      )}

      {/* Chat window overlay */}
      {isOpen && (
        <div
          ref={windowRef}
          className="fixed z-50"
          style={{
            top: `${position.top}px`,
            left: `${position.left}px`,
            width: `${windowSize.width}px`,
            height: `${windowSize.height}px`,
            maxWidth: '100vw',
            maxHeight: '100vh',
            minWidth: '320px',
            minHeight: '320px',
          }}
        >
          {/* Visible drag pill - positioned outside overflow container */}
          <div
            className="absolute left-1/2 z-[70] cursor-move"
            style={{
              top: '-17px',
              transform: 'translateX(-50%)',
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              handleDragStart(e);
            }}
          >
            <div className="rounded-full border border-rose-200/60 bg-white p-2 shadow-sm pointer-events-none">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="text-rose-500"
              >
                {/* Up arrow */}
                <path d="M12 3L9 7H15L12 3Z" fill="currentColor" />
                {/* Down arrow */}
                <path d="M12 21L9 17H15L12 21Z" fill="currentColor" />
                {/* Left arrow */}
                <path d="M3 12L7 9V15L3 12L3 12Z" fill="currentColor" />
                {/* Right arrow */}
                <path d="M21 12L17 9V15L21 12Z" fill="currentColor" />
                {/* Center circle */}
                <circle cx="12" cy="12" r="2" fill="currentColor" />
              </svg>
            </div>
          </div>
          {/* Chat window content container with overflow hidden */}
          <div
            className="flex flex-col rounded-2xl border border-rose-100 bg-white text-slate-900 shadow-2xl shadow-rose-100/80 backdrop-blur-xl overscroll-contain overflow-hidden h-full"
          >
          {/* Resize handles - all edges and corners */}
          {/* Top-left corner */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 'nw')}
            className="absolute top-0 left-0 w-6 h-6 cursor-nwse-resize z-50"
          />
          {/* Top edge - entire edge allows resizing */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 'n')}
            className="absolute top-0 left-6 right-6 h-6 cursor-ns-resize z-50"
          />
          {/* Top-right corner */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 'ne')}
            className="absolute top-0 right-0 w-6 h-6 cursor-nesw-resize z-50"
          />
          {/* Right edge */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 'e')}
            className="absolute top-6 right-0 bottom-6 w-6 cursor-ew-resize z-50"
          />
          {/* Bottom-right corner */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 'se')}
            className="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize z-50"
          />
          {/* Bottom edge */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 's')}
            className="absolute bottom-0 left-6 right-6 h-6 cursor-ns-resize z-50"
          />
          {/* Bottom-left corner */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 'sw')}
            className="absolute bottom-0 left-0 w-6 h-6 cursor-nesw-resize z-50"
          />
          {/* Left edge */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 'w')}
            className="absolute top-6 left-0 bottom-6 w-6 cursor-ew-resize z-50"
          />
          {/* Header */}
          <div className="flex items-center justify-between border-b border-rose-100 bg-rose-50 px-3 py-2 sm:px-4 sm:py-3 relative z-10 rounded-t-2xl">
            <div className="flex-1 min-w-0">
              <h3 className="text-xs sm:text-sm font-semibold text-rose-600 truncate">{assistantTitle}</h3>
              <p className="text-[10px] sm:text-xs text-slate-500 truncate">{assistantSubtitle}</p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-slate-400">
                <span className="font-medium">powered by</span>
                <img
                  src="/velou-logo.webp"
                  alt="Velou"
                  className="h-3.5 w-auto opacity-70"
                />
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="rounded-full p-1.5 text-slate-500 transition hover:bg-rose-100 hover:text-rose-600"
                aria-label="Close chat"
              >
                <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          </div>

          {/* Chat panel body */}
          <div className="flex-1 min-h-0 flex flex-col overscroll-contain overflow-hidden">
            <ChatPanel />
          </div>
          </div>
        </div>
      )}
    </>
  );
}
