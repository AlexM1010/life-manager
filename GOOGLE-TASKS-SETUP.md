# Google Tasks Integration Setup Guide

## Overview

The Life Launcher widget integrates with Google Tasks to display your tasks directly on your home screen. This guide walks through the complete setup process.

## Architecture

- **Authentication**: Google Sign-In with OAuth 2.0
- **API**: Google Tasks API v1
- **Data Flow**: Google Tasks → Repository → ViewModel → Widget
- **Sync**: Pull-based (fetch on widget refresh)
- **Task Encoding**: Uses `[!!!]`, `[!!]`, `[!]` priority markers and `(15m)` duration in task titles

## Prerequisites

### 1. Google Cloud Console Setup

You need to create OAuth 2.0 credentials:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select existing)
3. Enable **Google Tasks API**:
   - Navigate to "APIs & Services" → "Library"
   - Search for "Google Tasks API"
   - Click "Enable"

4. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Application type: **Android**
   - Package name: `app.lifelauncher` (or `app.lifelauncher.debug` for debug builds)
   - SHA-1 certificate fingerprint: Get from your keystore (see below)

### 2. Get SHA-1 Fingerprint

For debug builds:
```bash
# Windows
keytool -list -v -keystore "%USERPROFILE%\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android

# Linux/Mac
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android
```

For release builds, use your release keystore.

### 3. Add OAuth Client ID to App

Create a file `app/src/main/res/values/google_oauth.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Replace with your OAuth 2.0 Client ID from Google Cloud Console -->
    <string name="google_oauth_client_id" translatable="false">YOUR_CLIENT_ID_HERE.apps.googleusercontent.com</string>
</resources>
```

**IMPORTANT**: Add this file to `.gitignore` to keep credentials private!

## Implementation Status

### ✅ Completed

- Widget UI and gesture handling
- Task domain model with priority/duration parsing
- Planner algorithm (ported from TypeScript)
- Widget ViewModel with state management
- Repository interface with mock data

### 🚧 In Progress

- Google Tasks API integration (this guide)

### 📋 TODO

1. **Implement GoogleTasksRepository** (`GoogleTasksRepository.kt`)
   - Replace mock data with actual API calls
   - Implement OAuth token management
   - Handle API errors and offline mode

2. **Add Sign-In UI** (Settings or first-run flow)
   - Google Sign-In button
   - Permission request flow
   - Account selection

3. **Token Storage** (SharedPreferences or encrypted storage)
   - Store OAuth tokens securely
   - Handle token refresh
   - Clear tokens on sign-out

4. **Background Sync** (WorkManager)
   - Periodic task refresh
   - Respect battery optimization
   - Handle network changes

## Code Structure

```
app/src/main/java/app/lifelauncher/
├── data/
│   └── google/
│       ├── GoogleTasksRepository.kt    # API integration (TODO)
│       └── GoogleAuthManager.kt        # OAuth handling (TODO)
├── domain/
│   ├── Task.kt                         # ✅ Task model
│   └── PlannerAlgorithm.kt            # ✅ Planning logic
└── ui/
    └── widget/
        ├── LifeManagerWidget.kt        # ✅ Widget view
        ├── WidgetViewModel.kt          # ✅ State management
        └── WidgetState.kt              # ✅ State definitions
```

## Task Encoding Convention

Tasks in Google Tasks should follow this format:

```
[!!!] Pay bills (10m)
[!!] Call Mom (15m)
[!] Go for walk (30m)
```

- `[!!!]` = Must-do (priority 3)
- `[!!]` = Should-do (priority 2)
- `[!]` = Nice-to-have (priority 1)
- `(15m)` = Duration in minutes

**Domain**: Each Google Tasks list represents a life domain (Health, Admin, Relationships, etc.)

## API Integration Example

Here's the key method to implement in `GoogleTasksRepository.kt`:

```kotlin
suspend fun fetchTasks(): List<Task> = withContext(Dispatchers.IO) {
    val credential = getGoogleCredential() // Get OAuth token
    
    val service = Tasks.Builder(
        NetHttpTransport(),
        GsonFactory.getDefaultInstance(),
        credential
    )
        .setApplicationName("LifeLauncher")
        .build()
    
    val taskLists = service.tasklists().list().execute().items ?: emptyList()
    val allTasks = mutableListOf<Task>()
    
    for (taskList in taskLists) {
        val tasks = service.tasks()
            .list(taskList.id)
            .setShowCompleted(false)
            .setShowHidden(false)
            .execute()
            .items ?: emptyList()
        
        for (googleTask in tasks) {
            val (title, priority, duration) = parseTaskTitle(googleTask.title ?: "")
            
            allTasks.add(Task(
                id = googleTask.id,
                listId = taskList.id,
                title = title,
                domain = taskList.title ?: "Other",
                priority = priority,
                durationMinutes = duration,
                dueDate = googleTask.due?.let { LocalDate.parse(it.substring(0, 10)) },
                isCompleted = false
            ))
        }
    }
    
    return@withContext allTasks
}
```

## Testing Without OAuth

The current implementation uses mock data, so you can test the widget functionality without setting up OAuth:

1. Build and install the app
2. Set as default launcher
3. Widget shows "Pay bills" from mock data
4. Swipe right to complete, left to skip

## Next Steps

1. **Set up Google Cloud Console** (see Prerequisites)
2. **Add OAuth Client ID** to `google_oauth.xml`
3. **Implement GoogleAuthManager** for sign-in flow
4. **Replace mock data** in GoogleTasksRepository
5. **Add sign-in UI** to settings
6. **Test with real Google Tasks**

## Resources

- [Google Tasks API Documentation](https://developers.google.com/tasks)
- [Google Sign-In for Android](https://developers.google.com/identity/sign-in/android)
- [OAuth 2.0 for Mobile Apps](https://developers.google.com/identity/protocols/oauth2/native-app)

## Security Notes

- **Never commit OAuth credentials** to version control
- Use **encrypted storage** for tokens (EncryptedSharedPreferences)
- Request **minimum necessary scopes** (only Tasks API)
- Implement **token refresh** to avoid re-authentication
- Handle **revocation** gracefully (clear local data)

---

**Status**: Mock data working, OAuth integration pending
**Last Updated**: 2026-02-08
