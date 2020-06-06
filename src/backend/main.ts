import * as express from 'express';
import * as path from 'path';

var app = express();

// Simple endpoint that returns the current time
app.get('/api/time', function(req, res) {
    res.send(new Date().toISOString());
});

// Simple endpoint that returns an about message
app.get('/api/about', function(req, res) {
    res.send('mail-scanner A utility to scan mailboxes for security issues');
});

// Serve static files
app.use('/', express.static(path.join(__dirname, '/www')));

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
