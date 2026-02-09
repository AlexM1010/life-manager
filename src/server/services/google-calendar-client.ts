import { google, calendar_v3 } from 'googleapis';

/**
 * Google Calendar Client
 * 
 * Interfaces with Google Calendar API for time-blocking and event management.
 * 
 * Requirements: 2.1, 2.2, 2.3, 5.2, 6.2
 */

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
  attendees?: string[];
  recurringEventId?: string; // For recurring events
}

export interface CalendarEventInput {
  summary: string;
  description?: string;
  location?: string;
  start: Date;
  end: Date;
}

export class GoogleCalendarClient {
  private calendar: calendar_v3.Calendar;

  constructor() {
    this.calendar = google.calendar('v3');
  }

  /**
   * Fetch today's calendar events
   * 
   * Validates: Requirements 2.1, 2.2, 2.3
   * 
   * @param oauth2Client - Configured OAuth2 client (auto-refreshes tokens)
   * @returns Array of calendar events for today
   */
  async getTodayEvents(oauth2Client: any): Promise<CalendarEvent[]> {
    try {

      // Calculate today's date range (start of day to end of day in local timezone)
      const now = new Date();
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
      const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

      // Fetch events from Google Calendar
      const response = await this.calendar.events.list({
        auth: oauth2Client,
        calendarId: 'primary',
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true, // Expand recurring events into individual instances
        orderBy: 'startTime',
      });

      const events = response.data.items || [];

      // Transform Google Calendar events to our format
      return events
        .filter((event) => {
          // Must have id and summary
          if (!event.id || !event.summary) {
            console.log(`[GoogleCalendarClient] Skipping event with missing id or summary: ${JSON.stringify({ id: event.id, summary: event.summary, status: event.status })}`);
            return false;
          }
          // Only include events with specific times (dateTime)
          // All-day events (date only) are filtered out
          return !!(event.start?.dateTime && event.end?.dateTime);
        })
        .map((event) => this.transformEvent(event));
    } catch (error) {
      throw new Error(
        `Failed to fetch calendar events: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Create a calendar event (time block)
   * 
   * Validates: Requirements 5.2
   * 
   * @param oauth2Client - Configured OAuth2 client (auto-refreshes tokens)
   * @param event - Event data to create
   * @returns Created event ID
   */
  async createEvent(oauth2Client: any, event: CalendarEventInput): Promise<string> {
    try {
      // Create event in Google Calendar
      const response = await this.calendar.events.insert({
        auth: oauth2Client,
        calendarId: 'primary',
        requestBody: {
          summary: event.summary,
          description: event.description,
          location: event.location,
          start: {
            dateTime: event.start.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          end: {
            dateTime: event.end.toISOString(),
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
        },
      });

      if (!response.data.id) {
        throw new Error('No event ID returned from Google Calendar');
      }

      return response.data.id;
    } catch (error) {
      throw new Error(
        `Failed to create calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Update an existing calendar event
   * 
   * Validates: Requirements 6.2
   * 
   * @param oauth2Client - Configured OAuth2 client (auto-refreshes tokens)
   * @param eventId - Google Calendar event ID
   * @param updates - Partial event data to update
   */
  async updateEvent(
    oauth2Client: any,
    eventId: string,
    updates: Partial<CalendarEventInput>
  ): Promise<void> {
    try {

      // Build update payload
      const updatePayload: calendar_v3.Schema$Event = {};

      if (updates.summary !== undefined) {
        updatePayload.summary = updates.summary;
      }

      if (updates.description !== undefined) {
        updatePayload.description = updates.description;
      }

      if (updates.location !== undefined) {
        updatePayload.location = updates.location;
      }

      if (updates.start !== undefined) {
        updatePayload.start = {
          dateTime: updates.start.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      }

      if (updates.end !== undefined) {
        updatePayload.end = {
          dateTime: updates.end.toISOString(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        };
      }

      // Update event in Google Calendar
      await this.calendar.events.patch({
        auth: oauth2Client,
        calendarId: 'primary',
        eventId,
        requestBody: updatePayload,
      });
    } catch (error) {
      throw new Error(
        `Failed to update calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Delete a calendar event
   * 
   * Validates: Requirements 6.2 (cleanup operations)
   * 
   * @param oauth2Client - Configured OAuth2 client (auto-refreshes tokens)
   * @param eventId - Google Calendar event ID
   */
  async deleteEvent(oauth2Client: any, eventId: string): Promise<void> {
    try {
      // Delete event from Google Calendar
      await this.calendar.events.delete({
        auth: oauth2Client,
        calendarId: 'primary',
        eventId,
      });
    } catch (error) {
      throw new Error(
        `Failed to delete calendar event: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Transform Google Calendar event to our format
   * 
   * @param event - Google Calendar event
   * @returns Transformed calendar event
   */
  private transformEvent(event: calendar_v3.Schema$Event): CalendarEvent {
    if (!event.id || !event.summary) {
      throw new Error('Invalid event data from Google Calendar');
    }

    // Handle both timed events (dateTime) and all-day events (date)
    const startStr = event.start?.dateTime || event.start?.date;
    const endStr = event.end?.dateTime || event.end?.date;

    if (!startStr || !endStr) {
      throw new Error('Invalid event data from Google Calendar: missing start/end');
    }

    return {
      id: event.id,
      summary: event.summary,
      description: event.description || undefined,
      location: event.location || undefined,
      start: new Date(startStr),
      end: new Date(endStr),
      attendees: event.attendees?.map((a) => a.email || '').filter(Boolean),
      recurringEventId: event.recurringEventId || undefined,
    };
  }
}
