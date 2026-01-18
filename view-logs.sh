#!/bin/bash
# View logs from the app
LOG_FILE="app.log"

if [ ! -f "$LOG_FILE" ]; then
    echo "Log file $LOG_FILE not found."
    echo "Start the app with: ./run-with-logs.sh"
    exit 1
fi

case "$1" in
    "tail")
        echo "Following logs (Ctrl+C to stop)..."
        tail -f "$LOG_FILE"
        ;;
    "last")
        LINES=${2:-1000}
        echo "Last $LINES lines:"
        tail -n "$LINES" "$LOG_FILE"
        ;;
    "search")
        if [ -z "$2" ]; then
            echo "Usage: ./view-logs.sh search <pattern>"
            exit 1
        fi
        echo "Searching for: $2"
        grep -i "$2" "$LOG_FILE" | tail -n 100
        ;;
    "timing")
        echo "Extracting timing information..."
        grep -E "(handleLoveshackfancyQuery|classifyQuery|generateReply|retrieval|product_loading|ranking|reply_generation)" "$LOG_FILE" | tail -n 200
        ;;
    *)
        echo "Usage: ./view-logs.sh [tail|last|search|timing]"
        echo ""
        echo "Commands:"
        echo "  tail              - Follow logs in real-time"
        echo "  last [N]          - Show last N lines (default: 1000)"
        echo "  search <pattern>  - Search for pattern in logs"
        echo "  timing            - Show timing-related logs"
        echo ""
        echo "Examples:"
        echo "  ./view-logs.sh tail"
        echo "  ./view-logs.sh last 5000"
        echo "  ./view-logs.sh search 'ranking_complete'"
        echo "  ./view-logs.sh timing"
        ;;
esac
