import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleCalendarClient, CalendarEventInput } from '../google-calendar-client.js';
import { google } from 'googleapis';

/**
 * Unit tests for Google Calendar Client
 * 
 * Tests event fetching, creation, updating, and deletion with mocked API responses.
 * 
 * Requirements: 2.1, 2.2, 2.3, 5.2, 6.2
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

describe('GoogleCalendarClient', () => {
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

  describe('getTodayEvents', () => {
    it('should fetch and transform today\'s events', async () => {
      // Mock API response
      const mockEvents = [
        {
          id: 'event1',
          summary: 'Team Meeting',
          description: 'Weekly sync',
          location: 'Conference Room A',
          start: { dateTime: '2024-01-15T10:00:00Z' },
          end: { dateTime: '2024-01-15T11:00:00Z' },
          attendees: [{ email: 'alice@example.com' }, { email: 'bob@example.com' }],
        },
        {
          id: 'event2',
          summary: 'Lunch Break',
          start: { dateTime: '2024-01-15T12:00:00Z' },
          end: { dateTime: '2024-01-15T13:00:00Z' },
        },
      ];

      mockCalendar.events.list.mockResolvedValue({
        data: { items: mockEvents },
      });

      const events = await client.getTodayEvents(mockOAuth2Client);

      // Verify API was called correctly
      expect(mockCalendar.events.list).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: mockOAuth2Client,
          calendarId: 'primary',
          singleEvents: true,
          orderBy: 'startTime',
        })
      );

      // Verify events were transformed correctly
      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({
        id: 'event1',
        summary: 'Team Meeting',
        description: 'Weekly sync',
        location: 'Conference Room A',
        start: new Date('2024-01-15T10:00:00Z'),
        end: new Date('2024-01-15T11:00:00Z'),
        attendees: ['alice@example.com', 'bob@example.com'],
        recurringEventId: undefined,
      });
      expect(events[1]).toEqual({
        id: 'event2',
        summary: 'Lunch Break',
        description: undefined,
        location: undefined,
        start: new Date('2024-01-15T12:00:00Z'),
        end: new Date('2024-01-15T13:00:00Z'),
        attendees: undefined,
        recurringEventId: undefined,
      });
    });

    it('should filter out all-day events without time', async () => {
      // Mock API response with all-day event
      const mockEvents = [
        {
          id: 'event1',
          summary: 'Timed Event',
          start: { dateTime: '2024-01-15T10:00:00Z' },
          end: { dateTime: '2024-01-15T11:00:00Z' },
        },
        {
          id: 'event2',
          summary: 'All Day Event',
          start: { date: '2024-01-15' }, // All-day event (no dateTime)
          end: { date: '2024-01-15' },
        },
      ];

      mockCalendar.events.list.mockResolvedValue({
        data: { items: mockEvents },
      });

      const events = await client.getTodayEvents(mockOAuth2Client);

      // Should only include timed events
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('event1');
    });

    it('should handle recurring events with recurringEventId', async () => {
      // Mock API response with recurring event instance
      const mockEvents = [
        {
          id: 'event1_20240115',
          summary: 'Daily Standup',
          start: { dateTime: '2024-01-15T09:00:00Z' },
          end: { dateTime: '2024-01-15T09:15:00Z' },
          recurringEventId: 'event1',
        },
      ];

      mockCalendar.events.list.mockResolvedValue({
        data: { items: mockEvents },
      });

      const events = await client.getTodayEvents(mockOAuth2Client);

      // Verify recurring event ID is preserved
      expect(events).toHaveLength(1);
      expect(events[0].recurringEventId).toBe('event1');
    });

    it('should handle empty event list', async () => {
      mockCalendar.events.list.mockResolvedValue({
        data: { items: [] },
      });

      const events = await client.getTodayEvents(mockOAuth2Client);

      expect(events).toEqual([]);
    });

    it('should handle API errors', async () => {
      mockCalendar.events.list.mockRejectedValue(new Error('API rate limit exceeded'));

      await expect(client.getTodayEvents(mockOAuth2Client)).rejects.toThrow(
        'Failed to fetch calendar events: API rate limit exceeded'
      );
    });
  });

  describe('createEvent', () => {
    it('should create a calendar event with all fields', async () => {
      const mockEventId = 'created-event-123';
      mockCalendar.events.insert.mockResolvedValue({
        data: { id: mockEventId },
      });

      const accessToken = 'test-access-token';
      const eventInput: CalendarEventInput = {
        summary: 'New Meeting',
        description: 'Important discussion',
        location: 'Room 101',
        start: new Date('2024-01-15T14:00:00Z'),
        end: new Date('2024-01-15T15:00:00Z'),
      };

      const eventId = await client.createEvent(accessToken, eventInput);

      // Verify API was called correctly
      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'primary',
          requestBody: expect.objectContaining({
            summary: 'New Meeting',
            description: 'Important discussion',
            location: 'Room 101',
            start: expect.objectContaining({
              dateTime: '2024-01-15T14:00:00.000Z',
            }),
            end: expect.objectContaining({
              dateTime: '2024-01-15T15:00:00.000Z',
            }),
          }),
        })
      );

      expect(eventId).toBe(mockEventId);
    });

    it('should create a calendar event with minimal fields', async () => {
      const mockEventId = 'created-event-456';
      mockCalendar.events.insert.mockResolvedValue({
        data: { id: mockEventId },
      });

      const accessToken = 'test-access-token';
      const eventInput: CalendarEventInput = {
        summary: 'Quick Task',
        start: new Date('2024-01-15T16:00:00Z'),
        end: new Date('2024-01-15T16:30:00Z'),
      };

      const eventId = await client.createEvent(accessToken, eventInput);

      // Verify API was called with only required fields
      expect(mockCalendar.events.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: expect.objectContaining({
            summary: 'Quick Task',
            description: undefined,
            location: undefined,
          }),
        })
      );

      expect(eventId).toBe(mockEventId);
    });

    it('should handle API errors during creation', async () => {
      mockCalendar.events.insert.mockRejectedValue(new Error('Insufficient permissions'));

      const accessToken = 'test-access-token';
      const eventInput: CalendarEventInput = {
        summary: 'Test Event',
        start: new Date('2024-01-15T10:00:00Z'),
        end: new Date('2024-01-15T11:00:00Z'),
      };

      await expect(client.createEvent(accessToken, eventInput)).rejects.toThrow(
        'Failed to create calendar event: Insufficient permissions'
      );
    });

    it('should handle missing event ID in response', async () => {
      mockCalendar.events.insert.mockResolvedValue({
        data: {}, // No ID
      });

      const accessToken = 'test-access-token';
      const eventInput: CalendarEventInput = {
        summary: 'Test Event',
        start: new Date('2024-01-15T10:00:00Z'),
        end: new Date('2024-01-15T11:00:00Z'),
      };

      await expect(client.createEvent(accessToken, eventInput)).rejects.toThrow(
        'No event ID returned from Google Calendar'
      );
    });
  });

  describe('updateEvent', () => {
    it('should update all event fields', async () => {
      mockCalendar.events.patch.mockResolvedValue({ data: {} });

      const accessToken = 'test-access-token';
      const eventId = 'event-123';
      const updates: Partial<CalendarEventInput> = {
        summary: 'Updated Meeting',
        description: 'New description',
        location: 'New Room',
        start: new Date('2024-01-15T15:00:00Z'),
        end: new Date('2024-01-15T16:00:00Z'),
      };

      await client.updateEvent(accessToken, eventId, updates);

      // Verify API was called correctly
      expect(mockCalendar.events.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'primary',
          eventId: 'event-123',
          requestBody: expect.objectContaining({
            summary: 'Updated Meeting',
            description: 'New description',
            location: 'New Room',
            start: expect.objectContaining({
              dateTime: '2024-01-15T15:00:00.000Z',
            }),
            end: expect.objectContaining({
              dateTime: '2024-01-15T16:00:00.000Z',
            }),
          }),
        })
      );
    });

    it('should update only specified fields', async () => {
      mockCalendar.events.patch.mockResolvedValue({ data: {} });

      const accessToken = 'test-access-token';
      const eventId = 'event-123';
      const updates: Partial<CalendarEventInput> = {
        summary: 'New Title',
      };

      await client.updateEvent(accessToken, eventId, updates);

      // Verify only summary was included in update
      expect(mockCalendar.events.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          requestBody: {
            summary: 'New Title',
          },
        })
      );
    });

    it('should handle API errors during update', async () => {
      mockCalendar.events.patch.mockRejectedValue(new Error('Event not found'));

      const accessToken = 'test-access-token';
      const eventId = 'nonexistent-event';
      const updates: Partial<CalendarEventInput> = {
        summary: 'Updated Title',
      };

      await expect(client.updateEvent(accessToken, eventId, updates)).rejects.toThrow(
        'Failed to update calendar event: Event not found'
      );
    });
  });

  describe('deleteEvent', () => {
    it('should delete a calendar event', async () => {
      mockCalendar.events.delete.mockResolvedValue({ data: {} });

      const accessToken = 'test-access-token';
      const eventId = 'event-to-delete';

      await client.deleteEvent(accessToken, eventId);

      // Verify API was called correctly
      expect(mockCalendar.events.delete).toHaveBeenCalledWith(
        expect.objectContaining({
          calendarId: 'primary',
          eventId: 'event-to-delete',
        })
      );
    });

    it('should handle API errors during deletion', async () => {
      mockCalendar.events.delete.mockRejectedValue(new Error('Event not found'));

      const accessToken = 'test-access-token';
      const eventId = 'nonexistent-event';

      await expect(client.deleteEvent(accessToken, eventId)).rejects.toThrow(
        'Failed to delete calendar event: Event not found'
      );
    });
  });
});

