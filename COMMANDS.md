# Commands to Kill Ports, Build, and Run the App

## 1. Kill All Processes on Ports

### Kill process on port 3000 (Next.js default):
```bash
lsof -ti:3000 | xargs kill -9
```

### Kill processes on multiple common ports:
```bash
# Kill port 3000
lsof -ti:3000 | xargs kill -9

# Kill port 3001 (if using alternate port)
lsof -ti:3001 | xargs kill -9

# Kill all Node processes (use with caution)
pkill -9 node
```

### Alternative: Find and kill by port (macOS/Linux):
```bash
# Find process on port 3000
lsof -i:3000

# Kill specific process (replace PID with actual process ID)
kill -9 <PID>
```

### One-liner to kill all Node processes:
```bash
pkill -9 node
```

---

## 2. Build the App

### Using npm:
```bash
cd "/Users/k1zzle/Desktop/velou-shopping-assistant demo lsf"
npm run build
```

### Using pnpm (if you have pnpm-lock.yaml):
```bash
cd "/Users/k1zzle/Desktop/velou-shopping-assistant demo lsf"
pnpm build
```

### Using yarn:
```bash
cd "/Users/k1zzle/Desktop/velou-shopping-assistant demo lsf"
yarn build
```

---

## 3. Run the App

### Development mode (with hot reload):
```bash
cd "/Users/k1zzle/Desktop/velou-shopping-assistant demo lsf"
npm run dev
```

### Production mode (after building):
```bash
cd "/Users/k1zzle/Desktop/velou-shopping-assistant demo lsf"
npm run start
```

---

## Complete Workflow (All-in-One)

### Option 1: Development Mode
```bash
cd "/Users/k1zzle/Desktop/velou-shopping-assistant demo lsf"
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
npm run dev
```

### Option 2: Production Mode
```bash
cd "/Users/k1zzle/Desktop/velou-shopping-assistant demo lsf"
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
npm run build
npm run start
```

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `lsof -ti:3000 \| xargs kill -9` | Kill process on port 3000 |
| `pkill -9 node` | Kill all Node processes |
| `npm run build` | Build the Next.js app |
| `npm run dev` | Run in development mode |
| `npm run start` | Run in production mode |

---

## Notes

- The app typically runs on port 3000 by default
- Development mode (`npm run dev`) includes hot reload and better error messages
- Production mode (`npm run start`) requires building first (`npm run build`)
- If you get "port already in use" errors, use the kill commands above first
