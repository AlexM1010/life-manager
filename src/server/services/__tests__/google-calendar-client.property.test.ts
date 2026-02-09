import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleCalendarClient } from '../google-calendar-client.js';
import { google, calendar_v3 } from 'googleapis';
import * as fc from 'fast-check';

/**
 * Google Calendar Client Property Tests
 * 
 * Property-based tests for Google Calendar Client:
 * - Property 4: Today's Instance Filtering
 * 
 * Feature: google-calendar-sync, Property 4: Today's Instance Filtering
 * Validates Requirements: 2.3
 */

// Mock googleapis
vi.mock('googleapis', () => {
  const mockCalendar = {
    events: {
      list: vi.fn(),
      insert: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };

  const mockOAuth2 = vi.fn(() => ({
    setCredentials: vi.fn(),
  }));

  return {
    google: {
      calendar: vi.fn(() => mockCalendar),
      auth: {
        OAuth2: mockOAuth2,
      },
    },
  };
});

describe('Google Calendar Client - Property Tests', () => {
  let client: GoogleCalendarClient;
  let mockCalendar: any;
  let mockOAuth2Client: any;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new GoogleCalendarClient();
    mockCalendar = google.calendar('v3');
    
    // Create mock OAuth2 client
    mockOAuth2Client = {
      setCredentials: vi.fn(),
      credentials: {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
      },
    };
  });

  // ============================================================================
  // Arbitraries (Generators) for Property-Based Testing
  // ============================================================================

  /**
   * Generate a valid event ID
   */
  const eventIdArb = fc.string({ 
    minLength: 5, 
    maxLength: 50,
    unit: fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789_-'.split('')
    )
  });

  /**
   * Generate a valid event summary (title)
   */
  const eventSummaryArb = fc.string({ 
    minLength: 1, 
    maxLength: 100 
  }).filter(s => s.trim().length > 0);

  /**
   * Generate today's date at a specific hour
   */
  const todayHourArb = fc.integer({ min: 0, max: 23 });

  /**
   * Generate a date for today at a specific hour
   */
  const todayDateAtHourArb = (hour: number): Date => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, 0, 0);
  };

  /**
   * Generate a date for yesterday at a specific hour
   * (Currently unused - kept for future tests)
   */
  /*
  /*  */

  /**
   * Generate a date for tomorrow at a specific hour
   */
  /*  */

  /**
   * Generate a date for a past day (2-30 days ago)
   */
  /*  */

  /**
   * Generate a date for a future day (2-30 days from now)
   */
  /*  */

  /**
   * Generate a recurring event ID (base ID for the series)
   */
  const recurringEventIdArb = fc.string({ 
    minLength: 5, 
    maxLength: 30,
    unit: fc.constantFrom(
      ...'abcdefghijklmnopqrstuvwxyz0123456789'.split('')
    )
  });

  /**
   * Generate a calendar event for today
   */
  const todayEventArb = fc.record({
    id: eventIdArb,
    summary: eventSummaryArb,
    startHour: todayHourArb,
    durationHours: fc.integer({ min: 1, max: 4 }),
    recurringEventId: fc.option(recurringEventIdArb, { nil: undefined }),
  }).map(({ id, summary, startHour, durationHours, recurringEventId }) => {
    const start = todayDateAtHourArb(startHour);
    const end = new Date(start);
    end.setHours(end.getHours() + durationHours);
    
    return {
      id,
      summary,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      recurringEventId,
    };
  });

  /**
   * Generate a calendar event for yesterday
   * (Currently unused - kept for future tests)
   */
  /*
  const yesterdayEventArb = fc.record({
    id: eventIdArb,
    summary: eventSummaryArb,
    startHour: todayHourArb,
    durationHours: fc.integer({ min: 1, max: 4 }),
    recurringEventId: fc.option(recurringEventIdArb, { nil: undefined }),
  }).map(({ id, summary, startHour, durationHours, recurringEventId }) => {
    const start = yesterdayDateAtHourArb(startHour);
    const end = new Date(start);
    end.setHours(end.getHours() + durationHours);
    
    return {
      id,
      summary,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      recurringEventId,
    };
  });
  */

  /**
   * Generate a calendar event for tomorrow
   * (Currently unused - kept for future tests)
   */
  /*
  const tomorrowEventArb = fc.record({
    id: eventIdArb,
    summary: eventSummaryArb,
    startHour: todayHourArb,
    durationHours: fc.integer({ min: 1, max: 4 }),
    recurringEventId: fc.option(recurringEventIdArb, { nil: undefined }),
  }).map(({ id, summary, startHour, durationHours, recurringEventId }) => {
    const start = tomorrowDateAtHourArb(startHour);
    const end = new Date(start);
    end.setHours(end.getHours() + durationHours);
    
    return {
      id,
      summary,
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      recurringEventId,
    };
  });
  */

  /**
   * Generate a calendar event for a past day
   * (Currently unused - kept for future tests)
   */
  /*
  const pastEventArb = fc.record({
    id: eventIdArb,
    summary: eventSummaryArb,
    startDate: pastDateArb,
    durationHours: fc.integer({ min: 1, max: 4 }),
    recurringEventId: fc.option(recurringEventIdArb, { nil: undefined }),
  }).map(({ id, summary, startDate, durationHours, recurringEventId }) => {
    const end = new Date(startDate);
    end.setHours(end.getHours() + durationHours);
    
    return {
      id,
      summary,
      start: { dateTime: startDate.toISOString() },
      end: { dateTime: end.toISOString() },
      recurringEventId,
    };
  });
  */

  /**
   * Generate a calendar event for a future day
   * (Currently unused - kept for future tests)
   */
  /*
  const futureEventArb = fc.record({
    id: eventIdArb,
    summary: eventSummaryArb,
    startDate: futureDateArb,
    durationHours: fc.integer({ min: 1, max: 4 }),
    recurringEventId: fc.option(recurringEventIdArb, { nil: undefined }),
  }).map(({ id, summary, startDate, durationHours, recurringEventId }) => {
    const end = new Date(startDate);
    end.setHours(end.getHours() + durationHours);
    
    return {
      id,
      summary,
      start: { dateTime: startDate.toISOString() },
      end: { dateTime: end.toISOString() },
      recurringEventId,
    };
  });
  */

  // ============================================================================
  // Helper Functions
  // ============================================================================

  /**
   * Check if a date is today
   */
  const isToday = (date: Date): boolean => {
    const now = new Date();
    return (
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate()
    );
  };

  /**
   * Check if an event is scheduled for today
   * (Currently unused - kept for future tests)
   */
  /*
  const isEventToday = (event: calendar_v3.Schema$Event): boolean => {
    if (!event.start?.dateTime) return false;
    const startDate = new Date(event.start.dateTime);
    return isToday(startDate);
  };
  */

  // ============================================================================
  // Property-Based Tests
  // ============================================================================

  /**
   * Property 4: Today's Instance Filtering
   * 
   * **Feature: google-calendar-sync, Property 4: Today's Instance Filtering**
   * **Validates: Requirements 2.3**
   * 
   * For any recurring calendar event or recurring Google Task, the import 
   * operation should include only the instance with a date matching today, 
   * excluding past and future instances.
   * 
   * This property ensures that:
   * 1. The API is called with correct date range (today's start to end)
   * 2. The API is called with singleEvents=true to expand recurring events
   * 3. Only events returned by the API (which are today's events) are processed
   * 4. Recurring event IDs are preserved for today's instances
   * 5. The filtering works correctly regardless of event count or distribution
   * 
   * Note: The actual date filtering is done by Google Calendar API via timeMin/timeMax.
   * Our client's responsibility is to call the API with the correct parameters.
   */
  it('Property 4: Today\'s Instance Filtering', async () => {
    await fc.assert(
      fc.asyncProperty(
        // Generate only today's events (simulating what Google API would return after filtering)
        fc.array(todayEventArb, { minLength: 0, maxLength: 10 }),
        async (todayEvents) => {
          // Mock the Google Calendar API response (API already filtered to today)
          mockCalendar.events.list.mockResolvedValue({
            data: { items: todayEvents },
          });

          // Call getTodayEvents
          const result = await client.getTodayEvents(mockOAuth2Client);

          // Verify API was called with correct parameters
          expect(mockCalendar.events.list).toHaveBeenCalled();
          const callArgs = mockCalendar.events.list.mock.calls[0][0];
          
          // Verify singleEvents is true (expands recurring events)
          expect(callArgs.singleEvents).toBe(true);
          
          // Verify timeMin and timeMax are set to today's range
          const timeMin = new Date(callArgs.timeMin);
          const timeMax = new Date(callArgs.timeMax);
          expect(isToday(timeMin)).toBe(true);
          expect(isToday(timeMax)).toBe(true);
          
          // Verify timeMin is start of day (00:00:00)
          expect(timeMin.getHours()).toBe(0);
          expect(timeMin.getMinutes()).toBe(0);
          expect(timeMin.getSeconds()).toBe(0);
          
          // Verify timeMax is end of day (23:59:59)
          expect(timeMax.getHours()).toBe(23);
          expect(timeMax.getMinutes()).toBe(59);
          expect(timeMax.getSeconds()).toBe(59);

          // Verify that all returned events are from today
          expect(result.length).toBe(todayEvents.length);
          for (const event of result) {
            // Event must start today
            expect(isToday(event.start)).toBe(true);
            // Event end can be today or early tomorrow (for events spanning midnight)
            // This is acceptable as long as the event starts today
          }

          // Verify that all today's events are included
          const resultIds = new Set(result.map(e => e.id));
          for (const todayEvent of todayEvents) {
            expect(resultIds.has(todayEvent.id)).toBe(true);
          }

          // Verify recurring event IDs are preserved for today's instances
          for (const todayEvent of todayEvents) {
            if (todayEvent.recurringEventId) {
              const resultEvent = result.find(e => e.id === todayEvent.id);
              expect(resultEvent).toBeDefined();
              expect(resultEvent?.recurringEventId).toBe(todayEvent.recurringEventId);
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4 (Edge Case): Empty event list
   * 
   * When there are no events at all, getTodayEvents should return an empty array.
   */
  it('Property 4 (Edge Case): Empty event list returns empty array', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constant([]), // Empty array
        async (emptyEvents) => {
          mockCalendar.events.list.mockResolvedValue({
            data: { items: emptyEvents },
          });

          const result = await client.getTodayEvents(mockOAuth2Client);

          // Verify API was called with correct date range
          const callArgs = mockCalendar.events.list.mock.calls[0][0];
          expect(callArgs.singleEvents).toBe(true);
          expect(isToday(new Date(callArgs.timeMin))).toBe(true);
          expect(isToday(new Date(callArgs.timeMax))).toBe(true);

          expect(result).toEqual([]);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4 (Edge Case): Only today's events
   * 
   * When all events are today, getTodayEvents should return all of them.
   */
  it('Property 4 (Edge Case): Only today\'s events returns all events', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(todayEventArb, { minLength: 1, maxLength: 10 }),
        async (todayEvents) => {
          mockCalendar.events.list.mockResolvedValue({
            data: { items: todayEvents },
          });

          const result = await client.getTodayEvents(mockOAuth2Client);

          // Verify API was called with correct date range
          const callArgs = mockCalendar.events.list.mock.calls[0][0];
          expect(callArgs.singleEvents).toBe(true);
          expect(isToday(new Date(callArgs.timeMin))).toBe(true);
          expect(isToday(new Date(callArgs.timeMax))).toBe(true);

          expect(result.length).toBe(todayEvents.length);

          // Verify all events are included
          const resultIds = new Set(result.map(e => e.id));
          for (const todayEvent of todayEvents) {
            expect(resultIds.has(todayEvent.id)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4 (Recurring Events): Recurring event instances are filtered correctly
   * 
   * For recurring events, the Google Calendar API (with singleEvents=true and timeMin/timeMax)
   * returns only today's instance. We verify that:
   * 1. The API is called with singleEvents=true
   * 2. The recurringEventId is preserved in the returned event
   * 3. Only today's instance is processed
   */
  it('Property 4 (Recurring Events): Only today\'s recurring instance is returned', async () => {
    await fc.assert(
      fc.asyncProperty(
        recurringEventIdArb,
        eventSummaryArb,
        todayHourArb,
        async (recurringId, summary, todayHour) => {
          // Create today's instance of a recurring event
          // (Google API would have already filtered out other instances)
          const todayInstance = {
            id: `${recurringId}_today`,
            summary,
            start: { dateTime: todayDateAtHourArb(todayHour).toISOString() },
            end: { dateTime: new Date(todayDateAtHourArb(todayHour).getTime() + 3600000).toISOString() },
            recurringEventId: recurringId,
          };

          mockCalendar.events.list.mockResolvedValue({
            data: { items: [todayInstance] },
          });

          const result = await client.getTodayEvents(mockOAuth2Client);

          // Verify API was called with singleEvents=true (expands recurring events)
          const callArgs = mockCalendar.events.list.mock.calls[0][0];
          expect(callArgs.singleEvents).toBe(true);

          // Should return exactly one instance (today's)
          expect(result.length).toBe(1);
          expect(result[0].id).toBe(todayInstance.id);
          expect(result[0].recurringEventId).toBe(recurringId);
          expect(isToday(result[0].start)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 4 (Multiple Recurring Series): Multiple recurring series are filtered independently
   * 
   * When there are multiple recurring event series, the Google Calendar API returns
   * only today's instance for each series. We verify that each series' today instance
   * is correctly processed and the recurringEventId is preserved.
   */
  it('Property 4 (Multiple Recurring Series): Each series filtered independently', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            recurringId: recurringEventIdArb,
            summary: eventSummaryArb,
            todayHour: todayHourArb,
          }),
          { minLength: 1, maxLength: 5 }
        ),
        async (recurringSeries) => {
          // Create today's instance for each recurring series
          // (Google API would have already filtered to only today's instances)
          const todayInstances: calendar_v3.Schema$Event[] = [];
          
          for (const series of recurringSeries) {
            todayInstances.push({
              id: `${series.recurringId}_today`,
              summary: series.summary,
              start: { dateTime: todayDateAtHourArb(series.todayHour).toISOString() },
              end: { dateTime: new Date(todayDateAtHourArb(series.todayHour).getTime() + 3600000).toISOString() },
              recurringEventId: series.recurringId,
            });
          }

          mockCalendar.events.list.mockResolvedValue({
            data: { items: todayInstances },
          });

          const result = await client.getTodayEvents(mockOAuth2Client);

          // Verify API was called with singleEvents=true
          const callArgs = mockCalendar.events.list.mock.calls[0][0];
          expect(callArgs.singleEvents).toBe(true);

          // Should return exactly one instance per series (all today's instances)
          expect(result.length).toBe(recurringSeries.length);

          // Verify each series has exactly one today instance
          const recurringIds = new Set(recurringSeries.map(s => s.recurringId));
          for (const recurringId of recurringIds) {
            const instancesForSeries = result.filter(e => e.recurringEventId === recurringId);
            expect(instancesForSeries.length).toBe(1);
            expect(isToday(instancesForSeries[0].start)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});


