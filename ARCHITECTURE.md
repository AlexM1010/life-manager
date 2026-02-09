# Life Launcher Architecture

## Overview

Life Launcher is a standalone Android launcher widget that integrates with Google Tasks/Calendar. It runs the same planning algorithm as Life Manager but operates independently — no server connection required.

```
┌─────────────────────────────────────────────────────────────┐
│                    Google Calendar/Tasks                     │
│                    (Single Source of Truth)                  │
└──────────────┬─────────────────────────────────┬────────────┘
               │                                 │
               ▼                                 ▼
┌──────────────────────────┐   ┌──────────────────────────────┐
│   Life Manager (Web)     │   │   Life Launcher (Android)    │
│   - Stats dashboard      │   │   - Widget shows next task   │
│   - Desktop task entry   │   │   - Swipe to complete        │
│   - Weekly summaries     │   │   - Energy slider            │
│   - Guardrails           │   │   - Runs planner locally     │
│   - Polls Google         │   │   - Talks to Google directly │
└──────────────────────────┘   └──────────────────────────────┘
```

Both clients read/write to Google. Neither needs to talk to the other. They stay in sync because they use the same data source and deterministic algorithm.

## Task Encoding Convention

For both clients to understand tasks identically:

```
Task Title Format:
[!!!] Call Mom (15m)
 │     │        │
 │     │        └── Duration in minutes
 │     └── Task title
 └── Priority: [!!!]=must-do, [!!]=should-do, [!]=nice-to-have (default: should-do)

Task List = Domain:
- "Health" list
- "Admin" list  
- "Relationships" list
- "University" list
- "Creative" list
```

## Widget States

| State | When | Display |
|-------|------|---------|
| NextTask | Tasks available | Task title, duration, domain |
| EnergyCheckIn | No tasks for current energy | Energy slider (0-10) |
| BalanceWarning | Domain neglected (0 tasks/week) | Domain name, warning |
| AllCaughtUp | No tasks, energy logged | Celebration message |
| Loading | Fetching from Google | Loading indicator |
| Error | API failure | Error + cached state |

## Planner Algorithm

The algorithm is deterministic — given the same inputs, it produces the same output:

**Inputs:**
- Tasks (from Google Tasks)
- Completions in last 7 days (from Google Tasks completed items)
- Energy level (0-10, stored locally)
- Current date

**Algorithm:**
1. Filter tasks by energy-based duration cap (low energy = short tasks only)
2. Score each task: `priority_weight + domain_neglect_bonus + overdue_bonus`
3. Select top N tasks (N depends on energy level)
4. Return first task as "next task"

**Energy Configuration:**
| Energy | Tasks | Duration Cap |
|--------|-------|--------------|
| 0-3 | 2-3 | 15 min max |
| 4-6 | 3-5 | No cap |
| 7-10 | 5-6 | No cap |

## Data Flow

### Refresh Cycle
```
1. Widget refresh triggered (manual or 5-min interval)
2. Fetch all task lists from Google Tasks API
3. Parse tasks (extract priority, duration, domain)
4. Count completions per domain (last 7 days)
5. Get energy level from local storage
6. Run planner algorithm
7. Update widget UI
```

### Task Completion
```
1. User swipes right on task
2. Mark task complete in Google Tasks API
3. Refresh widget state
4. Show next task
```

### Energy Logging
```
1. Widget shows energy slider
2. User adjusts slider (0-10)
3. Save to local SharedPreferences
4. Re-run planner with new energy
5. Update widget
```

## File Structure

```
app/src/main/java/app/lifelauncher/
├── data/
│   ├── google/
│   │   └── GoogleTasksRepository.kt   # Google Tasks API client
│   ├── Prefs.kt                       # SharedPreferences wrapper
│   └── Constants.kt
├── domain/
│   ├── Task.kt                        # Task data class
│   └── PlannerAlgorithm.kt            # Planning logic (pure function)
├── ui/
│   ├── widget/
│   │   ├── WidgetState.kt             # Sealed class for states
│   │   ├── WidgetViewModel.kt         # State management
│   │   ├── LifeManagerWidget.kt       # Custom TextView with gestures
│   │   └── EnergySlider.kt            # Custom SeekBar (0-10)
│   ├── HomeFragment.kt
│   └── SettingsFragment.kt
└── MainActivity.kt
```

## Dependencies

- Google Tasks API (via Google Play Services)
- Google Sign-In (for OAuth)
- Kotlin Coroutines (async operations)
- AndroidX Lifecycle (ViewModel, LiveData)

## Security

- OAuth tokens stored in Android Keystore
- No server communication (except Google APIs)
- All data stays on device (except Google sync)
- Energy level stored locally only

## Offline Behavior

- Cache last fetched tasks in SharedPreferences
- Show cached state when offline
- Queue task completions for sync when back online
- Show "Offline" indicator

## Life Manager Server Role

The Life Manager web app server becomes an analytics dashboard:

1. **Periodic sync from Google** (every 5-15 min)
2. **Store in SQLite for analytics** (historical data, streaks, charts)
3. **Desktop UI** (add/edit tasks via Google, view stats)
4. **Guardrails** (analyze patterns, show warnings)
5. **Weekly summaries** (generate from stored history)

The server does NOT:
- Serve mobile API endpoints
- Handle sync conflicts (Google wins)
- Maintain offline queues for mobile
