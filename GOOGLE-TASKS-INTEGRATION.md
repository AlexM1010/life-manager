# Google Tasks Integration - Complete

## Status: ✅ Implemented

The Life Launcher widget now connects directly to Google Tasks API with OAuth authentication.

## What Was Implemented

### 1. Google Authentication (`GoogleAuthManager.kt`)
- OAuth 2.0 sign-in flow using Google Sign-In SDK
- Requests `TASKS` scope for read/write access
- Singleton pattern for app-wide access
- Activity Result API integration

### 2. Google Tasks Repository (`GoogleTasksRepository.kt`)
- **fetchTasks()** - Fetches all tasks from all task lists, filters by due date
- **completeTask()** - Marks tasks complete in Google Tasks
- **getCompletedTasks()** - Fetches completed tasks for domain balance calculation
- **isSignedIn()** - Check authentication status
- Graceful fallback to mock data when not signed in

### 3. Widget State Management
- Added `WidgetState.SignInRequired` state
- Widget shows "Sign in with Google" when not authenticated
- Tap on sign-in message launches OAuth flow

### 4. Sign-In Flow (`HomeFragment.kt`)
- Activity Result launcher for Google Sign-In
- Handles sign-in result and refreshes widget
- Shows toast with signed-in email on success

### 5. ProGuard Rules
- Added rules to handle Google API dependencies
- Suppresses warnings for optional Apache HTTP classes

## How It Works

1. **First Launch**: Widget shows "Sign in with Google"
2. **User Taps**: OAuth flow launches in Google Sign-In UI
3. **User Authorizes**: Grants Tasks API access
4. **Widget Refreshes**: Fetches real tasks from Google Tasks
5. **Ongoing**: Widget syncs every 5 minutes in background

## Task Encoding Convention

Tasks are encoded in Google Tasks with metadata in the title:

```
[!!!] Pay bills (15m)
[!!] Call mom (30m)
[!] Read article (45m)
```

- `[!!!]` = must-do (priority 1)
- `[!!]` = should-do (priority 2)
- `[!]` = nice-to-have (priority 3)
- `(15m)` = duration in minutes

Each Google Tasks list represents a life domain:
- Health
- Admin
- Relationships
- University
- Creative Projects

## Architecture

```
HomeFragment
    ↓ (tap on SignInRequired)
GoogleAuthManager.getSignInIntent()
    ↓ (user authorizes)
GoogleAuthManager.handleSignInResult()
    ↓ (success)
WidgetViewModel.refresh()
    ↓
GoogleTasksRepository.fetchTasks()
    ↓ (returns Task list)
PlannerAlgorithm.generatePlan()
    ↓
WidgetState.NextTask
    ↓
LifeManagerWidget.updateState()
```

## OAuth Configuration

**Android OAuth Client ID**: `819355390117-rlhbhtp7m4qn4j6m22nm19607iom66nf.apps.googleusercontent.com`

Stored in: `app/src/main/res/values/google_oauth.xml` (gitignored)

## Testing

1. Install APK on device
2. Widget shows "Sign in with Google"
3. Tap widget
4. Sign in with Google account
5. Grant Tasks API permission
6. Widget shows first task from today's plan
7. Swipe right to complete task
8. Swipe left to skip task

## Next Steps (Future)

- [ ] Add energy slider UI for energy check-ins
- [ ] Add settings UI to enable/disable widget
- [ ] Add offline queue for task completions
- [ ] Add pull-to-refresh gesture
- [ ] Add task details view on tap
- [ ] Add domain balance visualization

## Files Modified

- `app/build.gradle` - Added Google Play Services dependencies
- `app/proguard-rules.pro` - Added ProGuard rules for Google API
- `app/src/main/res/values/google_oauth.xml` - OAuth client ID (gitignored)
- `app/src/main/java/app/lifelauncher/data/google/GoogleAuthManager.kt` - New
- `app/src/main/java/app/lifelauncher/data/google/GoogleTasksRepository.kt` - Implemented real API
- `app/src/main/java/app/lifelauncher/ui/widget/WidgetState.kt` - Added SignInRequired
- `app/src/main/java/app/lifelauncher/ui/widget/WidgetViewModel.kt` - Check sign-in status
- `app/src/main/java/app/lifelauncher/ui/widget/LifeManagerWidget.kt` - Format SignInRequired
- `app/src/main/java/app/lifelauncher/ui/HomeFragment.kt` - Handle sign-in flow

## Dependencies Added

```gradle
// Google Play Services
implementation 'com.google.android.gms:play-services-auth:21.2.0'

// Google Tasks API
implementation 'com.google.apis:google-api-services-tasks:v1-rev20240423-2.0.0'
implementation 'com.google.api-client:google-api-client-android:2.2.0'
implementation 'com.google.http-client:google-http-client-android:1.44.1'
implementation 'com.google.http-client:google-http-client-gson:1.44.1'

// Coroutines for Google Play Services
implementation 'org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.7.3'
```

---

**Integration complete!** The widget now reads from Google Tasks directly, staying in sync with the web app through the shared data source.
