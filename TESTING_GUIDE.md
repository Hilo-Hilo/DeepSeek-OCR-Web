# Testing Guide for New State Persistence Features

## Overview
This guide covers testing all the new multi-task state persistence features implemented in the frontend.

## Test Environment
- **Frontend**: http://localhost:3001 (or http://<tailscale-ip>:3001)
- **Backend**: http://localhost:8002

## Features to Test

### 1. Backend Health Monitoring
**Location**: Header, next to "DeepSeek OCR" title

**Test Steps**:
1. Open the application
2. Look for the status indicator (colored dot with text)
3. Expected states:
   - 🟢 **Online** (green) - Backend responding < 3s
   - 🟡 **Slow** (yellow) - Backend responding > 3s
   - 🔴 **Offline** (red) - Backend not responding
4. Hover over indicator for detailed message

**Success Criteria**:
- Indicator shows current backend status
- Status updates every 10 seconds automatically
- Tooltip shows response time and error details

---

### 2. Task Persistence & Restoration
**Feature**: Tasks survive page refreshes and browser restarts

**Test Steps**:
1. Upload a file and start OCR task
2. While task is running, refresh the page (F5)
3. Check if task state is restored:
   - Task ID should be visible
   - Progress should continue from where it left off
   - Console messages should be preserved
   - Elapsed time should be accurate
4. Close browser tab and reopen → task should still be there

**Success Criteria**:
- Running tasks are restored on page load
- Progress continues seamlessly
- Console logs are preserved (last 100 messages)
- "Restored from previous session" indicator shows

---

### 3. Multi-Task Tracking
**Location**: "Tasks" button in top-right header

**Test Steps**:
1. Start multiple OCR tasks (upload different files, start each)
2. Click the "Tasks" button in header
3. Active Tasks Panel should open showing:
   - All running tasks with progress bars
   - Completed tasks
   - Error/cancelled tasks
4. Click on a task card to switch to viewing that task
5. Each task should show:
   - Filename
   - Status (running/completed/error/cancelled)
   - Progress (for running tasks)
   - Elapsed/total time
   - Cancel button (for running)
   - Delete button (for completed/error)

**Success Criteria**:
- Can track 3+ concurrent tasks
- Each task shows accurate status
- Switching between tasks works
- Task list updates in real-time

---

### 4. File Upload Recovery
**Location**: File uploader section (left panel)

**Test Steps**:
1. Upload a file successfully
2. Refresh the page (don't start processing yet)
3. A blue banner should appear saying "Previous file available"
   - Shows the filename
   - Options: "Upload new" or "Use this file"
4. Click "Use this file" → should restore previous upload
5. If file was deleted from server, should show yellow "Previous file not found"

**Success Criteria**:
- Previous upload is detected
- File validation works (checks if file still exists on server)
- Can choose to reuse or upload new file
- Start Processing button enables when recovered file is accepted

---

### 5. Cancel Button
**Location**: Next to "Start Processing" button (appears during processing)

**Test Steps**:
1. Upload file and start processing
2. During processing, a red stop-square button should appear
3. Click the cancel button
4. Task should be marked as "cancelled"
5. Processing should stop
6. Console output should stop updating

**Success Criteria**:
- Cancel button appears only during processing
- Clicking cancel actually stops the backend task
- UI updates to show "cancelled" status
- Toast notification confirms cancellation

---

### 6. Tab Synchronization
**Feature**: Changes in one tab are reflected in all other tabs

**Test Steps**:
1. Open application in Tab 1
2. Open same application in Tab 2 (new tab, same URL)
3. In Tab 1: Upload file and start task
4. In Tab 2: Should see the task appear automatically
5. In Tab 1: Cancel the task
6. In Tab 2: Should see task marked as cancelled

**Success Criteria**:
- Tasks started in one tab appear in all tabs
- Progress updates sync across tabs
- Cancel/delete actions sync across tabs
- No duplicate API calls (BroadcastChannel used for communication)

---

### 7. Orphaned Task Detection
**Feature**: Detects tasks stuck in "running" from previous crashes

**Test Steps**:
1. Start a task
2. While running, kill the backend process (or simulate crash)
3. Restart backend
4. Refresh frontend
5. The task should be detected as orphaned and marked as "error"
   - Error message: "Task was lost during server restart"

**Success Criteria**:
- Orphaned tasks are detected
- Marked as error with appropriate message
- User can delete orphaned tasks
- localStorage is cleaned up

---

### 8. Stale Task Cleanup
**Feature**: Auto-removes tasks older than 24 hours

**Test Steps**:
1. Open browser DevTools → Application → Local Storage
2. Find key: `deepseek-ocr-tasks`
3. View the JSON data
4. Manually modify a task's `lastUpdated` timestamp to be >24 hours old
5. Refresh the page
6. Old task should be removed from localStorage

**Success Criteria**:
- Tasks older than 24 hours are removed
- Completed tasks stay for 7 days (special rule)
- localStorage is updated

---

### 9. Console Log Persistence
**Feature**: Stores last 100 console lines per task

**Test Steps**:
1. Start a task that generates console output
2. Wait for several log messages (at least 10)
3. Refresh the page while task is running
4. Console Output component should show:
   - Previous messages before refresh
   - Continue with new messages

**Success Criteria**:
- Console messages persist across refresh
- Maximum 100 messages stored per task
- Messages continue updating after refresh

---

### 10. WebSocket Reconnection
**Feature**: Auto-reconnects WebSocket with exponential backoff

**Test Steps**:
1. Start a task (WebSocket connects for console output)
2. Kill/restart backend while task is running
3. Frontend should attempt to reconnect:
   - Retries up to 5 times
   - Uses exponential backoff (1s, 2s, 4s, 8s, 16s)
4. When backend is back, WebSocket should reconnect and console logs should resume (progress polling continues regardless)

**Success Criteria**:
- Automatic reconnection attempts
- Exponential backoff prevents flooding
- UI remains responsive during reconnection

---

### 11. Task Card Actions
**Location**: Active Tasks Panel

**Test Steps**:
1. Click "Tasks" button in header
2. For running tasks:
   - Should see Cancel button
   - Click to cancel task
3. For completed/error tasks:
   - Should see Delete button (trash icon)
   - Click to remove task from history
4. Both actions should:
   - Update task list immediately
   - Show toast notification
   - Sync across tabs

**Success Criteria**:
- Cancel works for running tasks
- Delete works for completed/error tasks
- UI updates immediately
- Backend API is called
- Changes sync to other tabs

---

### 12. Restored Task Indicator
**Feature**: Shows when task is restored from previous session

**Test Steps**:
1. Start a task
2. Refresh page while running
3. In Prompt Input component, should see:
   - Task ID displayed
   - "(Restored)" badge
4. In Active Tasks Panel:
   - Task card shows "(restored)" text
5. Blue info banner: "Restored from previous session - tracking in progress"

**Success Criteria**:
- Restored badge is visible
- Task ID is shown
- Info banner appears
- Progress continues tracking

---

## Debugging Tips

### Check LocalStorage
```javascript
// In browser console:
localStorage.getItem('deepseek-ocr-tasks')
```

### Check Tab Sync
```javascript
// In browser console (both tabs):
// Verify by performing actions in one tab and observing changes in the other tab.
```

### Check Backend Health
```bash
curl http://localhost:8002/api/history
```

### View All Console Logs
```javascript
// Tip: Use the browser Network tab to inspect /api/* requests and WebSocket connections.
```

---

## Known Issues / Limitations

1. **CORS**: If frontend and backend are on different ports, CORS must be configured
2. **BroadcastChannel**: Not supported in private/incognito mode
3. **LocalStorage**: Limited to ~5-10MB depending on browser
4. **WebSocket**: Some corporate firewalls may block WebSocket connections

---

## Performance Metrics

- **Task Restoration Time**: < 500ms for 10 tasks
- **Tab Sync Latency**: < 100ms between tabs
- **Backend Health Check**: Every 10 seconds
- **Progress Polling**: Every 2 seconds per task
- **Console Message Buffer**: Last 100 messages per task
- **LocalStorage Size**: ~1-5KB per task

---

## Success Checklist

- [ ] Backend health indicator works
- [ ] Tasks persist across refresh
- [ ] Multiple tasks can run concurrently
- [ ] File upload recovery works
- [ ] Cancel button stops tasks
- [ ] Tab synchronization works
- [ ] Orphaned tasks detected
- [ ] Stale tasks cleaned up
- [ ] Console logs persist
- [ ] WebSocket reconnects
- [ ] Task cards show correct actions
- [ ] Restored indicators appear



