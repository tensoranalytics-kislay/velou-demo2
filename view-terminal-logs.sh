#!/bin/bash
# View logs from Cursor terminal output files

TERMINAL_LOG_DIR="$HOME/.cursor/projects/Users-k1zzle-Library-Application-Support-Cursor-Workspaces-1768162279223-workspace-json/terminals"
LATEST_TERMINAL=$(ls -t "$TERMINAL_LOG_DIR"/*.txt 2>/dev/null | head -1)

if [ -z "$LATEST_TERMINAL" ]; then
    echo "Terminal log files not found"
    exit 1
fi

case "$1" in
    "tail")
        echo "Following logs from: $LATEST_TERMINAL"
        echo "Press Ctrl+C to stop"
        tail -f "$LATEST_TERMINAL"
        ;;
    "last")
        LINES=${2:-5000}
        echo "Last $LINES lines from: $LATEST_TERMINAL"
        tail -n "$LINES" "$LATEST_TERMINAL"
        ;;
    "timing")
        echo "Extracting timing logs from: $LATEST_TERMINAL"
        grep -E "(handleLoveshackfancyQuery: (starting|complete|retrieval|product_loading|ranking|reply_generation)|classifyQuery: (starting|complete)|generateReply: (starting|complete))" "$LATEST_TERMINAL" | tail -n 100
        ;;
    "search")
        if [ -z "$2" ]; then
            echo "Usage: ./view-terminal-logs.sh search <pattern>"
            exit 1
        fi
        echo "Searching for '$2' in: $LATEST_TERMINAL"
        grep -i "$2" "$LATEST_TERMINAL" | tail -n 100
        ;;
    "all")
        echo "Showing all logs from: $LATEST_TERMINAL"
        cat "$LATEST_TERMINAL"
        ;;
    *)
        echo "Usage: ./view-terminal-logs.sh [tail|last|timing|search|all]"
        echo ""
        echo "Commands:"
        echo "  tail              - Follow logs in real-time"
        echo "  last [N]          - Show last N lines (default: 5000)"
        echo "  timing            - Show timing-related logs"
        echo "  search <pattern>  - Search for pattern in logs"
        echo "  all               - Show all logs (may be large)"
        echo ""
        echo "Current log file: $LATEST_TERMINAL"
        echo "File size: $(wc -l < "$LATEST_TERMINAL" 2>/dev/null || echo 'unknown') lines"
        ;;
esac
