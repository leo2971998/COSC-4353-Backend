# COSC-4353 Backend

A modularized Express.js backend for the volunteer management system.

## Project Structure

```
server/
├── index.js              # Entry point - starts HTTP listener
├── server.js             # Core app setup with CORS, middleware, auth endpoints
├── db.js                 # Database connection pool and utilities
├── routes/               # Route modules
│   ├── eventRoutes.js    # CRUD for events and event requests
│   ├── match.js          # Volunteer-event matching endpoints
│   ├── notifications.js  # Notification CRUD operations
│   ├── historyRoutes.js  # Volunteer history endpoints
│   └── vDashRoutes.js    # Volunteer dashboard features
├── controllers/          # Business logic controllers
│   ├── eventController.js        # Event retrieval and request management
│   ├── matchController.js        # Scoring algorithm for volunteer-event matching
│   ├── notificationsController.js # Notification storage (DB or in-memory)
│   ├── historyController.js      # Volunteer history data assembly
│   └── vDashController.js        # Volunteer dashboard CRUD operations
└── app/                  # Services layer
    ├── createApp.js      # Lightweight API factory for tests
    └── services.js       # Business logic separated from route wiring
```

## API Endpoints

### Authentication
- `POST /register` - User registration
- `POST /login` - User login
- `POST /profile` - Save user profile
- `GET /profile/:userId` - Get user profile

### Events
- `GET /events` - Get all events
- `POST /events` - Create new event
- `PUT /events/:id` - Update event
- `DELETE /events/:id` - Delete event
- `GET /events/by-id/:eventId` - Get event by ID
- `GET /events/:userId` - Get events by user
- `POST /events/:eventId/requests` - Create event request
- `POST /events/:eventId/requests/bulk` - Bulk create event requests
- `GET /events/:eventId/candidates` - Get candidate volunteers for event

### Matching
- `GET /api/match/:volunteerId` - Get matched events for volunteer
- `GET /suggested-events/:volunteerId` - Get suggested events (legacy)

### Volunteer Dashboard
- `POST /volunteer-dashboard/browse-enroll/:userId/:eventId` - Enroll in event
- `GET /volunteer-dashboard/enrolled-events/:userId` - Get enrolled events
- `GET /volunteer-dashboard/browse-events/:userId` - Get available events to browse
- `GET /volunteer-dashboard/calendar/:userId` - Get calendar data

### History
- `GET /history/:userId` - Get volunteer history
- `GET /volunteer-dashboard/:userId` - Get next confirmed event

### Notifications
- `GET /notifications` - Get all notifications
- `GET /notifications/:userId` - Get notifications by user
- `POST /notifications` - Create notification
- `GET /vr-notifications/:volunteerId` - Get volunteer request notifications

### Requests
- `GET /requests/event/:eventId` - Get requests for event
- `GET /requests/volunteer/:volunteerId` - Get requests for volunteer
- `PATCH /requests/:id` - Update request status

### Reports
- `GET /reports/event-summary` - Event summary report
- `GET /reports/volunteer-activity` - Volunteer activity report
- `GET /reports/volunteer-activity/by-event` - Volunteer activity by event
- `GET /reports/volunteer-activity/timeseries` - Volunteer activity timeseries
- `GET /reports/top-volunteers` - Top volunteers report

### Admin
- `GET /skills` - Get all skills
- `GET /users` - Get all users
- `PUT /users/:id/role` - Update user role
- `PUT /users/:id/password` - Update user password
- `DELETE /users/:id` - Delete user

### Utilities
- `GET /time` - Get server time

## Running the Server

```bash
# Install dependencies
npm install

# Start the server
npm start

# Development mode with auto-restart
npm run dev
```

The server will start on port 8080 by default, or the port specified in the `PORT` environment variable.

## Environment Variables

- `DB_HOST` - Database host (default: 192.168.1.198)
- `DB_USER` - Database user (default: Leo)
- `DB_PASSWORD` - Database password (default: Test=123!)
- `DB_NAME` - Database name (default: COSC4353)
- `USE_DB` - Enable database mode (set to "1" or "true")
- `PORT` - Server port (default: 8080)

## Architecture Benefits

This modular structure provides:

1. **Separation of Concerns** - Each module has a specific responsibility
2. **Maintainability** - Easy to find and modify specific functionality
3. **Scalability** - Easy to add new features without bloating single files
4. **Testability** - Controllers and services can be tested independently
5. **Reusability** - Business logic in services can be reused across routes