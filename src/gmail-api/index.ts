// From https://developers.google.com/gmail/api/quickstart/nodejs

import fs from 'fs';
import readline from 'readline';
import StatsD from 'hot-shots';

const Base64 = require('js-base64').Base64;
const { google } = require('googleapis');

const dogstatsd = new StatsD();

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];

// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = 'token.json';
const CREDENTIALS_PATH = 'credentials.json';

// Load client secrets from a local file.
fs.readFile(CREDENTIALS_PATH, (err: any, content: Buffer) => {
    if (err)
        return console.log(
            'Error loading client secret file:',
            CREDENTIALS_PATH,
            err
        );

    // Authorize a client with credentials, then call the Gmail API.
    authorize(JSON.parse(content.toString()), listMessages);
});

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
function authorize(
    credentials: {
        web: { client_secret: any; client_id: any; redirect_uris: any };
    },
    callback: { (auth: any): void; (auth: any): void; (arg0: any): void }
) {
    dogstatsd.increment('authentication.attempts');

    const { client_secret, client_id, redirect_uris } = credentials.web;
    const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirect_uris[0]
    );

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err: any, token: Buffer) => {
        if (err) return getNewToken(oAuth2Client, callback);
        oAuth2Client.setCredentials(JSON.parse(token.toString()));
        callback(oAuth2Client);
    });
}

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
function getNewToken(
    oAuth2Client: {
        generateAuthUrl: (arg0: {
            access_type: string;
            scope: string[];
        }) => any;
        getToken: (arg0: any, arg1: (err: any, token: any) => void) => void;
        setCredentials: (arg0: any) => void;
    },
    callback: (arg0: any) => void
) {
    dogstatsd.increment('authentication.newToken');

    const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
    });
    console.log('Authorize this app by visiting this url:', authUrl);
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    rl.question('Enter the code from that page here: ', (code: any) => {
        rl.close();
        oAuth2Client.getToken(code, (err: any, token: any) => {
            if (err) return console.error('Error retrieving access token', err);
            oAuth2Client.setCredentials(token);
            // Store the token to disk for later program executions
            fs.writeFile(TOKEN_PATH, JSON.stringify(token), (err: any) => {
                if (err) return console.error(err);
                console.log('Token stored to', TOKEN_PATH);
            });
            callback(oAuth2Client);
        });
    });
}

/**
 * Get the user's email address from the auth object.
 *
 * @async
 * @param {google.auth.OAuth2} An authorized OAuth2 client.
 *
 * @returns {string} The user's email address, or '' if it cannot be retrieved.
 */
async function getUsersEmail(auth: any): Promise<string> {
    const gmail = google.gmail({
        version: 'v1',
        auth,
    });

    try {
        dogstatsd.increment('gmail.users.getProfile.calls');
        const request = await gmail.users.getProfile({
            userId: 'me',
        });
        return request.data.emailAddress;
    } catch (err) {
        dogstatsd.increment('gmail.users.getProfile.fails');
        if (!err.response) {
            console.log(err);
            return '';
        }
        const code = err.response.data.error.code;
        dogstatsd.increment('gmail.users.getProfile.fails.code', [
            `code:${code}`,
        ]);
        console.log('getUsersEmail():', err.response.data.error.message, code);
    }

    return '';
}

/**
 * Lists the messages in the user's mailbox (including trash and spam).
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function listMessages(auth: any) {
    const gmail = google.gmail({ version: 'v1', auth });

    const email = await getUsersEmail(auth);

    dogstatsd.increment('gmail.users.messages.list.calls');
    gmail.users.messages.list(
        {
            userId: 'me',
            includeSpamTrash: true,
        },
        (
            err: string,
            res: { data: { resultSizeEstimate: any; messages: any } }
        ) => {
            if (err) return console.log('The API returned an error: ' + err);
            dogstatsd.gauge('message.count', res.data.resultSizeEstimate, 1, [
                `account:${email}`,
            ]);
            if (res.data.resultSizeEstimate) {
                const messages = res.data.messages;
                messages.forEach(async (message: any) => {
                    message.email = email;
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
async function scanMessageContents(
    auth: any,
    message: { email: string; id: string; subject: string; threadId: string }
) {
    const gmail = google.gmail({ version: 'v1', auth });

    var request = await gmail.users.messages.get({
        userId: 'me',
        id: message.id,
    });

    request.data.payload.headers.forEach(
        (header: { name: string; value: any }) => {
            if (header.name === 'Subject') {
                message.subject = header.value;
            }
        }
    );
    scanContent(message.subject, message);

    request = await gmail.users.threads.get({
        userId: 'me',
        id: message.threadId,
    });

    request.data.messages.forEach(
        (thread: {
            payload: { mimeType: string; body: { data: any }; parts: any };
        }) => {
            if (
                thread.payload.mimeType === 'text/html' ||
                thread.payload.mimeType === 'text/plain'
            ) {
                scanContent(Base64.decode(thread.payload.body.data), message);
            }
            scanParts(thread.payload.parts, message);
        }
    );
}

/**
 * Scans a list of message parts for suspicious content.
 *
 * @param {Object[]} A list of message parts.
 * @param {Object} The message identifiers.
 */
function scanParts(parts: any[], message: any) {
    if (!parts) {
        return;
    }

    parts.forEach(
        (part: { mimeType: string; body: { data: any }; parts: any }) => {
            if (
                part.mimeType === 'text/html' ||
                part.mimeType === 'text/plain'
            ) {
                scanContent(Base64.decode(part.body.data), message);
            }
            scanParts(part.parts, message);
        }
    );
}

/**
 * Scans a single piece of text for suspicious content.
 *
 * @param {string} A string to scan for suspicious content.
 * @param {Object} The message identifiers.
 */
function scanContent(content: string | string[], message: any) {
    if (content.includes('http://') || content.includes('https://')) {
        console.log('WARN: content contains links!', message);
        dogstatsd.increment('content.suspicious.link', [
            `threadId:${message.threadId}`,
            `account:${message.email}`,
        ]);
    }
}
