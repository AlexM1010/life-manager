# Life Manager

A local-first web app for life management built on Structural Optimism principles. Track tasks across life domains, adapt to energy levels, and maintain balance.

## Features

- **Domain Balance**: Track tasks across life areas (health, university, admin, relationships, creative projects)
- **Energy-Adaptive Planning**: Daily plans that respect your energy levels (0-10 scale)
- **Health Tracking**: Log sleep, energy, mood, and medication adherence
- **Streaks & Motivation**: Visual feedback on consistency across domains
- **Safety Guardrails**: Gentle prompts when patterns suggest support is needed
- **Weekly Summaries**: Plain-text reports for sharing with care teams
- **Google Sync**: Optional two-way sync with Google Calendar and Tasks

## Tech Stack

- **Frontend**: React 18 + Vite + Tailwind CSS
- **Backend**: Express + tRPC
- **Database**: SQLite + Drizzle ORM (local-first, zero-server)
- **Testing**: Vitest + fast-check (property-based testing)

## Getting Started

```bash
# Install dependencies
npm install

# Set up database
npm run db:migrate
npm run db:seed

# Start development server
npm run dev
```

Visit `http://localhost:5173` for the frontend, backend runs on `http://localhost:4000`.

## Development Commands

```bash
npm run dev              # Start both client and server
npm run dev:server       # Start backend only
npm run dev:client       # Start frontend only
npm run build            # Build for production
npm test                 # Run tests
npm run db:studio        # Open database browser
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for system design details.

## Philosophy

Built on Structural Optimism: integration across life domains creates wellbeing. The system treats relationship and health tasks as genuinely important, not optional.

## License

[GNU GPLv3](https://www.gnu.org/licenses/gpl-3.0.en.html)
