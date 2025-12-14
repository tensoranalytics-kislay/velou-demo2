'use client';

import { useState, useRef, useEffect } from 'react';
import ChatPanel from './ChatPanel';
import SuggestedPrompts from './SuggestedPrompts';
import AssistantAvatar from './AssistantAvatar';

export default function ChatWidget() {
  // Load saved position and size from localStorage
  // Store as percentages for responsive behavior
  const loadSavedState = () => {
    if (typeof window === 'undefined') {
      return { width: 540, height: 600, topPercent: null, leftPercent: null, widthPercent: null, heightPercent: null };
    }
    try {
      const saved = localStorage.getItem('chatWidgetState');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Support both old (pixel) and new (percentage) formats
        if (parsed.topPercent !== undefined) {
          // New format: percentages
          return {
            width: parsed.width || 540,
            height: parsed.height || 600,
            topPercent: parsed.topPercent,
            leftPercent: parsed.leftPercent,
            widthPercent: parsed.widthPercent,
            heightPercent: parsed.heightPercent,
          };
        } else {
          // Old format: convert pixels to percentages
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          return {
            width: parsed.width || 540,
            height: parsed.height || 600,
            topPercent: vh > 0 ? (parsed.top || 0) / vh : null,
            leftPercent: vw > 0 ? (parsed.left || 0) / vw : null,
            widthPercent: vw > 0 ? (parsed.width || 540) / vw : null,
            heightPercent: vh > 0 ? (parsed.height || 600) / vh : null,
          };
        }
      }
    } catch (e) {
      console.error('Failed to load chat widget state:', e);
    }
    // Default: bottom right corner (desktop) or bottom full-width (mobile)
    if (typeof window !== 'undefined') {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const isMobileDefault = vw < 768;
      
      if (isMobileDefault) {
        // Mobile: default to 60% of viewport height
        const initialHeight = Math.min(vh * 0.6, vh);
        return {
          width: vw,
          height: initialHeight,
          topPercent: null,
          leftPercent: null,
          widthPercent: null,
          heightPercent: initialHeight / vh,
        };
      }
      
      const initialWidth = Math.min(540, vw - 48);
      const initialHeight = Math.min(600, vh - 48);
      return {
        width: initialWidth,
        height: initialHeight,
        topPercent: (vh - initialHeight - 24) / vh,
        leftPercent: (vw - initialWidth - 24) / vw,
        widthPercent: initialWidth / vw,
        heightPercent: initialHeight / vh,
      };
    }
    return { width: 540, height: 600, topPercent: null, leftPercent: null, widthPercent: null, heightPercent: null };
  };

  // Convert percentage-based state to pixel values based on current viewport
  const getPixelState = (state: { width: number; height: number; topPercent: number | null; leftPercent: number | null; widthPercent: number | null; heightPercent: number | null }, mobile: boolean = false, vh: number = 0) => {
    if (typeof window === 'undefined') {
      return { width: state.width, height: state.height, top: 0, left: 0 };
    }
    const vw = window.innerWidth;
    const viewportH = vh > 0 ? vh : window.innerHeight;
    
    if (mobile) {
      // Mobile: full width, bottom-aligned, vertically resizable from top
      const height = state.heightPercent !== null
        ? Math.max(320, Math.min(viewportH * state.heightPercent, viewportH))
        : Math.max(320, Math.min(state.height, viewportH));
      
      return {
        width: vw, // Full width on mobile
        height: height,
        top: viewportH - height, // Bottom-aligned
        left: 0, // Full width starts at 0
      };
    }
    
    // Desktop: original behavior
    const width = state.widthPercent !== null 
      ? Math.max(320, Math.min(vw * state.widthPercent, vw - 48))
      : Math.max(320, Math.min(state.width, vw - 48));
    const height = state.heightPercent !== null
      ? Math.max(320, Math.min(viewportH * state.heightPercent, viewportH - 48))
      : Math.max(320, Math.min(state.height, viewportH - 48));
    
    // Calculate top position - default to bottom if no percentage
    const top = state.topPercent !== null
      ? Math.max(0, Math.min(viewportH * state.topPercent, viewportH - height - 24))
      : Math.max(0, viewportH - height - 24);
    // Calculate left position - default to right if no percentage  
    const left = state.leftPercent !== null
      ? Math.max(0, Math.min(vw * state.leftPercent, vw - width - 24))
      : Math.max(0, vw - width - 24);
    
    return { width, height, top, left };
  };

  const savedState = loadSavedState();
  
  // Detect mobile viewport (Tailwind md breakpoint is 768px)
  const [isMobile, setIsMobile] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(typeof window !== 'undefined' ? window.innerHeight : 0);
  
  const initialPixelState = getPixelState(savedState, isMobile, viewportHeight);
  
  const [isOpen, setIsOpen] = useState(false);
  const [windowSize, setWindowSize] = useState({ width: initialPixelState.width, height: initialPixelState.height });
  const [position, setPosition] = useState({ top: initialPixelState.top, left: initialPixelState.left });
  const [relativeState, setRelativeState] = useState(savedState);
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

  // Detect mobile viewport and handle keyboard
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const checkMobile = () => {
      const mobile = window.innerWidth < 768; // Tailwind md breakpoint
      setIsMobile(mobile);
      setViewportHeight(window.innerHeight);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    // Handle virtual keyboard on mobile
    const handleViewportChange = () => {
      setViewportHeight(window.innerHeight);
    };

    // Use visualViewport API if available (better for mobile keyboards)
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportChange);
    }

    return () => {
      window.removeEventListener('resize', checkMobile);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportChange);
      }
    };
  }, []);

  const assistantTitle = `${brandName} Advisor`;

  const assistantSubtitle = vertical
    ? `Always-on ${vertical} guidance`
    : 'Always-on product guidance';

  // Update relative state when position or size changes (for responsive behavior)
  useEffect(() => {
    if (typeof window !== 'undefined' && isOpen) {
      const vw = window.innerWidth;
      const vh = viewportHeight > 0 ? viewportHeight : window.innerHeight;
      
      if (vw > 0 && vh > 0) {
        if (isMobile) {
          // Mobile: only store height percentage (width is always 100%, position is always bottom)
          setRelativeState({
            width: windowSize.width,
            height: windowSize.height,
            topPercent: null, // Not used on mobile
            leftPercent: null, // Not used on mobile
            widthPercent: null, // Not used on mobile (always 100%)
            heightPercent: windowSize.height / vh,
          });
        } else {
          // Desktop: store all percentages
          setRelativeState({
            width: windowSize.width,
            height: windowSize.height,
            topPercent: position.top / vh,
            leftPercent: position.left / vw,
            widthPercent: windowSize.width / vw,
            heightPercent: windowSize.height / vh,
          });
        }
      }
    }
  }, [windowSize, position, isOpen, isMobile, viewportHeight]);

  // Save state to localStorage whenever relative state changes
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(
          'chatWidgetState',
          JSON.stringify(relativeState)
        );
      } catch (e) {
        console.error('Failed to save chat widget state:', e);
      }
    }
  }, [relativeState]);

  // Initialize position/size when chat opens (only when transitioning from closed to open)
  const prevIsOpenRef = useRef(false);
  useEffect(() => {
    if (isOpen && !prevIsOpenRef.current && typeof window !== 'undefined') {
      const newPixelState = getPixelState(relativeState, isMobile, viewportHeight);
      setWindowSize({ width: newPixelState.width, height: newPixelState.height });
      setPosition({ top: newPixelState.top, left: newPixelState.left });
    }
    prevIsOpenRef.current = isOpen;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, isMobile, viewportHeight]); // Include mobile and viewport height

  // Handle window resize - adjust position and size to maintain relative position
  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;

    const handleResize = () => {
      const newPixelState = getPixelState(relativeState, isMobile, viewportHeight);
      setWindowSize({ width: newPixelState.width, height: newPixelState.height });
      setPosition({ top: newPixelState.top, left: newPixelState.left });
    };

    // Use a debounce to avoid too many updates during resize
    let timeoutId: NodeJS.Timeout;
    const debouncedHandleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(handleResize, 16); // ~60fps
    };

    window.addEventListener('resize', debouncedHandleResize);
    return () => {
      window.removeEventListener('resize', debouncedHandleResize);
      clearTimeout(timeoutId);
    };
  }, [isOpen, relativeState, isMobile, viewportHeight]);

  const windowRef = useRef<HTMLDivElement>(null);
  const isResizingRef = useRef(false);
  const isDraggingRef = useRef(false);
  const resizeDirectionRef = useRef<string | null>(null);
  const startPosRef = useRef({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0 });
  const [showDragHint, setShowDragHint] = useState(false);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      // Prevent default touch behavior to stop background scrolling
      if ('touches' in e && isResizingRef.current) {
        e.preventDefault();
      }
      
      const currentIsMobile = window.innerWidth < 768;
      const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0]?.clientY : e.clientY;
      
      if (clientX === undefined || clientY === undefined) return;
      
      if (isDraggingRef.current) {
        // On mobile, disable dragging (only allow top edge resize)
        if (currentIsMobile) return;
        
        // Handle dragging - move the window
        const deltaX = clientX - startPosRef.current.x;
        const deltaY = clientY - startPosRef.current.y;
        
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
      const deltaX = clientX - startPosRef.current.x;
      const deltaY = clientY - startPosRef.current.y;
      
      let newWidth = startPosRef.current.width;
      let newHeight = startPosRef.current.height;
      let newTop = startPosRef.current.top;
      let newLeft = startPosRef.current.left;

      if (currentIsMobile) {
        // Mobile: only allow top edge resizing, keep bottom edge fixed at viewport bottom
        if (direction.includes('n')) {
          const heightDelta = startPosRef.current.y - clientY;
          newHeight = Math.max(320, Math.min(startPosRef.current.height + heightDelta, window.innerHeight));
          // Adjust top position to keep bottom edge fixed at viewport bottom
          newTop = window.innerHeight - newHeight;
          newWidth = window.innerWidth; // Always full width on mobile
          newLeft = 0; // Always at left edge on mobile
        }
      } else {
        // Desktop: original behavior
        // Handle horizontal resizing
        if (direction.includes('e')) {
          // Right edge or corners - keep left edge fixed
          newWidth = Math.max(320, Math.min(window.innerWidth - startPosRef.current.left, startPosRef.current.width + deltaX));
        } else if (direction.includes('w')) {
          // Left edge or corners - keep right edge fixed
          const widthDelta = startPosRef.current.x - clientX;
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
          const heightDelta = startPosRef.current.y - clientY;
          newHeight = Math.max(320, Math.min(startPosRef.current.height + heightDelta, startPosRef.current.top + startPosRef.current.height));
          // Adjust top position to keep bottom edge fixed
          newTop = startPosRef.current.top + startPosRef.current.height - newHeight;
        }
      }

      // Constrain to viewport
      if (!currentIsMobile) {
        // Desktop constraints
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
      } else {
        // Mobile: ensure full width and bottom alignment
        newWidth = window.innerWidth;
        newLeft = 0;
        newTop = window.innerHeight - newHeight;
      }

      setWindowSize({ width: Math.max(320, newWidth), height: Math.max(320, newHeight) });
      setPosition({ top: Math.max(0, newTop), left: Math.max(0, newLeft) });
    };

    const handleMouseUp = (e?: MouseEvent | TouchEvent) => {
      // Prevent default on touch end to stop any remaining scroll
      if (e && 'touches' in e) {
        e.preventDefault();
      }
      
      isResizingRef.current = false;
      isDraggingRef.current = false;
      resizeDirectionRef.current = null;
      
      // Re-enable body scroll when resizing stops
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
        document.body.style.touchAction = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleMouseMove, { passive: false });
    document.addEventListener('touchend', handleMouseUp, { passive: false });
    document.addEventListener('touchcancel', handleMouseUp, { passive: false });

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleMouseMove);
      document.removeEventListener('touchend', handleMouseUp);
      document.removeEventListener('touchcancel', handleMouseUp);
      
      // Clean up body styles
      if (typeof document !== 'undefined') {
        document.body.style.overflow = '';
        document.body.style.touchAction = '';
      }
    };
  }, []);

  const handleResizeStart = (e: React.MouseEvent | React.TouchEvent, direction: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!windowRef.current) return;

    // On mobile, only allow top edge resizing
    if (isMobile && !direction.includes('n')) {
      return;
    }

    // Prevent body scroll on mobile when resizing starts
    if (isMobile && typeof document !== 'undefined') {
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
    }

    const rect = windowRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? e.touches[0]?.clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0]?.clientY : e.clientY;
    
    if (clientX === undefined || clientY === undefined) return;

    isResizingRef.current = true;
    isDraggingRef.current = false; // Ensure we're not dragging
    resizeDirectionRef.current = direction;
    startPosRef.current = {
      x: clientX,
      y: clientY,
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

    // On mobile, disable dragging (only allow top edge resize)
    if (isMobile) {
      // On mobile, treat drag handle as top resize
      handleResizeStart(e, 'n');
      return;
    }

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
            className="fixed bottom-3 right-3 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm shadow-lg shadow-rose-300/50 transition hover:shadow-rose-400/70 hover:bg-white/90 md:bottom-4 md:right-4 md:h-14 md:w-14 overflow-visible p-0 border-0"
            aria-label={`Open ${assistantTitle}`}
          >
            <AssistantAvatar size={44} noTransform className="md:hidden" />
            <AssistantAvatar size={52} noTransform className="hidden md:block" />
          </button>
        </>
      )}

      {/* Chat window overlay */}
      {isOpen && (
        <div
          ref={windowRef}
          className={`fixed z-50 ${isMobile ? 'md:static' : ''}`}
          style={{
            top: isMobile ? 'auto' : `${position.top}px`,
            bottom: isMobile ? '0' : 'auto',
            left: isMobile ? '0' : `${position.left}px`,
            right: isMobile ? '0' : 'auto',
            width: isMobile ? '100%' : `${windowSize.width}px`,
            height: `${windowSize.height}px`,
            maxWidth: isMobile ? '100%' : '100vw',
            maxHeight: '100vh',
            minWidth: isMobile ? '100%' : '320px',
            minHeight: '320px',
          }}
        >
          {/* Visible drag/resize handle - positioned outside overflow container */}
          <div
            className={`absolute left-1/2 z-[70] ${isMobile ? 'cursor-ns-resize' : 'cursor-move'}`}
            style={{
              top: '-17px',
              transform: 'translateX(-50%)',
              touchAction: isMobile ? 'none' : 'auto', // Prevent default touch behaviors on mobile
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              handleDragStart(e);
            }}
            onTouchStart={(e) => {
              // Handle touch for mobile
              if (isMobile) {
                e.preventDefault();
                e.stopPropagation();
                handleResizeStart(e, 'n');
              }
            }}
            onTouchMove={(e) => {
              // Prevent default to stop background scrolling
              if (isMobile && isResizingRef.current) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
          >
            <div className="rounded-full border border-rose-200/60 bg-white p-2 shadow-sm pointer-events-none">
              {isMobile ? (
                // Mobile: only up/down arrows
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
                </svg>
              ) : (
                // Desktop: omnidirectional arrows
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
              )}
            </div>
          </div>
          {/* Chat window content container with overflow hidden */}
          <div
            className={`flex flex-col border border-rose-100 bg-white text-slate-900 shadow-2xl shadow-rose-100/80 backdrop-blur-xl overscroll-contain overflow-hidden h-full ${
              isMobile ? 'rounded-t-2xl' : 'rounded-2xl'
            }`}
          >
          {/* Resize handles - all edges and corners (hidden on mobile) */}
          {!isMobile && (
            <>
              {/* Top-left corner */}
              <div
                onMouseDown={(e) => handleResizeStart(e, 'nw')}
                className="absolute top-0 left-0 w-6 h-6 cursor-nwse-resize z-50"
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
            </>
          )}
          {/* Top edge - entire edge allows resizing (works on both mobile and desktop) */}
          <div
            onMouseDown={(e) => handleResizeStart(e, 'n')}
            onTouchStart={(e) => {
              if (isMobile) {
                e.preventDefault();
                e.stopPropagation();
                handleResizeStart(e, 'n');
              }
            }}
            onTouchMove={(e) => {
              // Prevent default to stop background scrolling
              if (isMobile && isResizingRef.current) {
                e.preventDefault();
                e.stopPropagation();
              }
            }}
            style={{
              touchAction: isMobile ? 'none' : 'auto', // Prevent default touch behaviors on mobile
            }}
            className={`absolute top-0 left-0 right-0 h-6 cursor-ns-resize z-50 ${isMobile ? '' : 'md:left-6 md:right-6'}`}
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
