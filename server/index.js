// server/index.js - Entry point: imports the configured Express app and starts the HTTP listener
import app from './server.js';

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`✅  Server running on port ${PORT}`); // eslint-disable-line no-console
});