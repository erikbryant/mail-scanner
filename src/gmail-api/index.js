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
    authorize(JSON.parse(content), listLabels);
    authorize(JSON.parse(content), listMessages);
});

/**
 * Get the user's email address from the auth object.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function getUsersEmail(auth) {
    const gmail = await google.gmail({ version: 'v1', auth });
    await gmail.users.getProfile(
        {
            userId: 'me',
        },
        (err, { data }) => {
            if (err) return console.log('The API returned an error: ' + err);
            console.log(
                `mail-scanner is now processing account: ${data.emailAddress}`
            );
        }
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
 * Lists the labels in the user's account.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listLabels(auth) {
    const gmail = google.gmail({ version: 'v1', auth });
    gmail.users.labels.list(
        {
            userId: 'me',
        },
        (err, res) => {
            if (err) return console.log('The API returned an error: ' + err);
            const labels = res.data.labels;
            if (labels.length) {
                console.log('Labels:');
                labels.forEach((label) => {
                    console.log(`- ${label.name}`);
                });
            } else {
                console.log('No labels found.');
            }
        }
    );
}

/**
 * Lists the messages in the user's mailbox.
 *
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
function listMessages(auth) {
    const gmail = google.gmail({ version: 'v1', auth });
    gmail.users.messages.list(
        {
            userId: 'me',
        },
        (err, res) => {
            if (err) return console.log('The API returned an error: ' + err);
            if (res.data.resultSizeEstimate) {
                const messages = res.data.messages;
                console.log('Inbox messages:');
                messages.forEach(async (message) => {
                    console.log(message);
                    var request = await gmail.users.threads.get({
                        userId: 'me',
                        id: message.threadId,
                    });
                    console.log(
                        'Messages in this thread:',
                        request.data.messages.length
                    );
                    request.data.messages.forEach((thread) => {
                        if (
                            thread.payload.mimeType === 'text/html' ||
                            thread.payload.mimeType === 'text/plain'
                        ) {
                            console.log(
                                Base64.decode(thread.payload.body.data).slice(
                                    0,
                                    100
                                )
                            );
                        } else {
                            console.log(
                                'Found a mime type I do not know how to handle:',
                                thread.payload.mimeType
                            );
                            console.log(thread.snippet);
                            if (thread.payload.body.data) {
                                console.log(
                                    thread.payload.body.data.slice(0, 100)
                                );
                            } else {
                                console.log('<Thread data is empty>');
                            }
                        }
                        console.log();
                    });
                    console.log();
                });
                console.log();
            } else {
                console.log('No messages found.');
            }
        }
    );
}
