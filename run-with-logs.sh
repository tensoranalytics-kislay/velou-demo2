#!/bin/bash
# Run the app and redirect all output to a log file
cd "/Users/k1zzle/Desktop/velou-shopping-assistant demo lsf"
LOG_FILE="app.log"
echo "Starting app and logging to $LOG_FILE"
echo "View logs with: tail -f $LOG_FILE"
echo "View last 5000 lines: tail -n 5000 $LOG_FILE"
echo "Search logs: grep 'handleLoveshackfancyQuery' $LOG_FILE"
PORT=3000 npm start 2>&1 | tee -a "$LOG_FILE"
