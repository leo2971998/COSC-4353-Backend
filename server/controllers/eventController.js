export async function listEvents(req, res) {
  res.json({ events: [] });
}

export async function createEvent(req, res) {
  res.status(201).json({ message: 'Event created' });
}
