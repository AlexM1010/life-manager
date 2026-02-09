# LifeLauncher Widget Design

Minimal, gesture-based UI matching OLauncher's aesthetic.

## Design Principles

**From OLauncher:**
- Text-only (no icons, no buttons)
- Sans-serif-light font
- Minimal padding (20dp horizontal)
- Left-aligned
- Single color (theme-aware: black/white)
- No backgrounds, no borders
- Breathing room between elements

**From Life Manager:**
- Clean typography hierarchy
- Discrete sliders (0-10)
- Subtle state feedback
- No visual clutter

## Widget States

### State 1: Calendar Event (Priority)
**When:** Event starts within 15 minutes OR currently happening

```
📅 Team meeting
in 12 min • 1 hour

[Swipe right to mark attended]
[Swipe left to skip]
```

**Layout:**
- Title: 18sp, sans-serif-light
- Subtitle: 14sp, 60% opacity
- Hint text: 12sp, 40% opacity, only shows on first use

### State 2: Next Task
**When:** No imminent calendar event, tasks available

```
Call Mom
15 min • Health

[Swipe right to complete]
[Swipe left to skip]
```

**Layout:**
- Task title: 18sp, sans-serif-light
- Duration + domain: 14sp, 60% opacity
- Hint text: 12sp, 40% opacity, fades after 3 uses

### State 3: Energy Check-in
**When:** No tasks remaining for current energy level

```
How's your energy?

[Slider: 0────●────10]

Last logged: 7/10 at 2:34 PM
```

**Layout:**
- Question: 18sp, sans-serif-light
- Slider: Custom view, 48dp height
- Last logged: 12sp, 40% opacity

### State 4: Balance Warning
**When:** Domain neglected (no tasks this week)

```
Health needs attention
0 tasks this week

[Swipe right to add task]
[Swipe left to dismiss]
```

**Layout:**
- Warning: 18sp, sans-serif-light
- Subtitle: 14sp, 60% opacity
- Hint text: 12sp, 40% opacity

### State 5: All Caught Up
**When:** No tasks, energy logged, balance good

```
✨ All caught up
3 tasks done today

[Swipe up for more]
```

**Layout:**
- Message: 18sp, sans-serif-light
- Stats: 14sp, 60% opacity
- Hint: 12sp, 40% opacity

## Gesture System

**Swipe Right:** Complete/Confirm
- Task → Mark complete
- Event → Mark attended
- Balance warning → Open Life Manager to add task

**Swipe Left:** Skip/Dismiss
- Task → Skip to next
- Event → Dismiss (still happens, just not tracking)
- Balance warning → Dismiss for today

**Tap:** Context action
- Task/Event → Show details (duration, notes)
- Energy slider → Adjust value
- Balance warning → Show domain stats

**Long Press:** Settings
- Opens Life Manager settings in launcher settings

## Energy Slider Design

**Visual:**
```
0────────●────────10
```

**Behavior:**
- Discrete steps (0-10, integers only)
- Smooth animation between steps
- Haptic feedback on each step
- Auto-submit after 2 seconds of no movement
- Shows current value above thumb

**Implementation:**
- Custom SeekBar with 11 steps (0-10)
- Thumb size: 24dp
- Track height: 2dp
- Active color: Theme foreground
- Inactive color: 20% opacity

## Layout Integration

**In fragment_home.xml:**

```xml
<!-- Clock and date (existing) -->
<LinearLayout android:id="@+id/dateTimeLayout" ... />

<!-- Home apps (existing) -->
<LinearLayout android:id="@+id/homeAppsLayout" ... />

<!-- NEW: Life Manager Widget -->
<LinearLayout
    android:id="@+id/lifeManagerContainer"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:layout_gravity="bottom|center_horizontal"
    android:layout_marginBottom="120dp"
    android:orientation="vertical"
    android:paddingHorizontal="20dp"
    android:visibility="gone"
    tools:visibility="visible">
    
    <!-- Text widget or Energy slider shown here -->
    
</LinearLayout>
```

**Positioning:**
- Bottom of screen (120dp from bottom)
- Below home apps
- Full width with 20dp horizontal padding
- Same horizontal alignment as clock/date and home apps
- Collapses when disabled (visibility="gone")

## Interaction Flow

### Task Completion
```
1. User swipes right on "Call Mom"
2. Widget fades out (200ms)
3. Next task fades in (200ms)
4. Haptic feedback (light)
5. No confirmation needed
```

### Energy Logging
```
1. Widget shows slider
2. User drags to 7/10
3. Waits 2 seconds (or taps outside)
4. Auto-submits to Life Manager
5. Widget shows next task
6. Haptic feedback (medium)
```

### Calendar Event
```
1. 15 min before: Widget shows event
2. Event starts: Widget stays visible
3. User swipes right: Mark attended
4. Widget shows next task or "All caught up"
5. Event ends automatically after duration
```

## Styling

**Colors:**
- Text: `?android:attr/textColorPrimary` (theme-aware)
- Subtle text: 60% opacity
- Hint text: 40% opacity
- Slider active: `?android:attr/textColorPrimary`
- Slider inactive: 20% opacity

**Typography:**
- Primary: 18sp, sans-serif-light
- Secondary: 14sp, sans-serif
- Hint: 12sp, sans-serif

**Spacing:**
- Horizontal margin: 20dp (matches OLauncher)
- Vertical padding: 8dp
- Line spacing: 1.2x

**Animations:**
- Fade in/out: 200ms
- Slide transitions: 300ms with decelerate interpolator
- Slider movement: 150ms with overshoot (subtle)

## Accessibility

- Minimum touch target: 48dp
- Content descriptions for gestures
- TalkBack support for slider
- High contrast mode support
- Respects system font size

## Edge Cases

**No internet:**
- Show last cached task
- Disable calendar event fetching
- Show "Offline" hint (12sp, 40% opacity)

**No tasks configured:**
- Show "Open Life Manager to add tasks"
- Swipe right → Opens Life Manager (deep link)

**Energy already logged:**
- Don't show slider
- Show next task immediately

**Multiple balance warnings:**
- Show most neglected domain first
- Cycle through on dismiss

## Implementation Notes

**Single TextView approach:**
- Use SpannableString for multi-line formatting
- Different text sizes via RelativeSizeSpan
- Different opacities via ForegroundColorSpan
- Simpler than nested layouts
- Matches OLauncher's text-only aesthetic

**Gesture detection:**
- OnTouchListener for swipes
- GestureDetector for tap/long press
- Minimum swipe distance: 100dp
- Minimum swipe velocity: 100dp/s

**State management:**
- Single `WidgetState` sealed class
- Reactive updates via LiveData
- Smooth transitions between states
- Persist last state for offline

## Future Enhancements

**Phase 2:**
- Swipe up → Show next 3 tasks
- Swipe down → Show yesterday's stats
- Double tap → Quick energy log (repeat last value)
- Optional domain icons (flat, minimal, user-configurable)

**Phase 3:**
- Customizable gestures
- Widget themes (minimal, detailed, compact, customemoji)
- Integration with OLauncher swipe actions
- Icon packs for task domains

**Phase 4:**
- Icon + text layouts (icon left, text right)
- Animated icon transitions

## Domain Icons (Optional)

**Design principles:**
- Flat, single-color (matches theme)
- 24dp size (small, not dominant)
- Left of task title
- Only shown if user enables in settings
- Default: no icons (text-only)

**Icon set (Material Design style):**
```
Health:        💪 (fitness_center / favorite)
Relationships: ❤️ (people / favorite_border)
University:    📚 (school / menu_book)
Admin:         📋 (assignment / description)
Creative:      🎨 (palette / lightbulb)
```

**Layout with icons:**
```
💪 Call Mom
   15 min • Health
```

**Implementation:**
- Use Material Icons (already in Android)
- Store icon preference in Prefs
- Render as compound drawable (left)
- Tint to match text color
- Graceful fallback if icon missing

**Settings:**
```
Life Manager Settings
├── Enable widget
├── Show domain icons [Toggle]
└── Customize icons [Opens icon picker]
```

**Icon picker:**
- Grid of Material Icons
- Search by name
- Preview with task text
- Reset to default option

## Comparison: Before vs After

**Before (from initial design):**
```
┌─────────────────────────────────┐
│ Life Manager                    │  ← Remove
│                                 │
│ Next: Call Mom                  │  ← Simplify
│ 15 min • Health                 │
│                                 │
│ Energy: ●●●●●●●○○○ 7/10        │  ← Only when needed
│                                 │
│ Balance: Health ⚠️ Admin ✓     │  ← Separate state
│                                 │
│ [✓ Done] [→ Skip] [⚡ Log]     │  ← Replace with gestures
└─────────────────────────────────┘
```

**After (refined):**
```
Call Mom
15 min • Health

[Swipe right to complete]  ← Hint fades
```

**Result:**
- 70% less visual clutter
- Gesture-based (no buttons)
- Matches OLauncher aesthetic
- Respects user's attention
- Brutally honest (shows what matters)
- Kind (clear path forward)
