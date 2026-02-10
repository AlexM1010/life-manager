import { GoogleCalendarClient } from './google-calendar-client.js';

/**
 * Completion Reader Service
 * 
 * Reads task completion and skip status from the plan calendar.
 * Life Launcher updates calendar events with Status: completed|skipped.
 * This service reads those updates for analytics.
 * 
 * Requirements: 1.2, 1.4
 */

export interface TaskCompletion {
  taskId: number;
  status: 'completed' | 'skipped';
  timestamp: Date;
  actualDuration?: number;
}

export class CompletionReader {
  private readonly PLAN_CALENDAR_NAME = "Life Manager - Today's Plan";
  
  constructor(private calendarClient: GoogleCalendarClient) {}

  /**
   * Read completion/skip status from plan calendar events
   * Life Launcher updates events with Status: completed|skipped
   * 
   * Validates: Requirement 1.2
   * 
   * @param oauth2Client - Configured OAuth2 client (auto-refreshes tokens)
   * @param date - Date to read completions for (ISO format YYYY-MM-DD)
   * @returns Array of task completions
   */
  async getCompletions(oauth2Client: any, date: string): Promise<TaskCompletion[]> {
    try {
      const calendarId = await this.getPlanCalendarId(oauth2Client);
      if (!calendarId) {
        return [];
      }

      const events = await this.getEventsForDate(oauth2Client, calendarId, date);
      const completions: TaskCompletion[] = [];

      for (const event of events) {
        const status = this.parseStatus(event.description);
        if (status === 'completed' || status === 'skipped') {
          const taskId = this.parseTaskId(event.description);
          const timestamp = this.parseTimestamp(event.description, status);

          if (taskId && timestamp) {
            completions.push({
              taskId,
              status,
              timestamp,
              actualDuration: this.parseActualDuration(event.description),
            });
          }
        }
      }

      return completions;
    } catch (error) {
      throw new Error(
        `Failed to get completions: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get the plan calendar ID
   * 
   * @param oauth2Client - Configured OAuth2 client
   * @returns Calendar ID or null if not found
   */
  private async getPlanCalendarId(oauth2Client: any): Promise<string | null> {
    const { google } = await import('googleapis');
    const calendar = google.calendar('v3');

    try {
      const calendarList = await calendar.calendarList.list({
        auth: oauth2Client,
      });

      const calendars = calendarList.data.items || [];
      const planCalendar = calendars.find(
        (cal) => cal.summary === this.PLAN_CALENDAR_NAME
      );

      return planCalendar?.id || null;
    } catch (error) {
      throw new Error(
        `Failed to get plan calendar: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get events for a specific date
   * 
   * @param oauth2Client - Configured OAuth2 client
   * @param calendarId - Calendar ID
   * @param date - Date in ISO format (YYYY-MM-DD)
   * @returns Array of calendar events
   */
  private async getEventsForDate(
    oauth2Client: any,
    calendarId: string,
    date: string
  ): Promise<any[]> {
    const { google } = await import('googleapis');
    const calendar = google.calendar('v3');

    try {
      // Parse date and create start/end of day
      const [year, month, day] = date.split('-').map(Number);
      const startOfDay = new Date(year, month - 1, day, 0, 0, 0);
      const endOfDay = new Date(year, month - 1, day, 23, 59, 59);

      const response = await calendar.events.list({
        auth: oauth2Client,
        calendarId,
        timeMin: startOfDay.toISOString(),
        timeMax: endOfDay.toISOString(),
        singleEvents: true,
      });

      return response.data.items || [];
    } catch (error) {
      throw new Error(
        `Failed to get events: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Parse status from event description
   * 
   * Extracts: completed|skipped|pending
   * 
   * @param description - Event description
   * @returns Status or null if not found
   */
  parseStatus(description: string | undefined | null): string | null {
    if (!description) return null;
    const match = description.match(/Status:\s*(\w+)/);
    return match ? match[1] : null;
  }

  /**
   * Parse task ID from event description
   * 
   * Extracts: Task ID: [number]
   * 
   * @param description - Event description
   * @returns Task ID or null if not found
   */
  parseTaskId(description: string | undefined | null): number | null {
    if (!description) return null;
    const match = description.match(/Task ID:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Parse timestamp from event description
   * 
   * Extracts: CompletedAt or SkippedAt timestamp
   * 
   * @param description - Event description
   * @param status - Status type (completed or skipped)
   * @returns Timestamp or null if not found
   */
  parseTimestamp(
    description: string | undefined | null,
    status: string
  ): Date | null {
    if (!description) return null;
    const key = status === 'completed' ? 'CompletedAt' : 'SkippedAt';
    const match = description.match(new RegExp(`${key}:\\s*([\\d\\-T:.Z]+)`));
    return match ? new Date(match[1]) : null;
  }

  /**
   * Parse actual duration from event description
   * 
   * Extracts: ActualDuration: [number]
   * 
   * @param description - Event description
   * @returns Actual duration in minutes or undefined if not found
   */
  private parseActualDuration(description: string | undefined | null): number | undefined {
    if (!description) return undefined;
    const match = description.match(/ActualDuration:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : undefined;
  }
}
