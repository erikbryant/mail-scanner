// From https://developers.google.com/gmail/api/quickstart/nodejs

const fs = require('fs');
const readline = require('readline');

const Base64 = require('js-base64').Base64;
const { google } = require('googleapis');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

// Load client secrets from a local file.
fs.readFile(CREDENTIALS_PATH, (err, content) => {
    if (err)
        return console.log(
            'Error loading client secret file:',
            CREDENTIALS_PATH,
            err
        );

    // Authorize a client with credentials, then call the Gmail API.
    authorize(JSON.parse(content), getUsersEmail);
    authorize(JSON.parse(content), listMessages);
});

/**
 * Get the user's email address from the auth object.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function getUsersEmail(auth) {
    const gmail = google.gmail({
        version: 'v1',
        auth,
    });

    var request;
    try {
        request = await gmail.users.getProfile({
            userId: 'me',
        });
    } catch (err) {
        console.log('FAIL', err.response.data.error);
        // TODO: if transient error, retry
        return;
    }

    console.log(
        `mail-scanner is now processing account: ${request.data.emailAddress}`
    );
}

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(credentials, callback) {
    const { client_secret, client_id, redirect_uris } = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
    );

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
        if (err) return getNewToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token));
        callback(oAuth2Client);
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(oAuth2Client, callback) {
    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code) => {
        rl.close();
        oAuth2Client.getToken(code, (err, token) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

/**
 * Lists the messages in the user's mailbox (including trash and spam).
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listMessages(auth) {
    const gmail = google.gmail({ version: 'v1', auth });

    gmail.users.messages.list(
        {
            userId: 'me',
            includeSpamTrash: true,
        },
        (err, res) => {
            if (err) return console.log('The API returned an error: ' + err);
            if (res.data.resultSizeEstimate) {
                const messages = res.data.messages;
                messages.forEach(async (message) => {
                    scanMessageContents(auth, message);
                });
            } else {
                console.log('No messages found.');
            }
        }
    );
}

/**
 * Scans a single message for suspicious content.
 *
 * @async
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 * @param {Object} The id / threadId of the message to scan.
 */
async function scanMessageContents(auth, message) {
    const gmail = google.gmail({ version: 'v1', auth });

    var request = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
    });

    request.data.payload.headers.forEach((header) => {
        if (header.name === 'Subject') {
            message.subject = header.value;
        }
    });
    scanContent(message.subject, message);

    request = await gmail.users.threads.get({
        userId: 'me',
        id: message.threadId,
    });

    request.data.messages.forEach((thread) => {
        if (
            thread.payload.mimeType === 'text/html' ||
            thread.payload.mimeType === 'text/plain'
        ) {
            scanContent(Base64.decode(thread.payload.body.data), message);
        }
        scanParts(thread.payload.parts, message);
    });
}

/**
 * Scans a list of message parts for suspicious content.
 *
 * @param {Object[]} A list of message parts.
 * @param {Object} The message identifiers.
 */
function scanParts(parts, message) {
    if (!parts) {
        return;
    }

    parts.forEach((part) => {
        if (part.mimeType === 'text/html' || part.mimeType === 'text/plain') {
            scanContent(Base64.decode(part.body.data), message);
        }
        scanParts(part.parts, message);
    });
}

/**
 * Scans a single piece of text for suspicious content.
 *
 * @param {string} A string to scan for suspicious content.
 * @param {Object} The message identifiers.
 */
function scanContent(content, message) {
    if (content.includes('http://') || content.includes('https://')) {
        console.log('WARN: content contains links!', message);
    }
}
